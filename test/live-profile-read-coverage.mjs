import { operationTraceDirectory } from "./operation-trace.mjs";
import { verifyProfileReadCoverage } from "./live-profile-read-coverage-lib.mjs";

const profileId = process.env.SSE_LIVE_PROFILE_ID ?? "";
const result = verifyProfileReadCoverage(operationTraceDirectory(), profileId);
process.stdout.write(`${profileId}-Leseabdeckung: ${result.operations} geforderte Operationen real erfolgreich nachgewiesen.\n`);
