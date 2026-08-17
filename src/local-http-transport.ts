import { request } from "node:http";
import { Readable } from "node:stream";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1"]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function requestUrl(input: string | URL | Request): URL {
  if (typeof input !== "string" && !(input instanceof URL)) {
    throw new TypeError("Interner SSE-HTTP-Transport akzeptiert keine Request-Objekte.");
  }
  const url = new URL(input);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TypeError("Interner SSE-HTTP-Transport ist ausschliesslich fuer Loopback erlaubt.");
  }
  if (url.username || url.password) {
    throw new TypeError("Interner SSE-HTTP-Transport akzeptiert keine URL-Zugangsdaten.");
  }
  return url;
}

function requestMethod(init: RequestInit | undefined): "GET" | "POST" {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw new TypeError("Interner SSE-HTTP-Transport erlaubt nur GET und POST.");
  }
  return method;
}

function requestBody(init: RequestInit | undefined): string | undefined {
  if (init?.body === undefined || init.body === null) return undefined;
  if (typeof init.body !== "string") {
    throw new TypeError("Interner SSE-HTTP-Transport akzeptiert nur UTF-8-String-Bodies.");
  }
  return init.body;
}

function responseHeaders(rawHeaders: string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  return headers;
}

/**
 * Minimaler Fetch-kompatibler Transport fuer die bereits validierte lokale
 * SSE-API. node:http besitzt keine versteckte 300-s-Header-/Bodyfrist; die
 * einzige fachliche Frist bleibt deshalb das vom API-Client gereichte Signal.
 */
export const localHttpFetch: typeof fetch = async (input, init) => {
  const url = requestUrl(input);
  const method = requestMethod(init);
  const body = requestBody(init);
  const headers = new Headers(init?.headers);
  if (body !== undefined && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(body, "utf8")));
  }

  return await new Promise<Response>((resolve, reject) => {
    let outgoing;
    try {
      outgoing = request(url, {
        method,
        headers: Object.fromEntries(headers.entries()),
        ...(init?.signal ? { signal: init.signal } : {}),
      }, (incoming) => {
        const status = incoming.statusCode;
        if (status === undefined || status < 200 || status > 599) {
          incoming.destroy();
          reject(new TypeError(`SSE-HTTP-Transport erhielt ungueltigen Status ${String(status)}.`));
          return;
        }
        if (init?.redirect === "error" && status >= 300 && status < 400) {
          incoming.destroy();
          reject(new TypeError(`SSE-HTTP-Transport verweigert Redirectstatus ${status}.`));
          return;
        }
        try {
          const responseBody = NULL_BODY_STATUSES.has(status)
            ? null
            : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
          if (responseBody === null) incoming.resume();
          resolve(new Response(
            responseBody,
            {
              status,
              ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
              headers: responseHeaders(incoming.rawHeaders),
            },
          ));
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
      return;
    }
    outgoing.once("error", reject);
    outgoing.end(body);
  });
};
