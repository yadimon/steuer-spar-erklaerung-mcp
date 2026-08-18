import { z } from "zod";
import {
  WINDOW_HANDLE,
} from "./operation-schema-primitives.js";

export const SSE_MCP_ANALYSIS_SCHEMAS = {
  "sse_read_full": z.object({
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_scroll_page": z.object({
    mode: z.enum(["info", "percent", "amount"]).optional().describe("Scrollmodus; Vorgabe info"),
    vPercent: z.number().min(0).max(100).optional().describe("Vertikale Zielposition in Prozent fuer mode=percent"),
    direction: z.enum(["up", "down"]).optional().describe("Richtung fuer mode=amount"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_help": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_subpages": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_check_page": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_result_details": z.object({
    openIfNeeded: z.boolean().optional().describe("Werte-Info bei Bedarf oeffnen; Vorgabe true"),
    hwnd: WINDOW_HANDLE.optional().describe("SSE-Hauptfenster, zu dessen Prozess die Werte-Info gehoert"),
  }).strict(),
  "sse_checker_results": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_checker_run": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_checker_reset": z.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
  "sse_checker_open": z.object({
    name: z.string().min(1).describe("Exakter Text aus sse_checker_results"),
    hwnd: WINDOW_HANDLE.optional(),
  }).strict(),
  "sse_checker_close": z.object({
    hwnd: WINDOW_HANDLE.optional(),
    waitMs: z.number().int().min(300).max(3000).optional().describe("Wartezeit auf den unveraenderten Seiten-Readback"),
  }).strict(),
} as const;
