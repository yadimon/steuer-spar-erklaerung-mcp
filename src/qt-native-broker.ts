import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Duplex } from "node:stream";
import { isAbsolute } from "node:path";
import { QtNativeClient, QtNativeTransportError, type QtNativeBinding } from "./qt-native-client.js";
import type { QtNativePackage } from "./qt-native-package.js";

export interface QtNativeTarget {
  pid: number;
  hwnd: number;
  desktop?: string;
  creationTime?: string;
}

export interface QtNativeSession {
  client: QtNativeClient;
  brokerPid: number;
  close(): Promise<void>;
  exited: Promise<void>;
}

export interface QtNativeBrokerOptions {
  package: QtNativePackage;
  target: QtNativeTarget;
  expectedImage: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

class BrokerStream extends Duplex {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super();
    child.stdout.on("data", (chunk: Buffer) => { if (!this.push(chunk)) child.stdout.pause(); });
    child.stdout.on("end", () => this.push(null));
    child.stdout.on("error", error => this.destroy(error));
    child.stdin.on("error", error => this.destroy(error));
    child.once("exit", () => this.destroy(new Error("Native broker exited; pending outcomes require inspection.")));
  }
  override _read(): void { this.child.stdout.resume(); }
  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.child.stdin.write(chunk, encoding, callback);
  }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.kill(); callback(error);
  }
}

async function readReadiness(child: ChildProcessWithoutNullStreams, timeoutMs: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolveReady, reject) => {
    let bytes = Buffer.alloc(0), done = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (done) return; done = true;
      clearTimeout(timer); child.stdout.off("readable", read); child.off("exit", exited); child.off("error", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error); else resolveReady(value!);
    };
    const exited = () => finish(new QtNativeTransportError("Native broker ended before readiness.", "native-startup", true));
    const failed = (error: Error) => finish(error);
    const aborted = () => finish(new QtNativeTransportError("Native broker startup cancelled; attachment may have begun.", "aborted", true));
    const timer = setTimeout(() => finish(new QtNativeTransportError("Native broker startup deadline exceeded.", "native-startup-timeout", true)), timeoutMs);
    const read = () => {
      let chunk: Buffer | null;
      while ((chunk = child.stdout.read() as Buffer | null) !== null) {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 65536) return finish(new Error("Native broker readiness exceeds the protocol bound."));
        const newline = bytes.indexOf(10); if (newline < 0) continue;
        try {
          const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, newline)));
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native broker readiness.");
          if (bytes.length !== newline + 1) throw new Error("Native broker emitted unsolicited protocol data before its handshake.");
          return finish(undefined, value as Record<string, unknown>);
        } catch (error) { return finish(error instanceof Error ? error : new Error("Invalid broker readiness.")); }
      }
    };
    child.stdout.on("readable", read); child.once("exit", exited); child.once("error", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted(); else read();
  });
}

export async function startQtNativeBroker(options: QtNativeBrokerOptions): Promise<QtNativeSession> {
  const { package: nativePackage, target, expectedImage, signal } = options;
  if (signal?.aborted) throw new QtNativeTransportError("Native startup cancelled before launch.", "aborted");
  if (!Number.isSafeInteger(target.pid) || target.pid < 1 || target.pid > 0xffffffff
    || !Number.isSafeInteger(target.hwnd) || target.hwnd < 1 || !isAbsolute(expectedImage)
    || /[\u0000-\u001f]/u.test(expectedImage)
    || (target.desktop !== undefined && !/^[A-Za-z0-9_-]{1,64}$/u.test(target.desktop))) {
    throw new QtNativeTransportError("Invalid native target binding.", "native-binding");
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000) {
    throw new QtNativeTransportError("Invalid native startup deadline.", "native-deadline");
  }
  const request = {
    ...target, mode: "attach", expectedImage, expectedProfile: nativePackage.manifest.profile,
    dll: nativePackage.bridgePath,
    pipe: `\\\\.\\pipe\\sse-qt-read-${target.pid}-${randomBytes(8).toString("hex")}`,
    nonce: randomBytes(32).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(request));
  if (body.length > 65536) throw new QtNativeTransportError("Native bootstrap exceeds the protocol bound.", "native-request-size");
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  const child = spawn(nativePackage.loaderPath, ["--broker"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stderrBytes = 0, client: QtNativeClient | undefined, stream: BrokerStream | undefined;
  // Diagnostics are bounded and never copied into API errors, where they could disclose local paths.
  child.stderr.on("data", (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > 65536) child.kill(); });
  child.stdin.on("error", () => {});
  const exited = new Promise<void>(resolveExit => { child.once("exit", () => resolveExit()); child.once("error", () => resolveExit()); });
  const abort = () => { client?.close(); child.kill(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const started = performance.now(), waiting = readReadiness(child, options.timeoutMs, signal);
    child.stdin.write(Buffer.concat([header, body]));
    const loaded = await waiting;
    if (loaded.ok !== true || loaded.pipePeerVerified !== true || loaded.binaryIdentityVerified !== true
      || loaded.bindingDiscovered !== true || loaded.bridgeImageVerified !== true
      || loaded.controllerPid !== process.pid || loaded.brokerPid !== child.pid || loaded.ownerPid !== child.pid
      || loaded.pid !== target.pid || loaded.hwnd !== target.hwnd
      || typeof loaded.ownerCreationTime !== "string" || !/^[1-9][0-9]{0,19}$/u.test(loaded.ownerCreationTime)
      || loaded.bridgeBuildIdentity !== nativePackage.manifest.buildIdentity
      || typeof loaded.image !== "string" || loaded.image.toLowerCase() !== expectedImage.toLowerCase()) {
      throw new QtNativeTransportError("Native broker did not verify the requested binding and package.", "native-peer");
    }
    const actualProfile = loaded.profile as Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(nativePackage.manifest.profile)) {
      if (actualProfile?.[key] !== value) throw new QtNativeTransportError("Native broker profile mismatch.", "native-peer");
    }
    const binding = { ...request, creationTime: loaded.creationTime } as QtNativeBinding;
    if (target.creationTime !== undefined && binding.creationTime !== target.creationTime) {
      throw new QtNativeTransportError("Native target process creation time changed.", "native-peer");
    }
    let remaining = Math.floor(options.timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native startup deadline exceeded before handshake.", "native-startup-timeout", true);
    stream = new BrokerStream(child); client = await QtNativeClient.connectStream(binding, stream, remaining);
    remaining = Math.floor(options.timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native startup deadline exceeded before owner verification.", "native-startup-timeout", true);
    const ping = (await client.request("ping", {}, remaining, signal)).result;
    if (ping.ownerPid !== child.pid || ping.ownerCreationTime !== loaded.ownerCreationTime) {
      throw new QtNativeTransportError("Native session owner does not match its broker.", "native-peer");
    }
    return { client, brokerPid: child.pid!, exited, async close() { client!.close(); child.kill(); await exited; } };
  } catch (error) {
    client?.close(); stream?.destroy(); child.kill(); await exited;
    if (error instanceof QtNativeTransportError) throw error;
    throw new QtNativeTransportError("Native broker startup failed.", "native-startup", true);
  } finally { signal?.removeEventListener("abort", abort); }
}
