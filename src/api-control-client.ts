import { SSE_API_VERSION } from "./api-contract.js";
import { API_SHUTDOWN_REQUEST_SCHEMA, SSE_API_SHUTDOWN_PATH, type ApiShutdownAccepted } from "./api-control-contract.js";
import { ApiClientError, apiResponseError, clientSettings, hasValidErrorEnvelope, readApiJsonResponse } from "./api-client.js";
import { SSE_API_INSTANCE_HEADER } from "./api-supervisor-contract.js";
import { withCombinedAbortSignal } from "./abort.js";
import type { ApiClientOptions } from "./api-client.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Einmaliger gebundener Stoppauftrag; Transportfehler werden nie wiederholt. */
export async function requestApiShutdown(
  request: { confirm: true; instanceId: string },
  options: ApiClientOptions = {},
): Promise<ApiShutdownAccepted> {
  const parsed = API_SHUTDOWN_REQUEST_SCHEMA.safeParse(request);
  if (!parsed.success) throw new ApiClientError("Shutdown verlangt confirm=true und die exakte instanceId.", "bad-args");
  const settings = clientSettings(options);
  if (settings.expectedInstanceId !== request.instanceId) {
    throw new ApiClientError("Shutdown verlangt dieselbe Instanzkennung aus der vorherigen Health-Bindung.", "api-instance-mismatch");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const { response, payload } = await withCombinedAbortSignal([controller.signal, settings.signal], async (signal) => {
      const response = await settings.fetchImpl(`${settings.baseUrl}${SSE_API_SHUTDOWN_PATH}`, {
        method: "POST", redirect: "error", signal,
        headers: {
          accept: "application/json", "content-type": "application/json",
          [SSE_API_INSTANCE_HEADER]: request.instanceId,
        },
        body: JSON.stringify(parsed.data),
      });
      return { response, payload: await readApiJsonResponse(response, 16 * 1024) };
    });
    if (!isRecord(payload)) throw new ApiClientError("Shutdown-Antwort ist kein JSON-Objekt.", "protocol");
    if (!response.ok) {
      if (!hasValidErrorEnvelope(payload)) throw new ApiClientError("Shutdown-Fehlerantwort ist nicht eindeutig.", "protocol");
      throw apiResponseError(payload, response.status);
    }
    if (response.status !== 202 || payload.apiVersion !== SSE_API_VERSION ||
        typeof payload.requestId !== "string" || !UUID_V4.test(payload.requestId) ||
        payload.accepted !== true || payload.instanceId !== request.instanceId ||
        !Number.isSafeInteger(payload.processId) || Number(payload.processId) < 1 || Number(payload.processId) > 0xffff_ffff ||
        payload.processExited !== false) {
      throw new ApiClientError("Shutdown-Antwort bestaetigt keine gebundene Annahme.", "protocol");
    }
    return payload as unknown as ApiShutdownAccepted;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(
      "Shutdown-Antwort fehlt. Ob der Stopp angenommen wurde, ist unbekannt; keinen erneuten Stopp senden und keinen Ersatzprozess starten.",
      "shutdown-unknown",
    );
  } finally {
    clearTimeout(timer);
  }
}

