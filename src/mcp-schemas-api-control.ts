import { z } from "zod";

export const SSE_MCP_API_CONTROL_SCHEMAS = {
  sse_api_control: z.object({
    action: z.enum(["status", "shutdown", "start"]).describe("Status lesen, API stoppen oder ausdruecklich erneut starten."),
    confirm: z.literal(true).optional().describe("Fuer shutdown/start ausdruecklich true; bei status weglassen."),
    instanceId: z.string().uuid().optional().describe("Fuer shutdown/start die zuletzt gelesene gebundene API-Instanz; bei status weglassen."),
  }).strict(),
} as const;

// The SDK publishes only an object schema. Keep the object itself strict and
// apply the conditional action requirements again at the callback boundary.
const validatedRequest = SSE_MCP_API_CONTROL_SCHEMAS.sse_api_control.superRefine((value, context) => {
    if (value.action === "status") {
      if (value.confirm !== undefined || value.instanceId !== undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "status akzeptiert ausschliesslich action." });
      }
    } else if (value.confirm !== true || !value.instanceId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "shutdown und start verlangen confirm=true und die zuletzt gelesene instanceId." });
    }
  });

export function parseApiControlRequest(value: unknown) {
  return validatedRequest.parse(value);
}

export const SSE_MCP_API_CONTROL_OUTPUT_SCHEMA = z.object({
  ok: z.boolean(),
  state: z.enum(["running", "stopping", "stopped", "starting", "unknown"]).optional(),
  instanceId: z.string().uuid().optional(),
  processId: z.number().int().positive().optional(),
  accepted: z.boolean().nullable().optional(),
  processExited: z.boolean().optional(),
}).passthrough();
