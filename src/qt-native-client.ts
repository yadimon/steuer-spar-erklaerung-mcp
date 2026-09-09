import { createConnection } from "node:net";
import { performance } from "node:perf_hooks";
import type { Duplex } from "node:stream";
import { QtNativeTransportError, validateQtNativeBinding } from "./qt-native-binding.js";
import type { QtNativeBinding, QtNativeMeasurement, QtNativeReply } from "./qt-native-binding.js";
export { QtNativeTransportError } from "./qt-native-binding.js";
export type { QtNativeBinding, QtNativeMeasurement, QtNativeReply } from "./qt-native-binding.js";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

interface PendingRequest {
  resolve(value: QtNativeMeasurement): void;
  reject(error: Error): void;
  startedAt: number;
  timer: NodeJS.Timeout;
  removeAbortListener(): void;
}

/**
 * Framed local transport for the in-process Qt bridge. It never retries a
 * submitted request: a broken connection cannot prove a mutation did not run.
 * Callers must establish the binding with the verified native loader first.
 */
export class QtNativeClient {
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private input = Buffer.alloc(0);
  private failure: QtNativeTransportError | undefined;

  private constructor(private socket: Duplex, readonly binding: Readonly<QtNativeBinding>) {
    socket.on("data", chunk => this.acceptData(chunk));
    socket.on("error", error => this.fail("Native pipe failed: " + error.message, "native-connection", true));
    socket.on("close", () => this.fail("Native pipe closed.", "native-connection", true));
    socket.on("end", () => this.fail("Native response stream ended.", "native-connection", true));
  }

  static async connect(binding: QtNativeBinding, timeoutMs = 5_000): Promise<QtNativeClient> {
    validateQtNativeBinding(binding, timeoutMs);
    const socket = createConnection(binding.pipe);
    const client = new QtNativeClient(socket, Object.freeze({ ...binding }));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        const error = client.fail("Native connection deadline exceeded.", "native-connect-timeout");
        reject(error);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("connect", connected);
        socket.off("error", failed);
        socket.off("close", closed);
      };
      const connected = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const closed = () => { cleanup(); reject(client.failure ?? new Error("Native connection closed before readiness.")); };
      socket.once("connect", connected);
      socket.once("error", failed);
      socket.once("close", closed);
    });
    return client.handshake(timeoutMs);
  }

  /** Take ownership of a ready byte stream whose OS peer the native broker has verified. */
  static async connectStream(binding: QtNativeBinding, stream: Duplex, timeoutMs = 5_000): Promise<QtNativeClient> {
    try {
      validateQtNativeBinding(binding, timeoutMs);
      if (stream.destroyed || !stream.readable || !stream.writable || stream.readableObjectMode || stream.writableObjectMode) {
        throw new QtNativeTransportError("Native transport must be a live binary duplex stream.", "native-stream");
      }
    } catch (error) { stream.destroy(); throw error; }
    const client = new QtNativeClient(stream, Object.freeze({ ...binding }));
    stream.resume();
    return client.handshake(timeoutMs);
  }

  private async handshake(timeoutMs: number): Promise<QtNativeClient> {
    try {
      const binding = this.binding;
      const { result } = await this.request("ping", {}, timeoutMs);
      if (result.ok !== true || result.pid !== binding.pid || result.hwnd !== binding.hwnd
        || result.creationTime !== binding.creationTime || result.bridgeProtocol !== 1 || result.guiThread !== true) {
        throw new QtNativeTransportError("Native peer did not confirm the bound process, window and protocol.", "native-peer");
      }
      return this;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request(
    operation: string,
    args: Readonly<Record<string, unknown>> = {},
    timeoutMs = 5_000,
    signal?: AbortSignal,
  ): Promise<QtNativeMeasurement> {
    if (this.failure) return Promise.reject(this.failure);
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(operation)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000
      || ["id", "op", "nonce"].some(field => Object.hasOwn(args, field))) {
      return Promise.reject(new QtNativeTransportError("Invalid native request envelope.", "native-request"));
    }
    if (signal?.aborted) return Promise.reject(new QtNativeTransportError("Native request cancelled before submission.", "aborted"));
    if (this.pending.size >= 32) return Promise.reject(new QtNativeTransportError("Native request queue is full.", "native-queue-full"));
    const id = ++this.nextId;
    let payload: Buffer;
    try { payload = Buffer.from(JSON.stringify({ ...args, id, op: operation, nonce: this.binding.nonce })); }
    catch { return Promise.reject(new QtNativeTransportError("Native request is not JSON serializable.", "native-request")); }
    if (payload.byteLength > MAX_REQUEST_BYTES) {
      return Promise.reject(new QtNativeTransportError("Native request exceeds the frame limit.", "native-request-size"));
    }
    if (signal?.aborted) return Promise.reject(new QtNativeTransportError("Native request cancelled before submission.", "aborted"));
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(payload.byteLength);
    return new Promise<QtNativeMeasurement>((resolve, reject) => {
      const abort = () => this.fail("Native request cancelled after submission; completion must be checked before retry.", "aborted", true);
      const timer = setTimeout(() => {
        this.fail("Native response deadline exceeded; completion must be checked before retry.", "native-timeout", true);
      }, timeoutMs);
      this.pending.set(id, {
        resolve, reject, timer, startedAt: performance.now(),
        removeAbortListener: () => signal?.removeEventListener("abort", abort),
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.socket.write(Buffer.concat([header, payload]));
    });
  }

  close(): void {
    this.fail("Native session closed by its owner.", "native-closed", this.pending.size > 0);
  }

  private acceptData(chunk: Buffer): void {
    if (this.failure) return;
    try {
      // No request can return more than one bounded response. Outstanding
      // request count is also bounded, preventing an unbounded receive queue.
      if (this.input.byteLength + chunk.byteLength > (MAX_RESPONSE_BYTES + 4) * Math.max(1, this.pending.size)) {
        throw new Error("Native receive buffer exceeded its bound.");
      }
      this.input = Buffer.concat([this.input, chunk]);
      while (this.input.byteLength >= 4) {
        const length = this.input.readUInt32LE(0);
        if (length === 0 || length > MAX_RESPONSE_BYTES) throw new Error("Invalid native response frame length.");
        if (this.input.byteLength < length + 4) return;
        const value: unknown = JSON.parse(UTF8.decode(this.input.subarray(4, length + 4)));
        this.input = this.input.subarray(length + 4);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Native response must be an object.");
        const response = value as Partial<QtNativeReply>;
        if (!Number.isSafeInteger(response.id) || typeof response.ok !== "boolean") throw new Error("Invalid native response envelope.");
        const pending = this.pending.get(response.id!);
        if (!pending) throw new Error("Native response has an unknown or repeated request id.");
        this.pending.delete(response.id!);
        clearTimeout(pending.timer);
        pending.removeAbortListener();
        pending.resolve({ result: response as QtNativeReply, durationMs: performance.now() - pending.startedAt });
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Invalid native response.", "native-protocol", true);
    }
  }

  private fail(message: string, kind: string, outcomeUnknown = false): QtNativeTransportError {
    this.failure ??= new QtNativeTransportError(message, kind, outcomeUnknown);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.removeAbortListener();
      pending.reject(this.failure);
    }
    this.pending.clear();
    this.input = Buffer.alloc(0);
    this.socket.destroy();
    return this.failure;
  }
}
