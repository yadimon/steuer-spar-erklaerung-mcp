import { z } from "zod";
import { SSE_API_VERSION } from "./api-contract.js";

/** API-Prozesssteuerung besitzt keinen Worker- oder Steuerfallauftrag. */
export const SSE_API_SHUTDOWN_PATH = `/${SSE_API_VERSION}/control/shutdown`;
export const API_SHUTDOWN_REQUEST_SCHEMA = z.object({
  confirm: z.literal(true),
  instanceId: z.string().uuid(),
}).strict();

export interface ApiShutdownAccepted {
  apiVersion: string;
  requestId: string;
  accepted: true;
  instanceId: string;
  processId: number;
  processExited: false;
}
