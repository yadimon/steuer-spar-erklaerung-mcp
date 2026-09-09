const PIPE_NAME = /^\\\\\.\\pipe\\sse-qt-read-([1-9][0-9]*)-[a-f0-9]{16}$/u;

export interface QtNativeBinding {
  pipe: string;
  nonce: string;
  pid: number;
  hwnd: number;
  creationTime: string;
}

export interface QtNativeReply {
  ok: boolean;
  id: number;
  [field: string]: unknown;
}

export interface QtNativeMeasurement {
  result: QtNativeReply;
  durationMs: number;
}

export class QtNativeTransportError extends Error {
  constructor(message: string, readonly kind: string, readonly outcomeUnknown = false) {
    super(message);
    this.name = "QtNativeTransportError";
  }
}

export function validateQtNativeBinding(binding: QtNativeBinding, timeoutMs: number): void {
  const pipe = PIPE_NAME.exec(binding.pipe);
  if (!pipe || Number(pipe[1]) !== binding.pid || !Number.isSafeInteger(binding.pid) || binding.pid > 0xffffffff
    || !Number.isSafeInteger(binding.hwnd) || binding.hwnd <= 0
    || !/^[a-f0-9]{64}$/u.test(binding.nonce)
    || !/^[1-9][0-9]{0,19}$/u.test(binding.creationTime) || BigInt(binding.creationTime) > 0xffffffffffffffffn) {
    throw new QtNativeTransportError("Invalid native process, window or session binding.", "native-binding");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new QtNativeTransportError("Invalid native connection deadline.", "native-deadline");
  }
}
