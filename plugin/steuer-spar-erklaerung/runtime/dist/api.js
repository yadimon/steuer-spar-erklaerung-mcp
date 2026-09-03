#!/usr/bin/env node
const __sseNodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0] ?? "0", 10);
if (!Number.isSafeInteger(__sseNodeMajor) || __sseNodeMajor < 22) {
  process.stderr.write("SteuerSparErklaerung-Plugin benoetigt Node.js 22 oder neuer.\n");
  process.exit(1);
}
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/atomic-files.ts
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve as resolve2 } from "node:path";
function createTextFileExclusive(file) {
  if (existsSync(file.path)) {
    if (!lstatSync(file.path).isFile()) throw new Error(`Schreibziel ist keine regulaere Datei: ${file.path}`);
    return false;
  }
  const temporary = join(dirname(file.path), `.${basename(file.path)}.sse-tmp-${process.pid}-${randomUUID()}`);
  try {
    writeFileSync(temporary, file.content, {
      encoding: "utf8",
      flag: "wx",
      ...file.mode === void 0 ? {} : { mode: file.mode }
    });
    try {
      linkSync(temporary, file.path);
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
var init_atomic_files = __esm({
  "src/atomic-files.ts"() {
    "use strict";
  }
});

// src/api-contract.ts
function isSseApiOperation(value) {
  return OPERATION_SET.has(value);
}
function asArray(value) {
  if (value === null || value === void 0) return [];
  return Array.isArray(value) ? value : [value];
}
var SSE_API_VERSION, DEFAULT_API_HOST, DEFAULT_API_PORT, DEFAULT_OPERATION_TIMEOUT_MS, LAUNCH_OPERATION_TIMEOUT_MS, MAX_OPERATION_TIMEOUT_MS, MAX_WORKER_QUEUE_DEPTH, MAX_API_BODY_BYTES, MAX_WORKSPACE_TEXT_BYTES, MAX_API_RESPONSE_BYTES, SSE_API_OPERATIONS, OPERATION_SET, LOOPBACK_HOSTNAMES;
var init_api_contract = __esm({
  "src/api-contract.ts"() {
    "use strict";
    SSE_API_VERSION = "v1";
    DEFAULT_API_HOST = "127.0.0.1";
    DEFAULT_API_PORT = 43127;
    DEFAULT_OPERATION_TIMEOUT_MS = 9e4;
    LAUNCH_OPERATION_TIMEOUT_MS = 24e4;
    MAX_OPERATION_TIMEOUT_MS = 3e5;
    MAX_WORKER_QUEUE_DEPTH = 32;
    MAX_API_BODY_BYTES = 8 * 1024 * 1024;
    MAX_WORKSPACE_TEXT_BYTES = 1024 * 1024;
    MAX_API_RESPONSE_BYTES = 40 * 1024 * 1024;
    SSE_API_OPERATIONS = [
      "capabilities",
      "accessibility_probe",
      "archive_cases",
      "backup_cases",
      "case_create",
      "case_hash",
      "center_cases",
      "center_refresh",
      "check",
      "checker_close",
      "checker_detail",
      "checker_open",
      "checker_reset",
      "checker_results",
      "checker_run",
      "click",
      "click_point",
      "close",
      "collect",
      "combo_options",
      "combo_select",
      "desktop_start",
      "desktop_status",
      "desktop_stop",
      "dialog_answer",
      "dialog_list",
      "dismiss",
      "export_csv",
      "file_dialog_select",
      "fill_fields",
      "find",
      "get_value",
      "goto",
      "health",
      "help",
      "instances",
      "known_page_state",
      "launch",
      "list_cases",
      "make_working_copy",
      "menu",
      "menu_click",
      "menu_close",
      "page",
      "page_objects",
      "positions",
      "product_info",
      "read_full",
      "read_page",
      "read_table",
      "receipt_manager_action",
      "receipt_manager_bulk_upsert",
      "receipt_manager_classification_options",
      "receipt_manager_classify",
      "receipt_manager_link",
      "receipt_manager_delete",
      "receipt_manager_import",
      "receipt_manager_list",
      "receipt_manager_read",
      "receipt_manager_update",
      "result_details",
      "save",
      "save_as",
      "scenario_run",
      "screenshot",
      "scroll",
      "scroll_page",
      "set_value",
      "snapshot",
      "snapshot_compare",
      "subpages",
      "table_add",
      "table_delete",
      "table_read",
      "table_update",
      "toggle",
      "tracked_set_value",
      "tree_scroll",
      "tree_top",
      "ui_state",
      "ustva_change_value",
      "ustva_open_section",
      "ustva_read",
      "ustva_select_period",
      "ustva_set_flag",
      "vast_apply",
      "vast_dialog_read",
      "vast_mapping_options",
      "vast_mapping_select",
      "vast_row_details",
      "vast_row_set_expanded",
      "verify",
      "warning_popup_read",
      "workspace_file_list",
      "workspace_file_read_text",
      "workspace_file_write_text",
      "workspace_status",
      "window_close",
      "window_restore",
      "windows"
    ];
    OPERATION_SET = new Set(SSE_API_OPERATIONS);
    LOOPBACK_HOSTNAMES = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  }
});

// src/bounded-files.ts
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
function readFileBounded(path, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("Dateilimit muss eine positive ganze Zahl sein.");
  const descriptor = openSync(path, "r");
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("Pfad bezeichnet keine regulaere Datei.");
    if (stats.size > maxBytes) throw new Error(`Datei ist groesser als ${maxBytes} Bytes.`);
    const chunks = [];
    const scratch = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    while (true) {
      const bytesRead = readSync(descriptor, scratch, 0, scratch.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error(`Datei ist groesser als ${maxBytes} Bytes.`);
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}
var init_bounded_files = __esm({
  "src/bounded-files.ts"() {
    "use strict";
  }
});

// src/json-files.ts
function parseJsonBytesStrict(bytes, label, source) {
  const suffix = source ? `: ${source}` : "";
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} ist kein gueltiges UTF-8${suffix}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} ist kein gueltiges JSON${suffix}`);
  }
}
function readJsonFileStrict(path, label, maxBytes = MAX_JSON_FILE_BYTES) {
  let bytes;
  try {
    bytes = readFileBounded(path, maxBytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} konnte nicht sicher gelesen werden: ${detail}`);
  }
  return parseJsonBytesStrict(bytes, label, path);
}
var MAX_JSON_FILE_BYTES;
var init_json_files = __esm({
  "src/json-files.ts"() {
    "use strict";
    init_bounded_files();
    MAX_JSON_FILE_BYTES = 16 * 1024 * 1024;
  }
});

// src/api-config-file.ts
import { existsSync as existsSync2 } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join2, resolve as resolve3 } from "node:path";
function optionalConfigString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function absolutePath(value, name) {
  if (!value) return void 0;
  if (!isAbsolute2(value) || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${name} muss ein absoluter Windows-Pfad ohne Steuerzeichen sein.`);
  }
  return resolve3(value);
}
function defaultApiConfigPath(env = process.env) {
  const configuredBase = [env.LOCALAPPDATA, env.APPDATA].map((entry) => optionalConfigString(entry)).find((entry) => entry !== void 0 && isAbsolute2(entry) && !/[\u0000-\u001f]/u.test(entry));
  const base = configuredBase ?? join2(homedir(), "AppData", "Local");
  if (!isAbsolute2(base) || /[\u0000-\u001f]/u.test(base)) {
    throw new Error("Sicherer lokaler Standardpfad fuer die API-Konfiguration fehlt.");
  }
  return join2(base, "SteuerSparErklaerungApi", "config.json");
}
function readApiConfigFile(configPath) {
  if (!existsSync2(configPath)) return {};
  const parsed = readJsonFileStrict(configPath, "API-Konfiguration", MAX_API_CONFIG_BYTES);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`API-Konfiguration ist kein JSON-Objekt: ${configPath}`);
  }
  const file = parsed;
  if ("token" in file) {
    throw new Error(
      `API-Konfiguration enthaelt das entfallene Feld 'token': ${configPath}. Zeile loeschen - die API braucht kein Token mehr.`
    );
  }
  const unknownFields = Object.keys(file).filter((field) => !CONFIG_FIELDS.has(field));
  if (unknownFields.length) {
    throw new Error(`Unbekanntes Feld in API-Konfiguration: '${unknownFields.sort()[0]}'.`);
  }
  for (const field of STRING_CONFIG_FIELDS) {
    if (file[field] !== void 0 && typeof file[field] !== "string") {
      throw new Error(`API-Konfigurationsfeld '${field}' muss eine Zeichenkette sein.`);
    }
  }
  if (file.port !== void 0 && typeof file.port !== "number") {
    throw new Error("API-Konfigurationsfeld 'port' muss eine Zahl sein.");
  }
  if (file.operateExperimental !== void 0 && typeof file.operateExperimental !== "boolean") {
    throw new Error("API-Konfigurationsfeld 'operateExperimental' muss ein Wahrheitswert sein.");
  }
  return file;
}
function resolveApiConfigValues(configPath, overrides = {}) {
  const absoluteConfig = resolve3(configPath);
  const file = readApiConfigFile(absoluteConfig);
  const host = overrides.host ?? optionalConfigString(file.host) ?? DEFAULT_API_HOST;
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("SSE-API darf aus Sicherheitsgruenden nur an Loopback gebunden werden.");
  }
  const rawPort = overrides.port ?? file.port ?? DEFAULT_API_PORT;
  const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSE_API_PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }
  const profileId = overrides.profileId ?? optionalConfigString(file.profileId) ?? "2025";
  const caseDir = absolutePath(overrides.caseDir ?? optionalConfigString(file.caseDir), "caseDir");
  const workspaceDir = absolutePath(
    overrides.workspaceDir ?? optionalConfigString(file.workspaceDir),
    "workspaceDir"
  ) ?? join2(dirname2(absoluteConfig), "workspace");
  const documentsDir = absolutePath(
    overrides.documentsDir ?? optionalConfigString(file.documentsDir),
    "documentsDir"
  ) ?? join2(workspaceDir, "documents");
  const resultDir = absolutePath(
    overrides.resultDir ?? optionalConfigString(file.resultDir),
    "resultDir"
  ) ?? join2(workspaceDir, "results");
  const backupsDir = absolutePath(
    overrides.backupsDir ?? optionalConfigString(file.backupsDir),
    "backupsDir"
  ) ?? join2(workspaceDir, "backups");
  const sseExecutable = absolutePath(
    overrides.sseExecutable ?? optionalConfigString(file.sseExecutable),
    "sseExecutable"
  );
  const operateExperimental = file.operateExperimental === true ? true : void 0;
  return {
    profileId,
    host,
    port,
    configPath: absoluteConfig,
    ...caseDir ? { caseDir } : {},
    documentsDir,
    workspaceDir,
    resultDir,
    backupsDir,
    ...sseExecutable ? { sseExecutable } : {},
    ...operateExperimental ? { operateExperimental } : {}
  };
}
var MAX_API_CONFIG_BYTES, CONFIG_FIELDS, STRING_CONFIG_FIELDS;
var init_api_config_file = __esm({
  "src/api-config-file.ts"() {
    "use strict";
    init_api_contract();
    init_json_files();
    MAX_API_CONFIG_BYTES = 1024 * 1024;
    CONFIG_FIELDS = /* @__PURE__ */ new Set([
      "profileId",
      "host",
      "port",
      "caseDir",
      "documentsDir",
      "workspaceDir",
      "resultDir",
      "backupsDir",
      "sseExecutable",
      "operateExperimental"
    ]);
    STRING_CONFIG_FIELDS = [...CONFIG_FIELDS].filter(
      (field) => field !== "port" && field !== "operateExperimental"
    );
  }
});

// src/api-config-values.ts
import { resolve as resolve4 } from "node:path";
function environmentForExplicitApiConfig(configPath, base = process.env) {
  const env = { ...base };
  for (const key of SSE_API_CONFIG_ENVIRONMENT_KEYS) delete env[key];
  env.SSE_API_CONFIG = resolve4(configPath);
  return env;
}
function loadApiConfigValues(env = process.env) {
  const configPath = resolve4(env.SSE_API_CONFIG ?? defaultApiConfigPath(env));
  const profileId = optionalConfigString(env.SSE_PROFILE_ID);
  const host = optionalConfigString(env.SSE_API_HOST);
  const port = optionalConfigString(env.SSE_API_PORT);
  const caseDir = optionalConfigString(env.SSE_CASE_DIR);
  const documentsDir = optionalConfigString(env.SSE_DOCUMENTS_DIR);
  const workspaceDir = optionalConfigString(env.SSE_WORKSPACE_DIR);
  const resultDir = optionalConfigString(env.SSE_RESULT_DIR);
  const backupsDir = optionalConfigString(env.SSE_BACKUPS_DIR);
  const sseExecutable = optionalConfigString(env.SSE_EXECUTABLE);
  return resolveApiConfigValues(configPath, {
    ...profileId ? { profileId } : {},
    ...host ? { host } : {},
    ...port ? { port } : {},
    ...caseDir ? { caseDir } : {},
    ...documentsDir ? { documentsDir } : {},
    ...workspaceDir ? { workspaceDir } : {},
    ...resultDir ? { resultDir } : {},
    ...backupsDir ? { backupsDir } : {},
    ...sseExecutable ? { sseExecutable } : {}
  });
}
var SSE_API_CONFIG_ENVIRONMENT_KEYS;
var init_api_config_values = __esm({
  "src/api-config-values.ts"() {
    "use strict";
    init_api_config_file();
    init_api_config_file();
    SSE_API_CONFIG_ENVIRONMENT_KEYS = Object.freeze([
      "SSE_API_CONFIG",
      "SSE_API_HOST",
      "SSE_API_PORT",
      "SSE_API_URL",
      "SSE_PROFILE_ID",
      "SSE_CASE_DIR",
      "SSE_DOCUMENTS_DIR",
      "SSE_WORKSPACE_DIR",
      "SSE_RESULT_DIR",
      "SSE_BACKUPS_DIR",
      "SSE_EXECUTABLE"
    ]);
  }
});

// node_modules/zod/v3/helpers/util.js
var util, objectUtil, ZodParsedType, getParsedType;
var init_util = __esm({
  "node_modules/zod/v3/helpers/util.js"() {
    (function(util2) {
      util2.assertEqual = (_) => {
      };
      function assertIs(_arg) {
      }
      util2.assertIs = assertIs;
      function assertNever(_x) {
        throw new Error();
      }
      util2.assertNever = assertNever;
      util2.arrayToEnum = (items) => {
        const obj = {};
        for (const item of items) {
          obj[item] = item;
        }
        return obj;
      };
      util2.getValidEnumValues = (obj) => {
        const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
        const filtered = {};
        for (const k of validKeys) {
          filtered[k] = obj[k];
        }
        return util2.objectValues(filtered);
      };
      util2.objectValues = (obj) => {
        return util2.objectKeys(obj).map(function(e) {
          return obj[e];
        });
      };
      util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
        const keys = [];
        for (const key in object) {
          if (Object.prototype.hasOwnProperty.call(object, key)) {
            keys.push(key);
          }
        }
        return keys;
      };
      util2.find = (arr, checker) => {
        for (const item of arr) {
          if (checker(item))
            return item;
        }
        return void 0;
      };
      util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
      function joinValues(array, separator = " | ") {
        return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
      }
      util2.joinValues = joinValues;
      util2.jsonStringifyReplacer = (_, value) => {
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      };
    })(util || (util = {}));
    (function(objectUtil2) {
      objectUtil2.mergeShapes = (first, second) => {
        return {
          ...first,
          ...second
          // second overwrites first
        };
      };
    })(objectUtil || (objectUtil = {}));
    ZodParsedType = util.arrayToEnum([
      "string",
      "nan",
      "number",
      "integer",
      "float",
      "boolean",
      "date",
      "bigint",
      "symbol",
      "function",
      "undefined",
      "null",
      "array",
      "object",
      "unknown",
      "promise",
      "void",
      "never",
      "map",
      "set"
    ]);
    getParsedType = (data) => {
      const t = typeof data;
      switch (t) {
        case "undefined":
          return ZodParsedType.undefined;
        case "string":
          return ZodParsedType.string;
        case "number":
          return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
        case "boolean":
          return ZodParsedType.boolean;
        case "function":
          return ZodParsedType.function;
        case "bigint":
          return ZodParsedType.bigint;
        case "symbol":
          return ZodParsedType.symbol;
        case "object":
          if (Array.isArray(data)) {
            return ZodParsedType.array;
          }
          if (data === null) {
            return ZodParsedType.null;
          }
          if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
            return ZodParsedType.promise;
          }
          if (typeof Map !== "undefined" && data instanceof Map) {
            return ZodParsedType.map;
          }
          if (typeof Set !== "undefined" && data instanceof Set) {
            return ZodParsedType.set;
          }
          if (typeof Date !== "undefined" && data instanceof Date) {
            return ZodParsedType.date;
          }
          return ZodParsedType.object;
        default:
          return ZodParsedType.unknown;
      }
    };
  }
});

// node_modules/zod/v3/ZodError.js
var ZodIssueCode, quotelessJson, ZodError;
var init_ZodError = __esm({
  "node_modules/zod/v3/ZodError.js"() {
    init_util();
    ZodIssueCode = util.arrayToEnum([
      "invalid_type",
      "invalid_literal",
      "custom",
      "invalid_union",
      "invalid_union_discriminator",
      "invalid_enum_value",
      "unrecognized_keys",
      "invalid_arguments",
      "invalid_return_type",
      "invalid_date",
      "invalid_string",
      "too_small",
      "too_big",
      "invalid_intersection_types",
      "not_multiple_of",
      "not_finite"
    ]);
    quotelessJson = (obj) => {
      const json = JSON.stringify(obj, null, 2);
      return json.replace(/"([^"]+)":/g, "$1:");
    };
    ZodError = class _ZodError extends Error {
      get errors() {
        return this.issues;
      }
      constructor(issues) {
        super();
        this.issues = [];
        this.addIssue = (sub) => {
          this.issues = [...this.issues, sub];
        };
        this.addIssues = (subs = []) => {
          this.issues = [...this.issues, ...subs];
        };
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
          Object.setPrototypeOf(this, actualProto);
        } else {
          this.__proto__ = actualProto;
        }
        this.name = "ZodError";
        this.issues = issues;
      }
      format(_mapper) {
        const mapper = _mapper || function(issue) {
          return issue.message;
        };
        const fieldErrors = { _errors: [] };
        const processError = (error) => {
          for (const issue of error.issues) {
            if (issue.code === "invalid_union") {
              issue.unionErrors.map(processError);
            } else if (issue.code === "invalid_return_type") {
              processError(issue.returnTypeError);
            } else if (issue.code === "invalid_arguments") {
              processError(issue.argumentsError);
            } else if (issue.path.length === 0) {
              fieldErrors._errors.push(mapper(issue));
            } else {
              let curr = fieldErrors;
              let i = 0;
              while (i < issue.path.length) {
                const el = issue.path[i];
                const terminal = i === issue.path.length - 1;
                if (!terminal) {
                  curr[el] = curr[el] || { _errors: [] };
                } else {
                  curr[el] = curr[el] || { _errors: [] };
                  curr[el]._errors.push(mapper(issue));
                }
                curr = curr[el];
                i++;
              }
            }
          }
        };
        processError(this);
        return fieldErrors;
      }
      static assert(value) {
        if (!(value instanceof _ZodError)) {
          throw new Error(`Not a ZodError: ${value}`);
        }
      }
      toString() {
        return this.message;
      }
      get message() {
        return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
      }
      get isEmpty() {
        return this.issues.length === 0;
      }
      flatten(mapper = (issue) => issue.message) {
        const fieldErrors = {};
        const formErrors = [];
        for (const sub of this.issues) {
          if (sub.path.length > 0) {
            const firstEl = sub.path[0];
            fieldErrors[firstEl] = fieldErrors[firstEl] || [];
            fieldErrors[firstEl].push(mapper(sub));
          } else {
            formErrors.push(mapper(sub));
          }
        }
        return { formErrors, fieldErrors };
      }
      get formErrors() {
        return this.flatten();
      }
    };
    ZodError.create = (issues) => {
      const error = new ZodError(issues);
      return error;
    };
  }
});

// node_modules/zod/v3/locales/en.js
var errorMap, en_default;
var init_en = __esm({
  "node_modules/zod/v3/locales/en.js"() {
    init_ZodError();
    init_util();
    errorMap = (issue, _ctx) => {
      let message;
      switch (issue.code) {
        case ZodIssueCode.invalid_type:
          if (issue.received === ZodParsedType.undefined) {
            message = "Required";
          } else {
            message = `Expected ${issue.expected}, received ${issue.received}`;
          }
          break;
        case ZodIssueCode.invalid_literal:
          message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
          break;
        case ZodIssueCode.unrecognized_keys:
          message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
          break;
        case ZodIssueCode.invalid_union:
          message = `Invalid input`;
          break;
        case ZodIssueCode.invalid_union_discriminator:
          message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
          break;
        case ZodIssueCode.invalid_enum_value:
          message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
          break;
        case ZodIssueCode.invalid_arguments:
          message = `Invalid function arguments`;
          break;
        case ZodIssueCode.invalid_return_type:
          message = `Invalid function return type`;
          break;
        case ZodIssueCode.invalid_date:
          message = `Invalid date`;
          break;
        case ZodIssueCode.invalid_string:
          if (typeof issue.validation === "object") {
            if ("includes" in issue.validation) {
              message = `Invalid input: must include "${issue.validation.includes}"`;
              if (typeof issue.validation.position === "number") {
                message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
              }
            } else if ("startsWith" in issue.validation) {
              message = `Invalid input: must start with "${issue.validation.startsWith}"`;
            } else if ("endsWith" in issue.validation) {
              message = `Invalid input: must end with "${issue.validation.endsWith}"`;
            } else {
              util.assertNever(issue.validation);
            }
          } else if (issue.validation !== "regex") {
            message = `Invalid ${issue.validation}`;
          } else {
            message = "Invalid";
          }
          break;
        case ZodIssueCode.too_small:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "bigint")
            message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
          else
            message = "Invalid input";
          break;
        case ZodIssueCode.too_big:
          if (issue.type === "array")
            message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
          else if (issue.type === "string")
            message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
          else if (issue.type === "number")
            message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "bigint")
            message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
          else if (issue.type === "date")
            message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
          else
            message = "Invalid input";
          break;
        case ZodIssueCode.custom:
          message = `Invalid input`;
          break;
        case ZodIssueCode.invalid_intersection_types:
          message = `Intersection results could not be merged`;
          break;
        case ZodIssueCode.not_multiple_of:
          message = `Number must be a multiple of ${issue.multipleOf}`;
          break;
        case ZodIssueCode.not_finite:
          message = "Number must be finite";
          break;
        default:
          message = _ctx.defaultError;
          util.assertNever(issue);
      }
      return { message };
    };
    en_default = errorMap;
  }
});

// node_modules/zod/v3/errors.js
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var overrideErrorMap;
var init_errors = __esm({
  "node_modules/zod/v3/errors.js"() {
    init_en();
    overrideErrorMap = en_default;
  }
});

// node_modules/zod/v3/helpers/parseUtil.js
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var makeIssue, EMPTY_PATH, ParseStatus, INVALID, DIRTY, OK, isAborted, isDirty, isValid, isAsync;
var init_parseUtil = __esm({
  "node_modules/zod/v3/helpers/parseUtil.js"() {
    init_errors();
    init_en();
    makeIssue = (params) => {
      const { data, path, errorMaps, issueData } = params;
      const fullPath = [...path, ...issueData.path || []];
      const fullIssue = {
        ...issueData,
        path: fullPath
      };
      if (issueData.message !== void 0) {
        return {
          ...issueData,
          path: fullPath,
          message: issueData.message
        };
      }
      let errorMessage = "";
      const maps = errorMaps.filter((m) => !!m).slice().reverse();
      for (const map of maps) {
        errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
      }
      return {
        ...issueData,
        path: fullPath,
        message: errorMessage
      };
    };
    EMPTY_PATH = [];
    ParseStatus = class _ParseStatus {
      constructor() {
        this.value = "valid";
      }
      dirty() {
        if (this.value === "valid")
          this.value = "dirty";
      }
      abort() {
        if (this.value !== "aborted")
          this.value = "aborted";
      }
      static mergeArray(status, results) {
        const arrayValue = [];
        for (const s of results) {
          if (s.status === "aborted")
            return INVALID;
          if (s.status === "dirty")
            status.dirty();
          arrayValue.push(s.value);
        }
        return { status: status.value, value: arrayValue };
      }
      static async mergeObjectAsync(status, pairs) {
        const syncPairs = [];
        for (const pair2 of pairs) {
          const key = await pair2.key;
          const value = await pair2.value;
          syncPairs.push({
            key,
            value
          });
        }
        return _ParseStatus.mergeObjectSync(status, syncPairs);
      }
      static mergeObjectSync(status, pairs) {
        const finalObject = {};
        for (const pair2 of pairs) {
          const { key, value } = pair2;
          if (key.status === "aborted")
            return INVALID;
          if (value.status === "aborted")
            return INVALID;
          if (key.status === "dirty")
            status.dirty();
          if (value.status === "dirty")
            status.dirty();
          if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair2.alwaysSet)) {
            finalObject[key.value] = value.value;
          }
        }
        return { status: status.value, value: finalObject };
      }
    };
    INVALID = Object.freeze({
      status: "aborted"
    });
    DIRTY = (value) => ({ status: "dirty", value });
    OK = (value) => ({ status: "valid", value });
    isAborted = (x) => x.status === "aborted";
    isDirty = (x) => x.status === "dirty";
    isValid = (x) => x.status === "valid";
    isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
  }
});

// node_modules/zod/v3/helpers/typeAliases.js
var init_typeAliases = __esm({
  "node_modules/zod/v3/helpers/typeAliases.js"() {
  }
});

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
var init_errorUtil = __esm({
  "node_modules/zod/v3/helpers/errorUtil.js"() {
    (function(errorUtil2) {
      errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
      errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
    })(errorUtil || (errorUtil = {}));
  }
});

// node_modules/zod/v3/types.js
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var ParseInputLazyPath, handleResult, ZodType, cuidRegex, cuid2Regex, ulidRegex, uuidRegex, nanoidRegex, jwtRegex, durationRegex, emailRegex, _emojiRegex, emojiRegex, ipv4Regex, ipv4CidrRegex, ipv6Regex, ipv6CidrRegex, base64Regex, base64urlRegex, dateRegexSource, dateRegex, ZodString, ZodNumber, ZodBigInt, ZodBoolean, ZodDate, ZodSymbol, ZodUndefined, ZodNull, ZodAny, ZodUnknown, ZodNever, ZodVoid, ZodArray, ZodObject, ZodUnion, getDiscriminator, ZodDiscriminatedUnion, ZodIntersection, ZodTuple, ZodRecord, ZodMap, ZodSet, ZodFunction, ZodLazy, ZodLiteral, ZodEnum, ZodNativeEnum, ZodPromise, ZodEffects, ZodOptional, ZodNullable, ZodDefault, ZodCatch, ZodNaN, BRAND, ZodBranded, ZodPipeline, ZodReadonly, late, ZodFirstPartyTypeKind, instanceOfType, stringType, numberType, nanType, bigIntType, booleanType, dateType, symbolType, undefinedType, nullType, anyType, unknownType, neverType, voidType, arrayType, objectType, strictObjectType, unionType, discriminatedUnionType, intersectionType, tupleType, recordType, mapType, setType, functionType, lazyType, literalType, enumType, nativeEnumType, promiseType, effectsType, optionalType, nullableType, preprocessType, pipelineType, ostring, onumber, oboolean, coerce, NEVER;
var init_types = __esm({
  "node_modules/zod/v3/types.js"() {
    init_ZodError();
    init_errors();
    init_errorUtil();
    init_parseUtil();
    init_util();
    ParseInputLazyPath = class {
      constructor(parent, value, path, key) {
        this._cachedPath = [];
        this.parent = parent;
        this.data = value;
        this._path = path;
        this._key = key;
      }
      get path() {
        if (!this._cachedPath.length) {
          if (Array.isArray(this._key)) {
            this._cachedPath.push(...this._path, ...this._key);
          } else {
            this._cachedPath.push(...this._path, this._key);
          }
        }
        return this._cachedPath;
      }
    };
    handleResult = (ctx, result) => {
      if (isValid(result)) {
        return { success: true, data: result.value };
      } else {
        if (!ctx.common.issues.length) {
          throw new Error("Validation failed but no issues detected.");
        }
        return {
          success: false,
          get error() {
            if (this._error)
              return this._error;
            const error = new ZodError(ctx.common.issues);
            this._error = error;
            return this._error;
          }
        };
      }
    };
    ZodType = class {
      get description() {
        return this._def.description;
      }
      _getType(input) {
        return getParsedType(input.data);
      }
      _getOrReturnCtx(input, ctx) {
        return ctx || {
          common: input.parent.common,
          data: input.data,
          parsedType: getParsedType(input.data),
          schemaErrorMap: this._def.errorMap,
          path: input.path,
          parent: input.parent
        };
      }
      _processInputParams(input) {
        return {
          status: new ParseStatus(),
          ctx: {
            common: input.parent.common,
            data: input.data,
            parsedType: getParsedType(input.data),
            schemaErrorMap: this._def.errorMap,
            path: input.path,
            parent: input.parent
          }
        };
      }
      _parseSync(input) {
        const result = this._parse(input);
        if (isAsync(result)) {
          throw new Error("Synchronous parse encountered promise.");
        }
        return result;
      }
      _parseAsync(input) {
        const result = this._parse(input);
        return Promise.resolve(result);
      }
      parse(data, params) {
        const result = this.safeParse(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      safeParse(data, params) {
        const ctx = {
          common: {
            issues: [],
            async: params?.async ?? false,
            contextualErrorMap: params?.errorMap
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        const result = this._parseSync({ data, path: ctx.path, parent: ctx });
        return handleResult(ctx, result);
      }
      "~validate"(data) {
        const ctx = {
          common: {
            issues: [],
            async: !!this["~standard"].async
          },
          path: [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        if (!this["~standard"].async) {
          try {
            const result = this._parseSync({ data, path: [], parent: ctx });
            return isValid(result) ? {
              value: result.value
            } : {
              issues: ctx.common.issues
            };
          } catch (err) {
            if (err?.message?.toLowerCase()?.includes("encountered")) {
              this["~standard"].async = true;
            }
            ctx.common = {
              issues: [],
              async: true
            };
          }
        }
        return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        });
      }
      async parseAsync(data, params) {
        const result = await this.safeParseAsync(data, params);
        if (result.success)
          return result.data;
        throw result.error;
      }
      async safeParseAsync(data, params) {
        const ctx = {
          common: {
            issues: [],
            contextualErrorMap: params?.errorMap,
            async: true
          },
          path: params?.path || [],
          schemaErrorMap: this._def.errorMap,
          parent: null,
          data,
          parsedType: getParsedType(data)
        };
        const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
        const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
        return handleResult(ctx, result);
      }
      refine(check, message) {
        const getIssueProperties = (val) => {
          if (typeof message === "string" || typeof message === "undefined") {
            return { message };
          } else if (typeof message === "function") {
            return message(val);
          } else {
            return message;
          }
        };
        return this._refinement((val, ctx) => {
          const result = check(val);
          const setError = () => ctx.addIssue({
            code: ZodIssueCode.custom,
            ...getIssueProperties(val)
          });
          if (typeof Promise !== "undefined" && result instanceof Promise) {
            return result.then((data) => {
              if (!data) {
                setError();
                return false;
              } else {
                return true;
              }
            });
          }
          if (!result) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      refinement(check, refinementData) {
        return this._refinement((val, ctx) => {
          if (!check(val)) {
            ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
            return false;
          } else {
            return true;
          }
        });
      }
      _refinement(refinement) {
        return new ZodEffects({
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "refinement", refinement }
        });
      }
      superRefine(refinement) {
        return this._refinement(refinement);
      }
      constructor(def) {
        this.spa = this.safeParseAsync;
        this._def = def;
        this.parse = this.parse.bind(this);
        this.safeParse = this.safeParse.bind(this);
        this.parseAsync = this.parseAsync.bind(this);
        this.safeParseAsync = this.safeParseAsync.bind(this);
        this.spa = this.spa.bind(this);
        this.refine = this.refine.bind(this);
        this.refinement = this.refinement.bind(this);
        this.superRefine = this.superRefine.bind(this);
        this.optional = this.optional.bind(this);
        this.nullable = this.nullable.bind(this);
        this.nullish = this.nullish.bind(this);
        this.array = this.array.bind(this);
        this.promise = this.promise.bind(this);
        this.or = this.or.bind(this);
        this.and = this.and.bind(this);
        this.transform = this.transform.bind(this);
        this.brand = this.brand.bind(this);
        this.default = this.default.bind(this);
        this.catch = this.catch.bind(this);
        this.describe = this.describe.bind(this);
        this.pipe = this.pipe.bind(this);
        this.readonly = this.readonly.bind(this);
        this.isNullable = this.isNullable.bind(this);
        this.isOptional = this.isOptional.bind(this);
        this["~standard"] = {
          version: 1,
          vendor: "zod",
          validate: (data) => this["~validate"](data)
        };
      }
      optional() {
        return ZodOptional.create(this, this._def);
      }
      nullable() {
        return ZodNullable.create(this, this._def);
      }
      nullish() {
        return this.nullable().optional();
      }
      array() {
        return ZodArray.create(this);
      }
      promise() {
        return ZodPromise.create(this, this._def);
      }
      or(option) {
        return ZodUnion.create([this, option], this._def);
      }
      and(incoming) {
        return ZodIntersection.create(this, incoming, this._def);
      }
      transform(transform) {
        return new ZodEffects({
          ...processCreateParams(this._def),
          schema: this,
          typeName: ZodFirstPartyTypeKind.ZodEffects,
          effect: { type: "transform", transform }
        });
      }
      default(def) {
        const defaultValueFunc = typeof def === "function" ? def : () => def;
        return new ZodDefault({
          ...processCreateParams(this._def),
          innerType: this,
          defaultValue: defaultValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodDefault
        });
      }
      brand() {
        return new ZodBranded({
          typeName: ZodFirstPartyTypeKind.ZodBranded,
          type: this,
          ...processCreateParams(this._def)
        });
      }
      catch(def) {
        const catchValueFunc = typeof def === "function" ? def : () => def;
        return new ZodCatch({
          ...processCreateParams(this._def),
          innerType: this,
          catchValue: catchValueFunc,
          typeName: ZodFirstPartyTypeKind.ZodCatch
        });
      }
      describe(description) {
        const This = this.constructor;
        return new This({
          ...this._def,
          description
        });
      }
      pipe(target) {
        return ZodPipeline.create(this, target);
      }
      readonly() {
        return ZodReadonly.create(this);
      }
      isOptional() {
        return this.safeParse(void 0).success;
      }
      isNullable() {
        return this.safeParse(null).success;
      }
    };
    cuidRegex = /^c[^\s-]{8,}$/i;
    cuid2Regex = /^[0-9a-z]+$/;
    ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
    uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
    nanoidRegex = /^[a-z0-9_-]{21}$/i;
    jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
    emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
    _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
    ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
    ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
    ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
    base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
    base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
    dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
    dateRegex = new RegExp(`^${dateRegexSource}$`);
    ZodString = class _ZodString extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = String(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.string) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.string,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        const status = new ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.length < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.length > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "string",
                inclusive: true,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "length") {
            const tooBig = input.data.length > check.value;
            const tooSmall = input.data.length < check.value;
            if (tooBig || tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              if (tooBig) {
                addIssueToContext(ctx, {
                  code: ZodIssueCode.too_big,
                  maximum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              } else if (tooSmall) {
                addIssueToContext(ctx, {
                  code: ZodIssueCode.too_small,
                  minimum: check.value,
                  type: "string",
                  inclusive: true,
                  exact: true,
                  message: check.message
                });
              }
              status.dirty();
            }
          } else if (check.kind === "email") {
            if (!emailRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "email",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "emoji") {
            if (!emojiRegex) {
              emojiRegex = new RegExp(_emojiRegex, "u");
            }
            if (!emojiRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "emoji",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "uuid") {
            if (!uuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "uuid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "nanoid") {
            if (!nanoidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "nanoid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid") {
            if (!cuidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cuid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cuid2") {
            if (!cuid2Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cuid2",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ulid") {
            if (!ulidRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "ulid",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "url") {
            try {
              new URL(input.data);
            } catch {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "url",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "regex") {
            check.regex.lastIndex = 0;
            const testResult = check.regex.test(input.data);
            if (!testResult) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "regex",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "trim") {
            input.data = input.data.trim();
          } else if (check.kind === "includes") {
            if (!input.data.includes(check.value, check.position)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { includes: check.value, position: check.position },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "toLowerCase") {
            input.data = input.data.toLowerCase();
          } else if (check.kind === "toUpperCase") {
            input.data = input.data.toUpperCase();
          } else if (check.kind === "startsWith") {
            if (!input.data.startsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { startsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "endsWith") {
            if (!input.data.endsWith(check.value)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: { endsWith: check.value },
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "datetime") {
            const regex = datetimeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "datetime",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "date") {
            const regex = dateRegex;
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "date",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "time") {
            const regex = timeRegex(check);
            if (!regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_string,
                validation: "time",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "duration") {
            if (!durationRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "duration",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "ip") {
            if (!isValidIP(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "ip",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "jwt") {
            if (!isValidJWT(input.data, check.alg)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "jwt",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "cidr") {
            if (!isValidCidr(input.data, check.version)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "cidr",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64") {
            if (!base64Regex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "base64",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "base64url") {
            if (!base64urlRegex.test(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                validation: "base64url",
                code: ZodIssueCode.invalid_string,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _regex(regex, validation, message) {
        return this.refinement((data) => regex.test(data), {
          validation,
          code: ZodIssueCode.invalid_string,
          ...errorUtil.errToObj(message)
        });
      }
      _addCheck(check) {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      email(message) {
        return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
      }
      url(message) {
        return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
      }
      emoji(message) {
        return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
      }
      uuid(message) {
        return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
      }
      nanoid(message) {
        return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
      }
      cuid(message) {
        return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
      }
      cuid2(message) {
        return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
      }
      ulid(message) {
        return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
      }
      base64(message) {
        return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
      }
      base64url(message) {
        return this._addCheck({
          kind: "base64url",
          ...errorUtil.errToObj(message)
        });
      }
      jwt(options) {
        return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
      }
      ip(options) {
        return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
      }
      cidr(options) {
        return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
      }
      datetime(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "datetime",
            precision: null,
            offset: false,
            local: false,
            message: options
          });
        }
        return this._addCheck({
          kind: "datetime",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          offset: options?.offset ?? false,
          local: options?.local ?? false,
          ...errorUtil.errToObj(options?.message)
        });
      }
      date(message) {
        return this._addCheck({ kind: "date", message });
      }
      time(options) {
        if (typeof options === "string") {
          return this._addCheck({
            kind: "time",
            precision: null,
            message: options
          });
        }
        return this._addCheck({
          kind: "time",
          precision: typeof options?.precision === "undefined" ? null : options?.precision,
          ...errorUtil.errToObj(options?.message)
        });
      }
      duration(message) {
        return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
      }
      regex(regex, message) {
        return this._addCheck({
          kind: "regex",
          regex,
          ...errorUtil.errToObj(message)
        });
      }
      includes(value, options) {
        return this._addCheck({
          kind: "includes",
          value,
          position: options?.position,
          ...errorUtil.errToObj(options?.message)
        });
      }
      startsWith(value, message) {
        return this._addCheck({
          kind: "startsWith",
          value,
          ...errorUtil.errToObj(message)
        });
      }
      endsWith(value, message) {
        return this._addCheck({
          kind: "endsWith",
          value,
          ...errorUtil.errToObj(message)
        });
      }
      min(minLength, message) {
        return this._addCheck({
          kind: "min",
          value: minLength,
          ...errorUtil.errToObj(message)
        });
      }
      max(maxLength, message) {
        return this._addCheck({
          kind: "max",
          value: maxLength,
          ...errorUtil.errToObj(message)
        });
      }
      length(len, message) {
        return this._addCheck({
          kind: "length",
          value: len,
          ...errorUtil.errToObj(message)
        });
      }
      /**
       * Equivalent to `.min(1)`
       */
      nonempty(message) {
        return this.min(1, errorUtil.errToObj(message));
      }
      trim() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "trim" }]
        });
      }
      toLowerCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toLowerCase" }]
        });
      }
      toUpperCase() {
        return new _ZodString({
          ...this._def,
          checks: [...this._def.checks, { kind: "toUpperCase" }]
        });
      }
      get isDatetime() {
        return !!this._def.checks.find((ch) => ch.kind === "datetime");
      }
      get isDate() {
        return !!this._def.checks.find((ch) => ch.kind === "date");
      }
      get isTime() {
        return !!this._def.checks.find((ch) => ch.kind === "time");
      }
      get isDuration() {
        return !!this._def.checks.find((ch) => ch.kind === "duration");
      }
      get isEmail() {
        return !!this._def.checks.find((ch) => ch.kind === "email");
      }
      get isURL() {
        return !!this._def.checks.find((ch) => ch.kind === "url");
      }
      get isEmoji() {
        return !!this._def.checks.find((ch) => ch.kind === "emoji");
      }
      get isUUID() {
        return !!this._def.checks.find((ch) => ch.kind === "uuid");
      }
      get isNANOID() {
        return !!this._def.checks.find((ch) => ch.kind === "nanoid");
      }
      get isCUID() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid");
      }
      get isCUID2() {
        return !!this._def.checks.find((ch) => ch.kind === "cuid2");
      }
      get isULID() {
        return !!this._def.checks.find((ch) => ch.kind === "ulid");
      }
      get isIP() {
        return !!this._def.checks.find((ch) => ch.kind === "ip");
      }
      get isCIDR() {
        return !!this._def.checks.find((ch) => ch.kind === "cidr");
      }
      get isBase64() {
        return !!this._def.checks.find((ch) => ch.kind === "base64");
      }
      get isBase64url() {
        return !!this._def.checks.find((ch) => ch.kind === "base64url");
      }
      get minLength() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxLength() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    ZodString.create = (params) => {
      return new ZodString({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodString,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    ZodNumber = class _ZodNumber extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
        this.step = this.multipleOf;
      }
      _parse(input) {
        if (this._def.coerce) {
          input.data = Number(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.number) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.number,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        let ctx = void 0;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "int") {
            if (!util.isInteger(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.invalid_type,
                expected: "integer",
                received: "float",
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "number",
                inclusive: check.inclusive,
                exact: false,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (floatSafeRemainder(input.data, check.value) !== 0) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "finite") {
            if (!Number.isFinite(input.data)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_finite,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodNumber({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodNumber({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      int(message) {
        return this._addCheck({
          kind: "int",
          message: errorUtil.toString(message)
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: 0,
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: 0,
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil.toString(message)
        });
      }
      finite(message) {
        return this._addCheck({
          kind: "finite",
          message: errorUtil.toString(message)
        });
      }
      safe(message) {
        return this._addCheck({
          kind: "min",
          inclusive: true,
          value: Number.MIN_SAFE_INTEGER,
          message: errorUtil.toString(message)
        })._addCheck({
          kind: "max",
          inclusive: true,
          value: Number.MAX_SAFE_INTEGER,
          message: errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
      get isInt() {
        return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
      }
      get isFinite() {
        let max = null;
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
            return true;
          } else if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          } else if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return Number.isFinite(min) && Number.isFinite(max);
      }
    };
    ZodNumber.create = (params) => {
      return new ZodNumber({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodNumber,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    ZodBigInt = class _ZodBigInt extends ZodType {
      constructor() {
        super(...arguments);
        this.min = this.gte;
        this.max = this.lte;
      }
      _parse(input) {
        if (this._def.coerce) {
          try {
            input.data = BigInt(input.data);
          } catch {
            return this._getInvalidInput(input);
          }
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.bigint) {
          return this._getInvalidInput(input);
        }
        let ctx = void 0;
        const status = new ParseStatus();
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
            if (tooSmall) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                type: "bigint",
                minimum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
            if (tooBig) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                type: "bigint",
                maximum: check.value,
                inclusive: check.inclusive,
                message: check.message
              });
              status.dirty();
            }
          } else if (check.kind === "multipleOf") {
            if (input.data % check.value !== BigInt(0)) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.not_multiple_of,
                multipleOf: check.value,
                message: check.message
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return { status: status.value, value: input.data };
      }
      _getInvalidInput(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.bigint,
          received: ctx.parsedType
        });
        return INVALID;
      }
      gte(value, message) {
        return this.setLimit("min", value, true, errorUtil.toString(message));
      }
      gt(value, message) {
        return this.setLimit("min", value, false, errorUtil.toString(message));
      }
      lte(value, message) {
        return this.setLimit("max", value, true, errorUtil.toString(message));
      }
      lt(value, message) {
        return this.setLimit("max", value, false, errorUtil.toString(message));
      }
      setLimit(kind, value, inclusive, message) {
        return new _ZodBigInt({
          ...this._def,
          checks: [
            ...this._def.checks,
            {
              kind,
              value,
              inclusive,
              message: errorUtil.toString(message)
            }
          ]
        });
      }
      _addCheck(check) {
        return new _ZodBigInt({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      positive(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      negative(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: false,
          message: errorUtil.toString(message)
        });
      }
      nonpositive(message) {
        return this._addCheck({
          kind: "max",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      nonnegative(message) {
        return this._addCheck({
          kind: "min",
          value: BigInt(0),
          inclusive: true,
          message: errorUtil.toString(message)
        });
      }
      multipleOf(value, message) {
        return this._addCheck({
          kind: "multipleOf",
          value,
          message: errorUtil.toString(message)
        });
      }
      get minValue() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min;
      }
      get maxValue() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max;
      }
    };
    ZodBigInt.create = (params) => {
      return new ZodBigInt({
        checks: [],
        typeName: ZodFirstPartyTypeKind.ZodBigInt,
        coerce: params?.coerce ?? false,
        ...processCreateParams(params)
      });
    };
    ZodBoolean = class extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = Boolean(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.boolean) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.boolean,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodBoolean.create = (params) => {
      return new ZodBoolean({
        typeName: ZodFirstPartyTypeKind.ZodBoolean,
        coerce: params?.coerce || false,
        ...processCreateParams(params)
      });
    };
    ZodDate = class _ZodDate extends ZodType {
      _parse(input) {
        if (this._def.coerce) {
          input.data = new Date(input.data);
        }
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.date) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.date,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        if (Number.isNaN(input.data.getTime())) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_date
          });
          return INVALID;
        }
        const status = new ParseStatus();
        let ctx = void 0;
        for (const check of this._def.checks) {
          if (check.kind === "min") {
            if (input.data.getTime() < check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                message: check.message,
                inclusive: true,
                exact: false,
                minimum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else if (check.kind === "max") {
            if (input.data.getTime() > check.value) {
              ctx = this._getOrReturnCtx(input, ctx);
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                message: check.message,
                inclusive: true,
                exact: false,
                maximum: check.value,
                type: "date"
              });
              status.dirty();
            }
          } else {
            util.assertNever(check);
          }
        }
        return {
          status: status.value,
          value: new Date(input.data.getTime())
        };
      }
      _addCheck(check) {
        return new _ZodDate({
          ...this._def,
          checks: [...this._def.checks, check]
        });
      }
      min(minDate, message) {
        return this._addCheck({
          kind: "min",
          value: minDate.getTime(),
          message: errorUtil.toString(message)
        });
      }
      max(maxDate, message) {
        return this._addCheck({
          kind: "max",
          value: maxDate.getTime(),
          message: errorUtil.toString(message)
        });
      }
      get minDate() {
        let min = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "min") {
            if (min === null || ch.value > min)
              min = ch.value;
          }
        }
        return min != null ? new Date(min) : null;
      }
      get maxDate() {
        let max = null;
        for (const ch of this._def.checks) {
          if (ch.kind === "max") {
            if (max === null || ch.value < max)
              max = ch.value;
          }
        }
        return max != null ? new Date(max) : null;
      }
    };
    ZodDate.create = (params) => {
      return new ZodDate({
        checks: [],
        coerce: params?.coerce || false,
        typeName: ZodFirstPartyTypeKind.ZodDate,
        ...processCreateParams(params)
      });
    };
    ZodSymbol = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.symbol) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.symbol,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodSymbol.create = (params) => {
      return new ZodSymbol({
        typeName: ZodFirstPartyTypeKind.ZodSymbol,
        ...processCreateParams(params)
      });
    };
    ZodUndefined = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.undefined,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodUndefined.create = (params) => {
      return new ZodUndefined({
        typeName: ZodFirstPartyTypeKind.ZodUndefined,
        ...processCreateParams(params)
      });
    };
    ZodNull = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.null) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.null,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodNull.create = (params) => {
      return new ZodNull({
        typeName: ZodFirstPartyTypeKind.ZodNull,
        ...processCreateParams(params)
      });
    };
    ZodAny = class extends ZodType {
      constructor() {
        super(...arguments);
        this._any = true;
      }
      _parse(input) {
        return OK(input.data);
      }
    };
    ZodAny.create = (params) => {
      return new ZodAny({
        typeName: ZodFirstPartyTypeKind.ZodAny,
        ...processCreateParams(params)
      });
    };
    ZodUnknown = class extends ZodType {
      constructor() {
        super(...arguments);
        this._unknown = true;
      }
      _parse(input) {
        return OK(input.data);
      }
    };
    ZodUnknown.create = (params) => {
      return new ZodUnknown({
        typeName: ZodFirstPartyTypeKind.ZodUnknown,
        ...processCreateParams(params)
      });
    };
    ZodNever = class extends ZodType {
      _parse(input) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.never,
          received: ctx.parsedType
        });
        return INVALID;
      }
    };
    ZodNever.create = (params) => {
      return new ZodNever({
        typeName: ZodFirstPartyTypeKind.ZodNever,
        ...processCreateParams(params)
      });
    };
    ZodVoid = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.undefined) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.void,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return OK(input.data);
      }
    };
    ZodVoid.create = (params) => {
      return new ZodVoid({
        typeName: ZodFirstPartyTypeKind.ZodVoid,
        ...processCreateParams(params)
      });
    };
    ZodArray = class _ZodArray extends ZodType {
      _parse(input) {
        const { ctx, status } = this._processInputParams(input);
        const def = this._def;
        if (ctx.parsedType !== ZodParsedType.array) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.array,
            received: ctx.parsedType
          });
          return INVALID;
        }
        if (def.exactLength !== null) {
          const tooBig = ctx.data.length > def.exactLength.value;
          const tooSmall = ctx.data.length < def.exactLength.value;
          if (tooBig || tooSmall) {
            addIssueToContext(ctx, {
              code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
              minimum: tooSmall ? def.exactLength.value : void 0,
              maximum: tooBig ? def.exactLength.value : void 0,
              type: "array",
              inclusive: true,
              exact: true,
              message: def.exactLength.message
            });
            status.dirty();
          }
        }
        if (def.minLength !== null) {
          if (ctx.data.length < def.minLength.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: def.minLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.minLength.message
            });
            status.dirty();
          }
        }
        if (def.maxLength !== null) {
          if (ctx.data.length > def.maxLength.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: def.maxLength.value,
              type: "array",
              inclusive: true,
              exact: false,
              message: def.maxLength.message
            });
            status.dirty();
          }
        }
        if (ctx.common.async) {
          return Promise.all([...ctx.data].map((item, i) => {
            return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
          })).then((result2) => {
            return ParseStatus.mergeArray(status, result2);
          });
        }
        const result = [...ctx.data].map((item, i) => {
          return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        });
        return ParseStatus.mergeArray(status, result);
      }
      get element() {
        return this._def.type;
      }
      min(minLength, message) {
        return new _ZodArray({
          ...this._def,
          minLength: { value: minLength, message: errorUtil.toString(message) }
        });
      }
      max(maxLength, message) {
        return new _ZodArray({
          ...this._def,
          maxLength: { value: maxLength, message: errorUtil.toString(message) }
        });
      }
      length(len, message) {
        return new _ZodArray({
          ...this._def,
          exactLength: { value: len, message: errorUtil.toString(message) }
        });
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    ZodArray.create = (schema, params) => {
      return new ZodArray({
        type: schema,
        minLength: null,
        maxLength: null,
        exactLength: null,
        typeName: ZodFirstPartyTypeKind.ZodArray,
        ...processCreateParams(params)
      });
    };
    ZodObject = class _ZodObject extends ZodType {
      constructor() {
        super(...arguments);
        this._cached = null;
        this.nonstrict = this.passthrough;
        this.augment = this.extend;
      }
      _getCached() {
        if (this._cached !== null)
          return this._cached;
        const shape = this._def.shape();
        const keys = util.objectKeys(shape);
        this._cached = { shape, keys };
        return this._cached;
      }
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.object) {
          const ctx2 = this._getOrReturnCtx(input);
          addIssueToContext(ctx2, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx2.parsedType
          });
          return INVALID;
        }
        const { status, ctx } = this._processInputParams(input);
        const { shape, keys: shapeKeys } = this._getCached();
        const extraKeys = [];
        if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
          for (const key in ctx.data) {
            if (!shapeKeys.includes(key)) {
              extraKeys.push(key);
            }
          }
        }
        const pairs = [];
        for (const key of shapeKeys) {
          const keyValidator = shape[key];
          const value = ctx.data[key];
          pairs.push({
            key: { status: "valid", value: key },
            value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (this._def.catchall instanceof ZodNever) {
          const unknownKeys = this._def.unknownKeys;
          if (unknownKeys === "passthrough") {
            for (const key of extraKeys) {
              pairs.push({
                key: { status: "valid", value: key },
                value: { status: "valid", value: ctx.data[key] }
              });
            }
          } else if (unknownKeys === "strict") {
            if (extraKeys.length > 0) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.unrecognized_keys,
                keys: extraKeys
              });
              status.dirty();
            }
          } else if (unknownKeys === "strip") {
          } else {
            throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
          }
        } else {
          const catchall = this._def.catchall;
          for (const key of extraKeys) {
            const value = ctx.data[key];
            pairs.push({
              key: { status: "valid", value: key },
              value: catchall._parse(
                new ParseInputLazyPath(ctx, value, ctx.path, key)
                //, ctx.child(key), value, getParsedType(value)
              ),
              alwaysSet: key in ctx.data
            });
          }
        }
        if (ctx.common.async) {
          return Promise.resolve().then(async () => {
            const syncPairs = [];
            for (const pair2 of pairs) {
              const key = await pair2.key;
              const value = await pair2.value;
              syncPairs.push({
                key,
                value,
                alwaysSet: pair2.alwaysSet
              });
            }
            return syncPairs;
          }).then((syncPairs) => {
            return ParseStatus.mergeObjectSync(status, syncPairs);
          });
        } else {
          return ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get shape() {
        return this._def.shape();
      }
      strict(message) {
        errorUtil.errToObj;
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strict",
          ...message !== void 0 ? {
            errorMap: (issue, ctx) => {
              const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
              if (issue.code === "unrecognized_keys")
                return {
                  message: errorUtil.errToObj(message).message ?? defaultError
                };
              return {
                message: defaultError
              };
            }
          } : {}
        });
      }
      strip() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "strip"
        });
      }
      passthrough() {
        return new _ZodObject({
          ...this._def,
          unknownKeys: "passthrough"
        });
      }
      // const AugmentFactory =
      //   <Def extends ZodObjectDef>(def: Def) =>
      //   <Augmentation extends ZodRawShape>(
      //     augmentation: Augmentation
      //   ): ZodObject<
      //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
      //     Def["unknownKeys"],
      //     Def["catchall"]
      //   > => {
      //     return new ZodObject({
      //       ...def,
      //       shape: () => ({
      //         ...def.shape(),
      //         ...augmentation,
      //       }),
      //     }) as any;
      //   };
      extend(augmentation) {
        return new _ZodObject({
          ...this._def,
          shape: () => ({
            ...this._def.shape(),
            ...augmentation
          })
        });
      }
      /**
       * Prior to zod@1.0.12 there was a bug in the
       * inferred type of merged objects. Please
       * upgrade if you are experiencing issues.
       */
      merge(merging) {
        const merged = new _ZodObject({
          unknownKeys: merging._def.unknownKeys,
          catchall: merging._def.catchall,
          shape: () => ({
            ...this._def.shape(),
            ...merging._def.shape()
          }),
          typeName: ZodFirstPartyTypeKind.ZodObject
        });
        return merged;
      }
      // merge<
      //   Incoming extends AnyZodObject,
      //   Augmentation extends Incoming["shape"],
      //   NewOutput extends {
      //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
      //       ? Augmentation[k]["_output"]
      //       : k extends keyof Output
      //       ? Output[k]
      //       : never;
      //   },
      //   NewInput extends {
      //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
      //       ? Augmentation[k]["_input"]
      //       : k extends keyof Input
      //       ? Input[k]
      //       : never;
      //   }
      // >(
      //   merging: Incoming
      // ): ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"],
      //   NewOutput,
      //   NewInput
      // > {
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      setKey(key, schema) {
        return this.augment({ [key]: schema });
      }
      // merge<Incoming extends AnyZodObject>(
      //   merging: Incoming
      // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
      // ZodObject<
      //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
      //   Incoming["_def"]["unknownKeys"],
      //   Incoming["_def"]["catchall"]
      // > {
      //   // const mergedShape = objectUtil.mergeShapes(
      //   //   this._def.shape(),
      //   //   merging._def.shape()
      //   // );
      //   const merged: any = new ZodObject({
      //     unknownKeys: merging._def.unknownKeys,
      //     catchall: merging._def.catchall,
      //     shape: () =>
      //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
      //     typeName: ZodFirstPartyTypeKind.ZodObject,
      //   }) as any;
      //   return merged;
      // }
      catchall(index) {
        return new _ZodObject({
          ...this._def,
          catchall: index
        });
      }
      pick(mask) {
        const shape = {};
        for (const key of util.objectKeys(mask)) {
          if (mask[key] && this.shape[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      omit(mask) {
        const shape = {};
        for (const key of util.objectKeys(this.shape)) {
          if (!mask[key]) {
            shape[key] = this.shape[key];
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => shape
        });
      }
      /**
       * @deprecated
       */
      deepPartial() {
        return deepPartialify(this);
      }
      partial(mask) {
        const newShape = {};
        for (const key of util.objectKeys(this.shape)) {
          const fieldSchema = this.shape[key];
          if (mask && !mask[key]) {
            newShape[key] = fieldSchema;
          } else {
            newShape[key] = fieldSchema.optional();
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      required(mask) {
        const newShape = {};
        for (const key of util.objectKeys(this.shape)) {
          if (mask && !mask[key]) {
            newShape[key] = this.shape[key];
          } else {
            const fieldSchema = this.shape[key];
            let newField = fieldSchema;
            while (newField instanceof ZodOptional) {
              newField = newField._def.innerType;
            }
            newShape[key] = newField;
          }
        }
        return new _ZodObject({
          ...this._def,
          shape: () => newShape
        });
      }
      keyof() {
        return createZodEnum(util.objectKeys(this.shape));
      }
    };
    ZodObject.create = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.strictCreate = (shape, params) => {
      return new ZodObject({
        shape: () => shape,
        unknownKeys: "strict",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodObject.lazycreate = (shape, params) => {
      return new ZodObject({
        shape,
        unknownKeys: "strip",
        catchall: ZodNever.create(),
        typeName: ZodFirstPartyTypeKind.ZodObject,
        ...processCreateParams(params)
      });
    };
    ZodUnion = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const options = this._def.options;
        function handleResults(results) {
          for (const result of results) {
            if (result.result.status === "valid") {
              return result.result;
            }
          }
          for (const result of results) {
            if (result.result.status === "dirty") {
              ctx.common.issues.push(...result.ctx.common.issues);
              return result.result;
            }
          }
          const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union,
            unionErrors
          });
          return INVALID;
        }
        if (ctx.common.async) {
          return Promise.all(options.map(async (option) => {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            return {
              result: await option._parseAsync({
                data: ctx.data,
                path: ctx.path,
                parent: childCtx
              }),
              ctx: childCtx
            };
          })).then(handleResults);
        } else {
          let dirty = void 0;
          const issues = [];
          for (const option of options) {
            const childCtx = {
              ...ctx,
              common: {
                ...ctx.common,
                issues: []
              },
              parent: null
            };
            const result = option._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: childCtx
            });
            if (result.status === "valid") {
              return result;
            } else if (result.status === "dirty" && !dirty) {
              dirty = { result, ctx: childCtx };
            }
            if (childCtx.common.issues.length) {
              issues.push(childCtx.common.issues);
            }
          }
          if (dirty) {
            ctx.common.issues.push(...dirty.ctx.common.issues);
            return dirty.result;
          }
          const unionErrors = issues.map((issues2) => new ZodError(issues2));
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union,
            unionErrors
          });
          return INVALID;
        }
      }
      get options() {
        return this._def.options;
      }
    };
    ZodUnion.create = (types, params) => {
      return new ZodUnion({
        options: types,
        typeName: ZodFirstPartyTypeKind.ZodUnion,
        ...processCreateParams(params)
      });
    };
    getDiscriminator = (type) => {
      if (type instanceof ZodLazy) {
        return getDiscriminator(type.schema);
      } else if (type instanceof ZodEffects) {
        return getDiscriminator(type.innerType());
      } else if (type instanceof ZodLiteral) {
        return [type.value];
      } else if (type instanceof ZodEnum) {
        return type.options;
      } else if (type instanceof ZodNativeEnum) {
        return util.objectValues(type.enum);
      } else if (type instanceof ZodDefault) {
        return getDiscriminator(type._def.innerType);
      } else if (type instanceof ZodUndefined) {
        return [void 0];
      } else if (type instanceof ZodNull) {
        return [null];
      } else if (type instanceof ZodOptional) {
        return [void 0, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodNullable) {
        return [null, ...getDiscriminator(type.unwrap())];
      } else if (type instanceof ZodBranded) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodReadonly) {
        return getDiscriminator(type.unwrap());
      } else if (type instanceof ZodCatch) {
        return getDiscriminator(type._def.innerType);
      } else {
        return [];
      }
    };
    ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const discriminator = this.discriminator;
        const discriminatorValue = ctx.data[discriminator];
        const option = this.optionsMap.get(discriminatorValue);
        if (!option) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_union_discriminator,
            options: Array.from(this.optionsMap.keys()),
            path: [discriminator]
          });
          return INVALID;
        }
        if (ctx.common.async) {
          return option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        } else {
          return option._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
        }
      }
      get discriminator() {
        return this._def.discriminator;
      }
      get options() {
        return this._def.options;
      }
      get optionsMap() {
        return this._def.optionsMap;
      }
      /**
       * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
       * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
       * have a different value for each object in the union.
       * @param discriminator the name of the discriminator property
       * @param types an array of object schemas
       * @param params
       */
      static create(discriminator, options, params) {
        const optionsMap = /* @__PURE__ */ new Map();
        for (const type of options) {
          const discriminatorValues = getDiscriminator(type.shape[discriminator]);
          if (!discriminatorValues.length) {
            throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
          }
          for (const value of discriminatorValues) {
            if (optionsMap.has(value)) {
              throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
            }
            optionsMap.set(value, type);
          }
        }
        return new _ZodDiscriminatedUnion({
          typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
          discriminator,
          options,
          optionsMap,
          ...processCreateParams(params)
        });
      }
    };
    ZodIntersection = class extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const handleParsed = (parsedLeft, parsedRight) => {
          if (isAborted(parsedLeft) || isAborted(parsedRight)) {
            return INVALID;
          }
          const merged = mergeValues(parsedLeft.value, parsedRight.value);
          if (!merged.valid) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_intersection_types
            });
            return INVALID;
          }
          if (isDirty(parsedLeft) || isDirty(parsedRight)) {
            status.dirty();
          }
          return { status: status.value, value: merged.data };
        };
        if (ctx.common.async) {
          return Promise.all([
            this._def.left._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            }),
            this._def.right._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            })
          ]).then(([left, right]) => handleParsed(left, right));
        } else {
          return handleParsed(this._def.left._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }), this._def.right._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }));
        }
      }
    };
    ZodIntersection.create = (left, right, params) => {
      return new ZodIntersection({
        left,
        right,
        typeName: ZodFirstPartyTypeKind.ZodIntersection,
        ...processCreateParams(params)
      });
    };
    ZodTuple = class _ZodTuple extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.array) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.array,
            received: ctx.parsedType
          });
          return INVALID;
        }
        if (ctx.data.length < this._def.items.length) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          return INVALID;
        }
        const rest = this._def.rest;
        if (!rest && ctx.data.length > this._def.items.length) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: this._def.items.length,
            inclusive: true,
            exact: false,
            type: "array"
          });
          status.dirty();
        }
        const items = [...ctx.data].map((item, itemIndex) => {
          const schema = this._def.items[itemIndex] || this._def.rest;
          if (!schema)
            return null;
          return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
        }).filter((x) => !!x);
        if (ctx.common.async) {
          return Promise.all(items).then((results) => {
            return ParseStatus.mergeArray(status, results);
          });
        } else {
          return ParseStatus.mergeArray(status, items);
        }
      }
      get items() {
        return this._def.items;
      }
      rest(rest) {
        return new _ZodTuple({
          ...this._def,
          rest
        });
      }
    };
    ZodTuple.create = (schemas, params) => {
      if (!Array.isArray(schemas)) {
        throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
      }
      return new ZodTuple({
        items: schemas,
        typeName: ZodFirstPartyTypeKind.ZodTuple,
        rest: null,
        ...processCreateParams(params)
      });
    };
    ZodRecord = class _ZodRecord extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.object) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.object,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const pairs = [];
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        for (const key in ctx.data) {
          pairs.push({
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
            value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
        if (ctx.common.async) {
          return ParseStatus.mergeObjectAsync(status, pairs);
        } else {
          return ParseStatus.mergeObjectSync(status, pairs);
        }
      }
      get element() {
        return this._def.valueType;
      }
      static create(first, second, third) {
        if (second instanceof ZodType) {
          return new _ZodRecord({
            keyType: first,
            valueType: second,
            typeName: ZodFirstPartyTypeKind.ZodRecord,
            ...processCreateParams(third)
          });
        }
        return new _ZodRecord({
          keyType: ZodString.create(),
          valueType: first,
          typeName: ZodFirstPartyTypeKind.ZodRecord,
          ...processCreateParams(second)
        });
      }
    };
    ZodMap = class extends ZodType {
      get keySchema() {
        return this._def.keyType;
      }
      get valueSchema() {
        return this._def.valueType;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.map) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.map,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const keyType = this._def.keyType;
        const valueType = this._def.valueType;
        const pairs = [...ctx.data.entries()].map(([key, value], index) => {
          return {
            key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
            value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
          };
        });
        if (ctx.common.async) {
          const finalMap = /* @__PURE__ */ new Map();
          return Promise.resolve().then(async () => {
            for (const pair2 of pairs) {
              const key = await pair2.key;
              const value = await pair2.value;
              if (key.status === "aborted" || value.status === "aborted") {
                return INVALID;
              }
              if (key.status === "dirty" || value.status === "dirty") {
                status.dirty();
              }
              finalMap.set(key.value, value.value);
            }
            return { status: status.value, value: finalMap };
          });
        } else {
          const finalMap = /* @__PURE__ */ new Map();
          for (const pair2 of pairs) {
            const key = pair2.key;
            const value = pair2.value;
            if (key.status === "aborted" || value.status === "aborted") {
              return INVALID;
            }
            if (key.status === "dirty" || value.status === "dirty") {
              status.dirty();
            }
            finalMap.set(key.value, value.value);
          }
          return { status: status.value, value: finalMap };
        }
      }
    };
    ZodMap.create = (keyType, valueType, params) => {
      return new ZodMap({
        valueType,
        keyType,
        typeName: ZodFirstPartyTypeKind.ZodMap,
        ...processCreateParams(params)
      });
    };
    ZodSet = class _ZodSet extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.set) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.set,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const def = this._def;
        if (def.minSize !== null) {
          if (ctx.data.size < def.minSize.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: def.minSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.minSize.message
            });
            status.dirty();
          }
        }
        if (def.maxSize !== null) {
          if (ctx.data.size > def.maxSize.value) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: def.maxSize.value,
              type: "set",
              inclusive: true,
              exact: false,
              message: def.maxSize.message
            });
            status.dirty();
          }
        }
        const valueType = this._def.valueType;
        function finalizeSet(elements2) {
          const parsedSet = /* @__PURE__ */ new Set();
          for (const element of elements2) {
            if (element.status === "aborted")
              return INVALID;
            if (element.status === "dirty")
              status.dirty();
            parsedSet.add(element.value);
          }
          return { status: status.value, value: parsedSet };
        }
        const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
        if (ctx.common.async) {
          return Promise.all(elements).then((elements2) => finalizeSet(elements2));
        } else {
          return finalizeSet(elements);
        }
      }
      min(minSize, message) {
        return new _ZodSet({
          ...this._def,
          minSize: { value: minSize, message: errorUtil.toString(message) }
        });
      }
      max(maxSize, message) {
        return new _ZodSet({
          ...this._def,
          maxSize: { value: maxSize, message: errorUtil.toString(message) }
        });
      }
      size(size, message) {
        return this.min(size, message).max(size, message);
      }
      nonempty(message) {
        return this.min(1, message);
      }
    };
    ZodSet.create = (valueType, params) => {
      return new ZodSet({
        valueType,
        minSize: null,
        maxSize: null,
        typeName: ZodFirstPartyTypeKind.ZodSet,
        ...processCreateParams(params)
      });
    };
    ZodFunction = class _ZodFunction extends ZodType {
      constructor() {
        super(...arguments);
        this.validate = this.implement;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.function) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.function,
            received: ctx.parsedType
          });
          return INVALID;
        }
        function makeArgsIssue(args, error) {
          return makeIssue({
            data: args,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
            issueData: {
              code: ZodIssueCode.invalid_arguments,
              argumentsError: error
            }
          });
        }
        function makeReturnsIssue(returns, error) {
          return makeIssue({
            data: returns,
            path: ctx.path,
            errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
            issueData: {
              code: ZodIssueCode.invalid_return_type,
              returnTypeError: error
            }
          });
        }
        const params = { errorMap: ctx.common.contextualErrorMap };
        const fn = ctx.data;
        if (this._def.returns instanceof ZodPromise) {
          const me = this;
          return OK(async function(...args) {
            const error = new ZodError([]);
            const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
              error.addIssue(makeArgsIssue(args, e));
              throw error;
            });
            const result = await Reflect.apply(fn, this, parsedArgs);
            const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
              error.addIssue(makeReturnsIssue(result, e));
              throw error;
            });
            return parsedReturns;
          });
        } else {
          const me = this;
          return OK(function(...args) {
            const parsedArgs = me._def.args.safeParse(args, params);
            if (!parsedArgs.success) {
              throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
            }
            const result = Reflect.apply(fn, this, parsedArgs.data);
            const parsedReturns = me._def.returns.safeParse(result, params);
            if (!parsedReturns.success) {
              throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
            }
            return parsedReturns.data;
          });
        }
      }
      parameters() {
        return this._def.args;
      }
      returnType() {
        return this._def.returns;
      }
      args(...items) {
        return new _ZodFunction({
          ...this._def,
          args: ZodTuple.create(items).rest(ZodUnknown.create())
        });
      }
      returns(returnType) {
        return new _ZodFunction({
          ...this._def,
          returns: returnType
        });
      }
      implement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      strictImplement(func) {
        const validatedFunc = this.parse(func);
        return validatedFunc;
      }
      static create(args, returns, params) {
        return new _ZodFunction({
          args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
          returns: returns || ZodUnknown.create(),
          typeName: ZodFirstPartyTypeKind.ZodFunction,
          ...processCreateParams(params)
        });
      }
    };
    ZodLazy = class extends ZodType {
      get schema() {
        return this._def.getter();
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const lazySchema = this._def.getter();
        return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
      }
    };
    ZodLazy.create = (getter, params) => {
      return new ZodLazy({
        getter,
        typeName: ZodFirstPartyTypeKind.ZodLazy,
        ...processCreateParams(params)
      });
    };
    ZodLiteral = class extends ZodType {
      _parse(input) {
        if (input.data !== this._def.value) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_literal,
            expected: this._def.value
          });
          return INVALID;
        }
        return { status: "valid", value: input.data };
      }
      get value() {
        return this._def.value;
      }
    };
    ZodLiteral.create = (value, params) => {
      return new ZodLiteral({
        value,
        typeName: ZodFirstPartyTypeKind.ZodLiteral,
        ...processCreateParams(params)
      });
    };
    ZodEnum = class _ZodEnum extends ZodType {
      _parse(input) {
        if (typeof input.data !== "string") {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          addIssueToContext(ctx, {
            expected: util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodIssueCode.invalid_type
          });
          return INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(this._def.values);
        }
        if (!this._cache.has(input.data)) {
          const ctx = this._getOrReturnCtx(input);
          const expectedValues = this._def.values;
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return INVALID;
        }
        return OK(input.data);
      }
      get options() {
        return this._def.values;
      }
      get enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Values() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      get Enum() {
        const enumValues = {};
        for (const val of this._def.values) {
          enumValues[val] = val;
        }
        return enumValues;
      }
      extract(values, newDef = this._def) {
        return _ZodEnum.create(values, {
          ...this._def,
          ...newDef
        });
      }
      exclude(values, newDef = this._def) {
        return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
          ...this._def,
          ...newDef
        });
      }
    };
    ZodEnum.create = createZodEnum;
    ZodNativeEnum = class extends ZodType {
      _parse(input) {
        const nativeEnumValues = util.getValidEnumValues(this._def.values);
        const ctx = this._getOrReturnCtx(input);
        if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
          const expectedValues = util.objectValues(nativeEnumValues);
          addIssueToContext(ctx, {
            expected: util.joinValues(expectedValues),
            received: ctx.parsedType,
            code: ZodIssueCode.invalid_type
          });
          return INVALID;
        }
        if (!this._cache) {
          this._cache = new Set(util.getValidEnumValues(this._def.values));
        }
        if (!this._cache.has(input.data)) {
          const expectedValues = util.objectValues(nativeEnumValues);
          addIssueToContext(ctx, {
            received: ctx.data,
            code: ZodIssueCode.invalid_enum_value,
            options: expectedValues
          });
          return INVALID;
        }
        return OK(input.data);
      }
      get enum() {
        return this._def.values;
      }
    };
    ZodNativeEnum.create = (values, params) => {
      return new ZodNativeEnum({
        values,
        typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
        ...processCreateParams(params)
      });
    };
    ZodPromise = class extends ZodType {
      unwrap() {
        return this._def.type;
      }
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.promise,
            received: ctx.parsedType
          });
          return INVALID;
        }
        const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
        return OK(promisified.then((data) => {
          return this._def.type.parseAsync(data, {
            path: ctx.path,
            errorMap: ctx.common.contextualErrorMap
          });
        }));
      }
    };
    ZodPromise.create = (schema, params) => {
      return new ZodPromise({
        type: schema,
        typeName: ZodFirstPartyTypeKind.ZodPromise,
        ...processCreateParams(params)
      });
    };
    ZodEffects = class extends ZodType {
      innerType() {
        return this._def.schema;
      }
      sourceType() {
        return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
      }
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        const effect = this._def.effect || null;
        const checkCtx = {
          addIssue: (arg) => {
            addIssueToContext(ctx, arg);
            if (arg.fatal) {
              status.abort();
            } else {
              status.dirty();
            }
          },
          get path() {
            return ctx.path;
          }
        };
        checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
        if (effect.type === "preprocess") {
          const processed = effect.transform(ctx.data, checkCtx);
          if (ctx.common.async) {
            return Promise.resolve(processed).then(async (processed2) => {
              if (status.value === "aborted")
                return INVALID;
              const result = await this._def.schema._parseAsync({
                data: processed2,
                path: ctx.path,
                parent: ctx
              });
              if (result.status === "aborted")
                return INVALID;
              if (result.status === "dirty")
                return DIRTY(result.value);
              if (status.value === "dirty")
                return DIRTY(result.value);
              return result;
            });
          } else {
            if (status.value === "aborted")
              return INVALID;
            const result = this._def.schema._parseSync({
              data: processed,
              path: ctx.path,
              parent: ctx
            });
            if (result.status === "aborted")
              return INVALID;
            if (result.status === "dirty")
              return DIRTY(result.value);
            if (status.value === "dirty")
              return DIRTY(result.value);
            return result;
          }
        }
        if (effect.type === "refinement") {
          const executeRefinement = (acc) => {
            const result = effect.refinement(acc, checkCtx);
            if (ctx.common.async) {
              return Promise.resolve(result);
            }
            if (result instanceof Promise) {
              throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
            }
            return acc;
          };
          if (ctx.common.async === false) {
            const inner = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inner.status === "aborted")
              return INVALID;
            if (inner.status === "dirty")
              status.dirty();
            executeRefinement(inner.value);
            return { status: status.value, value: inner.value };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
              if (inner.status === "aborted")
                return INVALID;
              if (inner.status === "dirty")
                status.dirty();
              return executeRefinement(inner.value).then(() => {
                return { status: status.value, value: inner.value };
              });
            });
          }
        }
        if (effect.type === "transform") {
          if (ctx.common.async === false) {
            const base = this._def.schema._parseSync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (!isValid(base))
              return INVALID;
            const result = effect.transform(base.value, checkCtx);
            if (result instanceof Promise) {
              throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
            }
            return { status: status.value, value: result };
          } else {
            return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
              if (!isValid(base))
                return INVALID;
              return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
                status: status.value,
                value: result
              }));
            });
          }
        }
        util.assertNever(effect);
      }
    };
    ZodEffects.create = (schema, effect, params) => {
      return new ZodEffects({
        schema,
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        effect,
        ...processCreateParams(params)
      });
    };
    ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
      return new ZodEffects({
        schema,
        effect: { type: "preprocess", transform: preprocess },
        typeName: ZodFirstPartyTypeKind.ZodEffects,
        ...processCreateParams(params)
      });
    };
    ZodOptional = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.undefined) {
          return OK(void 0);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodOptional.create = (type, params) => {
      return new ZodOptional({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodOptional,
        ...processCreateParams(params)
      });
    };
    ZodNullable = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType === ZodParsedType.null) {
          return OK(null);
        }
        return this._def.innerType._parse(input);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodNullable.create = (type, params) => {
      return new ZodNullable({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodNullable,
        ...processCreateParams(params)
      });
    };
    ZodDefault = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        let data = ctx.data;
        if (ctx.parsedType === ZodParsedType.undefined) {
          data = this._def.defaultValue();
        }
        return this._def.innerType._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      removeDefault() {
        return this._def.innerType;
      }
    };
    ZodDefault.create = (type, params) => {
      return new ZodDefault({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodDefault,
        defaultValue: typeof params.default === "function" ? params.default : () => params.default,
        ...processCreateParams(params)
      });
    };
    ZodCatch = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const newCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          }
        };
        const result = this._def.innerType._parse({
          data: newCtx.data,
          path: newCtx.path,
          parent: {
            ...newCtx
          }
        });
        if (isAsync(result)) {
          return result.then((result2) => {
            return {
              status: "valid",
              value: result2.status === "valid" ? result2.value : this._def.catchValue({
                get error() {
                  return new ZodError(newCtx.common.issues);
                },
                input: newCtx.data
              })
            };
          });
        } else {
          return {
            status: "valid",
            value: result.status === "valid" ? result.value : this._def.catchValue({
              get error() {
                return new ZodError(newCtx.common.issues);
              },
              input: newCtx.data
            })
          };
        }
      }
      removeCatch() {
        return this._def.innerType;
      }
    };
    ZodCatch.create = (type, params) => {
      return new ZodCatch({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodCatch,
        catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
        ...processCreateParams(params)
      });
    };
    ZodNaN = class extends ZodType {
      _parse(input) {
        const parsedType = this._getType(input);
        if (parsedType !== ZodParsedType.nan) {
          const ctx = this._getOrReturnCtx(input);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: ZodParsedType.nan,
            received: ctx.parsedType
          });
          return INVALID;
        }
        return { status: "valid", value: input.data };
      }
    };
    ZodNaN.create = (params) => {
      return new ZodNaN({
        typeName: ZodFirstPartyTypeKind.ZodNaN,
        ...processCreateParams(params)
      });
    };
    BRAND = /* @__PURE__ */ Symbol("zod_brand");
    ZodBranded = class extends ZodType {
      _parse(input) {
        const { ctx } = this._processInputParams(input);
        const data = ctx.data;
        return this._def.type._parse({
          data,
          path: ctx.path,
          parent: ctx
        });
      }
      unwrap() {
        return this._def.type;
      }
    };
    ZodPipeline = class _ZodPipeline extends ZodType {
      _parse(input) {
        const { status, ctx } = this._processInputParams(input);
        if (ctx.common.async) {
          const handleAsync = async () => {
            const inResult = await this._def.in._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: ctx
            });
            if (inResult.status === "aborted")
              return INVALID;
            if (inResult.status === "dirty") {
              status.dirty();
              return DIRTY(inResult.value);
            } else {
              return this._def.out._parseAsync({
                data: inResult.value,
                path: ctx.path,
                parent: ctx
              });
            }
          };
          return handleAsync();
        } else {
          const inResult = this._def.in._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inResult.status === "aborted")
            return INVALID;
          if (inResult.status === "dirty") {
            status.dirty();
            return {
              status: "dirty",
              value: inResult.value
            };
          } else {
            return this._def.out._parseSync({
              data: inResult.value,
              path: ctx.path,
              parent: ctx
            });
          }
        }
      }
      static create(a, b) {
        return new _ZodPipeline({
          in: a,
          out: b,
          typeName: ZodFirstPartyTypeKind.ZodPipeline
        });
      }
    };
    ZodReadonly = class extends ZodType {
      _parse(input) {
        const result = this._def.innerType._parse(input);
        const freeze = (data) => {
          if (isValid(data)) {
            data.value = Object.freeze(data.value);
          }
          return data;
        };
        return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
      }
      unwrap() {
        return this._def.innerType;
      }
    };
    ZodReadonly.create = (type, params) => {
      return new ZodReadonly({
        innerType: type,
        typeName: ZodFirstPartyTypeKind.ZodReadonly,
        ...processCreateParams(params)
      });
    };
    late = {
      object: ZodObject.lazycreate
    };
    (function(ZodFirstPartyTypeKind2) {
      ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
      ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
      ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
      ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
      ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
      ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
      ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
      ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
      ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
      ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
      ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
      ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
      ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
      ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
      ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
      ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
      ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
      ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
      ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
      ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
      ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
      ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
      ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
      ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
      ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
      ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
      ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
      ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
      ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
      ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
      ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
      ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
      ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
      ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
      ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
      ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
    })(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
    instanceOfType = (cls, params = {
      message: `Input not instance of ${cls.name}`
    }) => custom((data) => data instanceof cls, params);
    stringType = ZodString.create;
    numberType = ZodNumber.create;
    nanType = ZodNaN.create;
    bigIntType = ZodBigInt.create;
    booleanType = ZodBoolean.create;
    dateType = ZodDate.create;
    symbolType = ZodSymbol.create;
    undefinedType = ZodUndefined.create;
    nullType = ZodNull.create;
    anyType = ZodAny.create;
    unknownType = ZodUnknown.create;
    neverType = ZodNever.create;
    voidType = ZodVoid.create;
    arrayType = ZodArray.create;
    objectType = ZodObject.create;
    strictObjectType = ZodObject.strictCreate;
    unionType = ZodUnion.create;
    discriminatedUnionType = ZodDiscriminatedUnion.create;
    intersectionType = ZodIntersection.create;
    tupleType = ZodTuple.create;
    recordType = ZodRecord.create;
    mapType = ZodMap.create;
    setType = ZodSet.create;
    functionType = ZodFunction.create;
    lazyType = ZodLazy.create;
    literalType = ZodLiteral.create;
    enumType = ZodEnum.create;
    nativeEnumType = ZodNativeEnum.create;
    promiseType = ZodPromise.create;
    effectsType = ZodEffects.create;
    optionalType = ZodOptional.create;
    nullableType = ZodNullable.create;
    preprocessType = ZodEffects.createWithPreprocess;
    pipelineType = ZodPipeline.create;
    ostring = () => stringType().optional();
    onumber = () => numberType().optional();
    oboolean = () => booleanType().optional();
    coerce = {
      string: ((arg) => ZodString.create({ ...arg, coerce: true })),
      number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
      boolean: ((arg) => ZodBoolean.create({
        ...arg,
        coerce: true
      })),
      bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
      date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
    };
    NEVER = INVALID;
  }
});

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});
var init_external = __esm({
  "node_modules/zod/v3/external.js"() {
    init_errors();
    init_parseUtil();
    init_typeAliases();
    init_util();
    init_types();
    init_ZodError();
  }
});

// node_modules/zod/index.js
var init_zod = __esm({
  "node_modules/zod/index.js"() {
    init_external();
    init_external();
  }
});

// src/product-profiles.ts
import { existsSync as existsSync3, readdirSync } from "node:fs";
import { dirname as dirname3, join as join3, resolve as resolve5 } from "node:path";
import { fileURLToPath } from "node:url";
function resolvePageObjectDefinition(catalog, pageId) {
  if (Object.hasOwn(catalog.pages, pageId)) {
    return { status: "found", page: catalog.pages[pageId] };
  }
  const foldedPageId = pageId.toLocaleLowerCase("de-DE");
  const matches = Object.keys(catalog.pages).filter(
    (candidate) => candidate.toLocaleLowerCase("de-DE") === foldedPageId
  );
  if (matches.length !== 1) return { status: matches.length ? "ambiguous" : "missing" };
  return { status: "found", page: catalog.pages[matches[0]] };
}
function loadProductProfile(id = "2025", root = defaultProfilesRoot) {
  if (!/^[0-9]{4}$/u.test(id)) throw new Error(`Ungueltige SSE-Profil-ID: ${id}`);
  const profileDir = resolve5(root, id);
  const manifestPath = join3(profileDir, "profile.json");
  if (!existsSync3(manifestPath)) throw new Error(`SSE-Profil '${id}' fehlt: ${manifestPath}`);
  const parsed = profileSchema.parse(readJsonFileStrict(manifestPath, `SSE-Profil '${id}'`));
  if (parsed.id !== id || String(parsed.taxYear) !== id) {
    throw new Error(`SSE-Profil '${id}' widerspricht id/taxYear im Manifest.`);
  }
  if (parsed.status === "disabled") {
    throw new Error(`SSE-Profil '${id}' ist abgeschaltet.`);
  }
  if (Object.keys(parsed.startModes).length === 0) throw new Error(`SSE-Profil '${id}' definiert keine Startmodi.`);
  const pageObjectsPath = join3(profileDir, parsed.pageObjects);
  if (!existsSync3(pageObjectsPath)) throw new Error(`Page-Objects fuer SSE-Profil '${id}' fehlen: ${pageObjectsPath}`);
  const pageObjectsCatalog = pageObjectsCompatibilitySchema.parse(
    readJsonFileStrict(pageObjectsPath, `Page-Objects fuer SSE-Profil '${id}'`)
  );
  if (pageObjectsCatalog.product !== parsed.product || pageObjectsCatalog.taxYear !== parsed.taxYear || pageObjectsCatalog.engineFileMajor !== parsed.engineFileMajor || pageObjectsCatalog.compatibility.executableName.toLowerCase() !== parsed.executable.name.toLowerCase() || pageObjectsCatalog.compatibility.installationFolderName.toLocaleLowerCase("de-DE") !== parsed.executable.installationFolderName.toLocaleLowerCase("de-DE")) {
    throw new Error(`Page-Objects und Manifest des SSE-Profils '${id}' widersprechen sich.`);
  }
  return { ...parsed, profileDir, manifestPath, pageObjectsPath, pageObjectsCatalog };
}
var profileSchema, pageObjectTableColumnSchema, pageObjectTableSchema, pageObjectSchema, pageObjectsCompatibilitySchema, here, defaultProfilesRoot;
var init_product_profiles = __esm({
  "src/product-profiles.ts"() {
    "use strict";
    init_zod();
    init_json_files();
    profileSchema = external_exports.object({
      schemaVersion: external_exports.literal(1),
      id: external_exports.string().regex(/^[0-9]{4}$/u),
      status: external_exports.enum(["supported", "experimental", "disabled"]),
      operationAccess: external_exports.enum(["full", "verification-only"]),
      product: external_exports.string().min(1),
      taxYear: external_exports.number().int().min(2e3).max(2200),
      engineFileMajor: external_exports.number().int().positive(),
      verifiedBuild: external_exports.string().regex(/^\d+\.\d+\.\d+\.\d+$/u),
      executable: external_exports.object({
        name: external_exports.literal("SSE.exe"),
        installationFolderName: external_exports.string().min(1),
        defaultRelativePath: external_exports.string().min(1)
      }).strict(),
      startModes: external_exports.record(external_exports.string().min(1)),
      additionalCaseYears: external_exports.record(
        external_exports.string().min(1),
        external_exports.array(external_exports.number().int().min(2e3).max(2200)).min(1)
      ),
      pageObjects: external_exports.string().regex(/^[^\\/:]+\.json$/iu),
      policy: external_exports.string().min(1)
    }).strict().superRefine((profile, context) => {
      const relative6 = profile.executable.defaultRelativePath.replaceAll("\\", "/");
      const segments = relative6.split("/");
      const unsafe = relative6.startsWith("/") || /^[A-Za-z]:/u.test(relative6) || segments.some((segment) => !segment || segment === "." || segment === "..") || segments.length < 2 || segments.at(-1)?.toLowerCase() !== profile.executable.name.toLowerCase() || segments.at(-2)?.toLocaleLowerCase("de-DE") !== profile.executable.installationFolderName.toLocaleLowerCase("de-DE");
      if (unsafe) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["executable", "defaultRelativePath"],
          message: "defaultRelativePath muss ein sicherer relativer Pfad sein und zu EXE/Installationsordner passen."
        });
      }
      for (const [mode, years] of Object.entries(profile.additionalCaseYears)) {
        if (!Object.hasOwn(profile.startModes, mode)) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: ["additionalCaseYears", mode],
            message: `Zusatzjahre referenzieren unbekannten Startmodus '${mode}'.`
          });
        }
        if (new Set(years).size !== years.length) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: ["additionalCaseYears", mode],
            message: "Zusatzjahre duerfen nicht doppelt vorkommen."
          });
        }
        for (const year of years) {
          if (year !== profile.taxYear + 1) {
            context.addIssue({
              code: external_exports.ZodIssueCode.custom,
              path: ["additionalCaseYears", mode],
              message: "Ein Produktprofil darf nur das unmittelbar folgende Falljahr explizit zusaetzlich freigeben."
            });
          }
        }
      }
    });
    pageObjectTableColumnSchema = external_exports.object({
      index: external_exports.number().int().nonnegative(),
      header: external_exports.string().min(1),
      controlType: external_exports.literal("ComboBox"),
      valueKind: external_exports.literal("enum"),
      writePolicy: external_exports.enum(["unsupported-fail-closed", "typed-selection-required"]),
      emptyRowDefault: external_exports.string().min(1).optional(),
      openPattern: external_exports.enum(["Invoke", "InvokeThenVerifiedPointVisibleDesktop"]).optional(),
      optionControlType: external_exports.literal("ListItem").optional(),
      optionSelectPattern: external_exports.literal("SelectionItem").optional(),
      readback: external_exports.array(external_exports.enum(["SelectionItem.IsSelected", "ValuePattern.Value", "checker-diff"])).optional(),
      reason: external_exports.string().min(1)
    }).strict().superRefine((column, context) => {
      if (column.emptyRowDefault !== void 0 && column.writePolicy !== "typed-selection-required") {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["emptyRowDefault"],
          message: "Ein profilierter Leerzeilen-Default ist nur fuer eine typisierte Auswahlspalte erlaubt."
        });
      }
      if (column.writePolicy !== "typed-selection-required") return;
      if (!["Invoke", "InvokeThenVerifiedPointVisibleDesktop"].includes(column.openPattern ?? "") || column.optionControlType !== "ListItem" || column.optionSelectPattern !== "SelectionItem" || !column.readback?.includes("SelectionItem.IsSelected") || !column.readback?.includes("ValuePattern.Value") || !column.readback?.includes("checker-diff")) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["writePolicy"],
          message: "Typed table selection requires a profiled semantic/verified open policy, ListItem, SelectionItem and all semantic/visual/checker readbacks."
        });
      }
    });
    pageObjectTableSchema = external_exports.object({
      sumLabel: external_exports.string().min(1),
      sumOccurrence: external_exports.number().int().positive(),
      automationIdSection: external_exports.string().regex(/^[A-Za-z0-9_]+$/u).optional(),
      bindingPolicy: external_exports.string().min(1),
      columns: external_exports.array(pageObjectTableColumnSchema).min(1)
    }).strict().superRefine((table, context) => {
      const indices = table.columns.map((column) => column.index);
      if (new Set(indices).size !== indices.length) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["columns"],
          message: "Tabellenspalten duerfen pro Page-Object nicht doppelt definiert sein."
        });
      }
    });
    pageObjectSchema = external_exports.object({
      heading: external_exports.string().min(1),
      fields: external_exports.record(external_exports.unknown()).optional(),
      tables: external_exports.record(pageObjectTableSchema).optional()
    }).passthrough();
    pageObjectsCompatibilitySchema = external_exports.object({
      schemaVersion: external_exports.literal(1),
      product: external_exports.string().min(1),
      taxYear: external_exports.number().int().min(2e3).max(2200),
      engineFileMajor: external_exports.number().int().positive(),
      compatibility: external_exports.object({
        executableName: external_exports.string().min(1),
        installationFolderName: external_exports.string().min(1)
      }).passthrough(),
      windows: external_exports.record(external_exports.unknown()).refine((value) => Object.keys(value).length > 0, "Fensterkatalog darf nicht leer sein."),
      pages: external_exports.record(pageObjectSchema).refine((value) => Object.keys(value).length > 0, "Seitenkatalog darf nicht leer sein.")
    }).passthrough().superRefine((catalog, context) => {
      const foldedIds = /* @__PURE__ */ new Map();
      for (const pageId of Object.keys(catalog.pages)) {
        const folded = pageId.toLocaleLowerCase("de-DE");
        const previous = foldedIds.get(folded);
        if (previous !== void 0) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: ["pages", pageId],
            message: `Page-Object-IDs '${previous}' und '${pageId}' unterscheiden sich nur in Gross-/Kleinschreibung.`
          });
        } else {
          foldedIds.set(folded, pageId);
        }
      }
    });
    here = dirname3(fileURLToPath(import.meta.url));
    defaultProfilesRoot = resolve5(here, "..", "profiles");
  }
});

// src/api-config.ts
import { existsSync as existsSync4, realpathSync, statSync } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute3, relative, resolve as resolve6, sep } from "node:path";
function pathInside(parent, candidate) {
  const rel = relative(canonicalTopologyPath(parent), canonicalTopologyPath(candidate));
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute3(rel);
}
function canonicalTopologyPath(path) {
  const absolute = resolve6(path);
  let ancestor = absolute;
  while (!existsSync4(ancestor)) {
    const parent = dirname4(ancestor);
    if (parent === ancestor) return absolute;
    ancestor = parent;
  }
  const tail = relative(ancestor, absolute);
  return resolve6(realpathSync(ancestor), tail);
}
function assertDisjoint(leftName, left, rightName, right) {
  if (pathInside(left, right) || pathInside(right, left)) {
    throw new Error(`Ressourcenbereiche '${leftName}' und '${rightName}' duerfen sich nicht ueberlappen.`);
  }
}
function assertApiResourceTopology(topology) {
  const children = [
    ["documents", topology.documentsDir],
    ["results", topology.resultDir],
    ["backups", topology.backupsDir]
  ];
  for (const [name, path] of [
    ["workspace", topology.workspaceDir],
    ...children,
    ...topology.caseDir ? [["cases", topology.caseDir]] : []
  ]) {
    if (existsSync4(path) && !statSync(path).isDirectory()) {
      throw new Error(`Ressourcenbereich '${name}' muss ein Ordner sein.`);
    }
  }
  for (const [name, path] of children) {
    if (pathInside(path, topology.workspaceDir)) {
      throw new Error(`Ressourcenbereich '${name}' darf den Bereich 'workspace' weder enthalten noch ersetzen.`);
    }
  }
  for (let index = 0; index < children.length; index++) {
    for (let other = index + 1; other < children.length; other++) {
      assertDisjoint(children[index][0], children[index][1], children[other][0], children[other][1]);
    }
  }
  if (topology.caseDir) {
    assertDisjoint("cases", topology.caseDir, "workspace", topology.workspaceDir);
    for (const [name, path] of children) assertDisjoint("cases", topology.caseDir, name, path);
  }
}
function loadApiServerConfig(env = process.env) {
  const config = loadApiConfigValues(env);
  loadProductProfile(config.profileId);
  assertApiResourceTopology(config);
  return config;
}
var init_api_config = __esm({
  "src/api-config.ts"() {
    "use strict";
    init_api_config_values();
    init_api_config_values();
    init_product_profiles();
  }
});

// src/api-first-run.ts
var api_first_run_exports = {};
__export(api_first_run_exports, {
  assertForegroundCaseDirectory: () => assertForegroundCaseDirectory,
  detectSseExecutables: () => detectSseExecutables,
  ensureForegroundApiFirstRun: () => ensureForegroundApiFirstRun
});
import { existsSync as existsSync5, mkdirSync, statSync as statSync2 } from "node:fs";
import { dirname as dirname5, join as join4, resolve as resolve7 } from "node:path";
function detectSseExecutables(profileId = "2025", env = process.env) {
  const profile = loadProductProfile(profileId);
  const systemDrive = (env.SystemDrive ?? "C:").replace(/[\\/]+$/u, "");
  const configuredRoots = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter((entry) => Boolean(entry));
  const roots = configuredRoots.length ? configuredRoots : [resolve7(`${systemDrive}\\`, "Program Files")];
  const candidates = roots.map((root) => join4(root, ...profile.executable.defaultRelativePath.split("/")));
  return [...new Set(candidates.map((path) => resolve7(path)))].filter((path) => {
    try {
      return statSync2(path).isFile();
    } catch {
      return false;
    }
  });
}
function assertForegroundCaseDirectory(caseDir) {
  if (!existsSync5(caseDir) || !statSync2(caseDir).isDirectory()) {
    throw new Error(`Bestaetigter Fallordner fehlt oder ist kein Ordner: ${caseDir}`);
  }
}
function ensureForegroundApiFirstRun(explicitConfigPath, env = process.env) {
  const namedEnvironmentConfig = env.SSE_API_CONFIG?.trim();
  const configPath = resolve7(explicitConfigPath ?? namedEnvironmentConfig ?? defaultApiConfigPath(env));
  if (explicitConfigPath || namedEnvironmentConfig || existsSync5(configPath)) {
    return { configPath, created: false };
  }
  const workspaceDir = join4(dirname5(configPath), "workspace");
  const documentsDir = join4(workspaceDir, "documents");
  const resultDir = join4(workspaceDir, "results");
  const backupsDir = join4(workspaceDir, "backups");
  for (const path of [dirname5(configPath), workspaceDir, documentsDir, resultDir, backupsDir]) {
    mkdirSync(path, { recursive: true });
  }
  const detected = detectSseExecutables("2025", env);
  const sseExecutable = detected.length === 1 ? detected[0] : void 0;
  const created = createTextFileExclusive({
    path: configPath,
    mode: 384,
    content: `${JSON.stringify({
      profileId: "2025",
      host: DEFAULT_API_HOST,
      port: DEFAULT_API_PORT,
      ...sseExecutable ? { sseExecutable } : {},
      documentsDir,
      workspaceDir,
      resultDir,
      backupsDir
    }, null, 2)}
`
  });
  return { configPath, created };
}
var init_api_first_run = __esm({
  "src/api-first-run.ts"() {
    "use strict";
    init_atomic_files();
    init_api_contract();
    init_api_config();
    init_product_profiles();
  }
});

// src/operation-schema-primitives.ts
var SSE_START_MODES, SSE_CLICK_PATTERNS, SSE_API_CLICK_PATTERNS, SSE_DIALOG_BUTTONS, SSE_START_MODE, WINDOWS_DEVICE_SEGMENT, RESOURCE_PATH, RESOURCE_REF, CASE_REF, CASE_COPY_TARGET_REF, RESULT_REF, WORKSPACE_REF, TEXT_WRITE_REF, BACKUP_REF, BARE_RESOURCE_REF, VERIFY_SOURCE_REF, SHA256, SSE_OPERATION_LIMITS, WINDOW_HANDLE, PROCESS_ID, UI_WAIT_MS, UI_OCCURRENCE, UI_COORDINATE, GOTO_MAX_STEPS, TABLE_MAX_ROWS, SNAPSHOT_MAX_NODES, USTVA_PERIOD_KEY;
var init_operation_schema_primitives = __esm({
  "src/operation-schema-primitives.ts"() {
    "use strict";
    init_zod();
    SSE_START_MODES = [
      "einur",
      "normal",
      "einurvor",
      "fest",
      "ermaess",
      "vorweg"
    ];
    SSE_CLICK_PATTERNS = ["invoke", "select", "expand", "collapse"];
    SSE_API_CLICK_PATTERNS = [...SSE_CLICK_PATTERNS, "toggle"];
    SSE_DIALOG_BUTTONS = [
      "OK",
      "Ja",
      "Nein",
      "Abbrechen",
      "Schließen",
      "Schliessen",
      "Übernehmen",
      "Uebernehmen",
      "Speichern",
      "Nicht speichern",
      "Verwerfen",
      "Wiederholen",
      "Ignorieren",
      "Als gelesen markieren",
      "Jetzt ignorieren",
      "Wiederherstellen",
      "Datei neu zuordnen",
      "Klicken Sie hier, um Ihre Daten zu exportieren"
    ];
    SSE_START_MODE = external_exports.enum(SSE_START_MODES).describe("Fachlicher SSE-Startmodus");
    WINDOWS_DEVICE_SEGMENT = "(?!(?:[^/]+/)*(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])(?:\\.[^/]*)?(?:/|$))";
    RESOURCE_PATH = WINDOWS_DEVICE_SEGMENT + '(?!(?:[\\\\/]|[A-Za-z]:))(?!\\.\\.(?:/|$))(?!.*\\/\\.\\.(?:/|$))[^\\\\:*?"<>|\\x00-\\x1f]+';
    RESOURCE_REF = () => external_exports.string().regex(
      new RegExp(`^(?:cases|documents|workspace|results|backups):${RESOURCE_PATH}$`),
      "Ressourcenreferenz im Format bereich:relativer/pfad erwartet"
    ).describe("Maschinenneutrale Referenz bereich:relativer/pfad; kein PC-Pfad");
    CASE_REF = () => external_exports.string().regex(
      new RegExp(`^cases:${RESOURCE_PATH}$`),
      "Fallreferenz im Format cases:relativer/pfad erwartet"
    ).describe("Maschinenneutrale Falldateireferenz im Bereich cases:");
    CASE_COPY_TARGET_REF = () => external_exports.string().regex(
      new RegExp(`^(?:cases|backups):${RESOURCE_PATH}$`),
      "Zielreferenz im Format cases:relativer/pfad oder backups:relativer/pfad erwartet"
    ).describe("Ziel der verifizierten Kopie: normalerweise backups:; cases: nur fuer eine ausdruecklich verlangte Arbeitskopie");
    RESULT_REF = () => external_exports.string().regex(
      new RegExp(`^results:${RESOURCE_PATH}$`),
      "Ergebnisreferenz im Format results:relativer/pfad erwartet"
    ).describe("Maschinenneutrale Ergebnisreferenz im Bereich results:");
    WORKSPACE_REF = () => external_exports.string().regex(
      new RegExp(`^workspace:${RESOURCE_PATH}$`),
      "Arbeitsreferenz im Format workspace:relativer/pfad erwartet"
    ).describe("Maschinenneutrale Arbeitsreferenz im Bereich workspace:");
    TEXT_WRITE_REF = () => external_exports.string().regex(
      new RegExp(`^(?:workspace|results):${RESOURCE_PATH}$`),
      "Schreibreferenz im Bereich workspace: oder results: erwartet"
    ).describe("Neue Textdateireferenz im Bereich workspace: oder results:");
    BACKUP_REF = () => external_exports.string().regex(
      new RegExp(`^backups:${RESOURCE_PATH}$`),
      "Sicherungsreferenz im Format backups:relativer/pfad erwartet"
    ).describe("Maschinenneutrale Sicherungsreferenz im Bereich backups:");
    BARE_RESOURCE_REF = () => external_exports.string().regex(
      new RegExp(`^${RESOURCE_PATH}$`),
      "Normalisierter relativer Ressourcenpfad ohne Bereich erwartet"
    ).describe("Relativer Ressourcenpfad ohne Bereich und ohne PC-Bezug");
    VERIFY_SOURCE_REF = () => external_exports.string().regex(
      new RegExp(`^(?:results|workspace):${RESOURCE_PATH}$`),
      "Quellreferenz im Bereich results: oder workspace: erwartet"
    ).describe("Referenz einer vorhandenen JSON-Quelle unter results: oder workspace:");
    SHA256 = () => external_exports.string().regex(/^[A-Fa-f0-9]{64}$/, "64-stelliger SHA256 in Hexadezimalform erwartet").describe("64-stelliger SHA256-Fingerprint in Hexadezimalform");
    SSE_OPERATION_LIMITS = Object.freeze({
      windowHandleMax: Number.MAX_SAFE_INTEGER,
      processIdMax: 2147483647,
      uiWaitMs: Object.freeze({ min: 100, max: 1e4 }),
      occurrence: 1e3,
      coordinateAbsolute: 1e6,
      gotoSteps: 200,
      tableRows: 1e3,
      snapshotNodes: 5e3,
      snapshotTypes: 50,
      tableValues: 100,
      verifyExpectations: 500,
      vastPlan: 500,
      readbackChecks: 100,
      resultLabels: 500,
      archiveCases: 2e3
    });
    WINDOW_HANDLE = external_exports.number().int("hwnd muss eine ganze Zahl sein.").positive().max(SSE_OPERATION_LIMITS.windowHandleMax).describe("Exaktes Windows-Fensterhandle aus einem frischen SSE-Readback");
    PROCESS_ID = external_exports.number().int("pid muss eine ganze Zahl sein.").positive().max(SSE_OPERATION_LIMITS.processIdMax).describe("Exakte SSE-Prozess-ID aus einem frischen Start- oder Fenster-Readback");
    UI_WAIT_MS = external_exports.number().int("Wartezeit muss eine ganze Zahl sein.").min(SSE_OPERATION_LIMITS.uiWaitMs.min).max(SSE_OPERATION_LIMITS.uiWaitMs.max).describe("Wartezeit nach der UI-Aktion in Millisekunden");
    UI_OCCURRENCE = external_exports.number().int("Vorkommen muss eine ganze Zahl sein.").min(1).max(SSE_OPERATION_LIMITS.occurrence).describe("1-basierte Position bei mehreren gleich benannten Treffern");
    UI_COORDINATE = external_exports.number().int("Koordinate muss eine ganze Zahl sein.").min(-SSE_OPERATION_LIMITS.coordinateAbsolute).max(SSE_OPERATION_LIMITS.coordinateAbsolute).describe("Absolute virtuelle Windows-Bildschirmkoordinate");
    GOTO_MAX_STEPS = external_exports.number().int("maxSteps muss eine ganze Zahl sein.").min(1).max(SSE_OPERATION_LIMITS.gotoSteps).describe("Harte Obergrenze der Navigationsschritte");
    TABLE_MAX_ROWS = external_exports.number().int("maxRows muss eine ganze Zahl sein.").min(1).max(SSE_OPERATION_LIMITS.tableRows).describe("Harte Obergrenze der zu lesenden Tabellenzeilen");
    SNAPSHOT_MAX_NODES = external_exports.number().int("maxNodes muss eine ganze Zahl sein.").min(1).max(SSE_OPERATION_LIMITS.snapshotNodes).describe("Harte Obergrenze der UIA-Knoten im Snapshot");
    USTVA_PERIOD_KEY = () => external_exports.enum([
      "monthly",
      "quarterly",
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
      "q1",
      "q2",
      "q3",
      "q4"
    ]).describe("UStVA-Frequenz, Monat oder Quartal als stabiler semantischer Schluessel");
  }
});

// src/mcp-schemas-analysis.ts
var SSE_MCP_ANALYSIS_SCHEMAS;
var init_mcp_schemas_analysis = __esm({
  "src/mcp-schemas-analysis.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    SSE_MCP_ANALYSIS_SCHEMAS = {
      "sse_read_full": external_exports.object({
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_scroll_page": external_exports.object({
        mode: external_exports.enum(["info", "percent", "amount"]).optional().describe("Scrollmodus; Vorgabe info"),
        vPercent: external_exports.number().min(0).max(100).optional().describe("Vertikale Zielposition in Prozent fuer mode=percent"),
        direction: external_exports.enum(["up", "down"]).optional().describe("Richtung fuer mode=amount"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_help": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_subpages": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_check_page": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_result_details": external_exports.object({
        openIfNeeded: external_exports.boolean().optional().describe("Werte-Info bei Bedarf oeffnen; Vorgabe true"),
        hwnd: WINDOW_HANDLE.optional().describe("SSE-Hauptfenster, zu dessen Prozess die Werte-Info gehoert")
      }).strict(),
      "sse_checker_results": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_checker_run": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_checker_reset": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_checker_open": external_exports.object({
        name: external_exports.string().min(1).describe("Exakter Text aus sse_checker_results"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_checker_close": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        waitMs: external_exports.number().int().min(300).max(3e3).optional().describe("Wartezeit auf den unveraenderten Seiten-Readback")
      }).strict()
    };
  }
});

// src/mcp-schemas-desktop.ts
var SSE_MCP_DESKTOP_SCHEMAS;
var init_mcp_schemas_desktop = __esm({
  "src/mcp-schemas-desktop.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    SSE_MCP_DESKTOP_SCHEMAS = {
      "sse_desktop_start": external_exports.object({
        caseRef: CASE_REF().optional().describe("Falldatei innerhalb des lokal konfigurierten Fallbereichs"),
        mode: SSE_START_MODE.optional().describe(
          "Startmodus: normal=Einkommensteuer, einur=Gewinnermittlung/EUER (Vorgabe), einurvor=Gewinn-Erfassung des Folgejahres; bei einer .ESt-Datei immer normal explizit setzen"
        ),
        name: external_exports.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().describe("Desktopname aus ASCII-Buchstaben, Ziffern, _ oder -, Vorgabe 'SSEAuto'"),
        timeoutSec: external_exports.number().int().min(3).max(90).optional().describe("Startwartezeit in Sekunden, Vorgabe 30"),
        exe: external_exports.never().optional().describe("Nicht zulaessig; wird ausschliesslich in der lokalen API konfiguriert")
      }).strict(),
      "sse_desktop_stop": external_exports.object({
        save: external_exports.boolean().optional().describe("Veraltet und gesperrt: stattdessen zuerst sse_save hashgebunden aufrufen"),
        discardChanges: external_exports.boolean().optional().describe("Explizite Erlaubnis, ungespeicherte Aenderungen zu verwerfen und notfalls die eigene PID hart zu beenden")
      }).strict(),
      "sse_desktop_status": external_exports.object({}).strict(),
      "sse_page": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_positions": external_exports.object({
        aktion: external_exports.literal("list").optional().describe("Vorgabe und einzig zugelassene Aktion: 'list'"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_export_csv": external_exports.object({
        resultRef: RESULT_REF().optional().describe("Neuer oder vorhandener leerer Ergebnisordner fuer den CSV-Export"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_collect": external_exports.object({
        resultRef: RESULT_REF().optional().describe("Zieldatei .json; ohne Angabe kommt alles in die Antwort"),
        maxPages: external_exports.number().int().min(1).max(5).optional().describe("Hoechstzahl des Diagnose-Segments, Vorgabe 3, Maximum 5"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_verify": external_exports.object({
        sourceRef: VERIFY_SOURCE_REF().describe("Referenz der mit sse_collect erzeugten JSON-Datei"),
        expectedSourceHash: SHA256().describe(
          "Exakter dateiHash aus sse_collect; bindet den geprueften Inhalt gegen parallele Aenderungen"
        ),
        allowIncompleteSource: external_exports.boolean().optional().describe(
          "Vorgabe false. True erlaubt nur einen klar gekennzeichneten Teilstandsabgleich ohne Gesamturteil."
        ),
        erwartungen: external_exports.array(external_exports.object({
          seite: external_exports.string().describe("Exakte Seitenueberschrift im gesammelten Teilstand"),
          label: external_exports.string().describe("Exakte Feld- oder Zeilenbeschriftung"),
          wert: external_exports.string().describe("Exakt erwarteter formatierter Wert"),
          seiteOccurrence: UI_OCCURRENCE.optional(),
          labelOccurrence: UI_OCCURRENCE.optional()
        }).strict()).min(1).max(SSE_OPERATION_LIMITS.verifyExpectations).describe("Sollwerte; Occurrence nur verwenden, wenn der vorige Lauf konkrete Mehrdeutigkeit meldete")
      }).strict()
    };
  }
});

// src/mcp-schemas-diagnostics.ts
var SSE_MCP_DIAGNOSTIC_SCHEMAS;
var init_mcp_schemas_diagnostics = __esm({
  "src/mcp-schemas-diagnostics.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    SSE_MCP_DIAGNOSTIC_SCHEMAS = {
      "sse_preflight": external_exports.object({}).strict(),
      "sse_product_info": external_exports.object({}).strict(),
      "sse_capabilities": external_exports.object({}).strict(),
      "sse_page_objects": external_exports.object({
        pageId: external_exports.string().optional().describe("Stabile pageId aus dem Page-Object-Katalog; ohne Angabe alle Seiten")
      }).strict(),
      "sse_page_state": external_exports.object({
        pageId: external_exports.string().describe("Stabile pageId der erwarteten katalogisierten Seite"),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional()
      }).strict(),
      "sse_workspace_status": external_exports.object({}).strict(),
      "sse_workspace_files": external_exports.object({
        ref: RESOURCE_REF().optional().describe("Bereich und Unterordner; Vorgabe workspace:."),
        limit: external_exports.number().int("'limit' muss eine ganze Zahl sein.").min(1).max(2e3).optional().describe("Maximale Zahl gelisteter Dateien; Vorgabe 500, Maximum 2000"),
        includeHashes: external_exports.boolean().optional().describe("SHA256 berechnen; Vorgabe true, false fuer besonders schnelle Listen")
      }).strict(),
      "sse_workspace_read_text": external_exports.object({
        ref: RESOURCE_REF()
      }).strict(),
      "sse_workspace_write_text": external_exports.object({
        ref: TEXT_WRITE_REF(),
        text: external_exports.string().describe("Vollstaendiger UTF-8-Inhalt der exklusiv neu anzulegenden Textdatei")
      }).strict(),
      "sse_run_scenario": external_exports.object({
        scenarioRef: WORKSPACE_REF(),
        resultRef: RESULT_REF().optional()
      }).strict(),
      "sse_health": external_exports.object({}).strict(),
      "sse_instances": external_exports.object({
        includeHash: external_exports.boolean().optional().describe("SHA256 jeder gebundenen Falldatei mitlesen; Vorgabe false, weil es zusaetzliche Datei-E/A kostet")
      }).strict(),
      "sse_windows": external_exports.object({
        process: external_exports.enum(["SSE", "SteuertippsCenter"]).optional().describe("Vorgabe 'SSE'; optional 'SteuertippsCenter' fuer die Fallauswahl")
      }).strict(),
      "sse_center_cases": external_exports.object({
        hwnd: WINDOW_HANDLE.optional().describe("Exaktes Fenster des Steuertipps-Centers; bei mehreren Fenstern Pflicht")
      }).strict(),
      "sse_center_refresh": external_exports.object({
        hwnd: WINDOW_HANDLE,
        expectedDirectoryRef: CASE_REF().optional().describe("Im Modus 'Verzeichnis': vom vorigen sse_center_cases gelieferte verzeichnisRef"),
        expectedMode: external_exports.literal("Zuletzt verwendet").optional().describe("Im Modus 'Zuletzt verwendet': exakt dieser vom vorigen sse_center_cases gelieferte Modus")
      }).strict(),
      "sse_window_close": external_exports.object({
        pid: PROCESS_ID.describe("Vom vorigen sse_windows gelieferte PID desselben SSE-Fensters"),
        hwnd: WINDOW_HANDLE,
        titleFingerprint: SHA256().describe("Vom vorigen sse_windows gelieferter Fingerprint des exakten Titels"),
        waitMs: external_exports.number().int().min(300).max(1e4).optional().describe("Wartezeit auf das Schliessen in Millisekunden")
      }).strict(),
      "sse_window_restore": external_exports.object({
        pid: PROCESS_ID.describe("Vom vorigen sse_windows gelieferte PID des minimierten SSE-Hauptfensters"),
        hwnd: WINDOW_HANDLE.describe("Vom vorigen sse_windows geliefertes exaktes SSE-Hauptfenster"),
        titleFingerprint: SHA256().describe("Vom vorigen sse_windows gelieferter Fingerprint des exakten Hauptfenstertitels"),
        waitMs: external_exports.number().int().min(300).max(1e4).optional().describe("Wartezeit auf den nicht-minimierten Readback in Millisekunden")
      }).strict(),
      "sse_case_hash": external_exports.object({ ref: CASE_REF().describe("Falldatei innerhalb des lokal konfigurierten Fallbereichs") }).strict(),
      "sse_dialog_list": external_exports.object({
        pid: PROCESS_ID.optional().describe("Optional nur Fenster der zuvor gestarteten SSE-PID inventarisieren")
      }).strict(),
      "sse_dialog_answer": external_exports.object({
        hwnd: WINDOW_HANDLE,
        fingerprint: SHA256(),
        bodyFingerprint: SHA256().optional().describe("Bei automatischen Pruefhinweisen Pflicht; bindet auch den OCR-Fliesstext"),
        expectedCaseRef: CASE_REF().optional().describe(
          "Nur bei recoveryPrompt=true Pflicht: regulaer gespeicherte Falldatei, die exakt an die gestartete SSE-PID gebunden sein muss"
        ),
        expectedCaseHash: SHA256().optional().describe(
          "Nur bei recoveryPrompt=true Pflicht: aktueller SHA256 der regulaer gespeicherten Falldatei"
        ),
        discardUnsavedRecovery: external_exports.literal(true).optional().describe(
          "Nur bei recoveryPrompt=true und Antwort 'Nein': verwirft die Wiederherstellungsdatei einer SSE-PID, die nachweislich ohne Falldatei gestartet wurde (nie gespeicherter Fall); schliesst expectedCaseRef/expectedCaseHash aus"
        ),
        button: external_exports.enum(SSE_DIALOG_BUTTONS).describe("Exakter freigegebener Buttonname aus sse_dialog_list"),
        waitMs: external_exports.number().int().min(200).max(1e4).optional().describe("Wartezeit auf den Dialog-Readback in Millisekunden")
      }).strict(),
      "sse_warning_popup_read": external_exports.object({
        hwnd: WINDOW_HANDLE.optional().describe("Optionales SSE-Hauptfenster zur PID-Bindung oder exaktes Warnfenster"),
        ocr: external_exports.boolean().optional().describe("Fliesstext per lokaler Windows-OCR lesen; Vorgabe true"),
        includeImage: external_exports.boolean().optional().describe("Kontrollbild mitsenden; Vorgabe false")
      }).strict(),
      "sse_vast_dialog_read": external_exports.object({ hwnd: WINDOW_HANDLE.optional().describe("Exaktes VaSt-Dialogfenster; bei Eindeutigkeit optional") }).strict(),
      "sse_vast_row_details": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        mappingFingerprint: SHA256(),
        certificate: external_exports.string().describe("Exakte Bescheinigungsbeschriftung aus sse_vast_dialog_read"),
        occurrence: UI_OCCURRENCE.optional()
      }).strict(),
      "sse_vast_row_set_expanded": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        mappingFingerprint: SHA256(),
        certificate: external_exports.string().describe("Exakte Bescheinigungsbeschriftung"),
        occurrence: UI_OCCURRENCE.optional(),
        expectedBefore: external_exports.boolean().describe("Exakt erwarteter aktueller Aufklappzustand"),
        expanded: external_exports.boolean().describe("Gewuenschter Aufklappzustand")
      }).strict(),
      "sse_vast_mapping_options": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        mappingFingerprint: SHA256(),
        certificate: external_exports.string().describe("Exakte Bescheinigungsbeschriftung"),
        occurrence: UI_OCCURRENCE.optional(),
        expectedCurrent: external_exports.string().describe("Exakt erwartetes aktuelles lokales Zuordnungsziel")
      }).strict(),
      "sse_vast_mapping_select": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        mappingFingerprint: SHA256(),
        certificate: external_exports.string().describe("Exakte Bescheinigungsbeschriftung"),
        occurrence: UI_OCCURRENCE.optional(),
        expectedCurrent: external_exports.string().describe("Exakt erwartetes aktuelles lokales Zuordnungsziel"),
        value: external_exports.string().describe("Stabiler Wert des neu auszuwaehlenden lokalen Zuordnungsziels"),
        optionText: external_exports.string().optional().describe("Nur falls OCR den sichtbaren Listentext anders liest als UIA, z. B. 1/l"),
        expectedAfter: external_exports.string().describe("Exakter OCR-Readback nach der Auswahl")
      }).strict(),
      "sse_vast_apply": external_exports.object({
        hwnd: WINDOW_HANDLE.describe("Exaktes VaSt-Dialog-HWND"),
        expectedMainHwnd: WINDOW_HANDLE.describe("Exaktes zugehöriges SSE-Hauptfenster"),
        expectedCaseRef: CASE_REF().describe("Exakte Referenz des geöffneten Steuerfalls"),
        expectedCaseHash: SHA256().describe("Aktueller Disk-SHA256 vor dem ungespeicherten Merge"),
        mappingFingerprint: SHA256(),
        plan: external_exports.array(external_exports.object({
          certificate: external_exports.string().describe("Exakte Bescheinigungsbeschriftung der Zeile"),
          occurrence: UI_OCCURRENCE,
          localTarget: external_exports.string().describe("Exaktes lokales Ziel aus dem gebundenen Mapping-Readback")
        }).strict()).min(1).max(SSE_OPERATION_LIMITS.vastPlan).describe("Alle sichtbaren Zeilen in exakt der von sse_vast_dialog_read gelieferten Reihenfolge"),
        acknowledgeApply: external_exports.literal(true).describe("Einmalige Bestätigung für genau diesen lokalen Merge"),
        waitMs: external_exports.number().int().min(500).max(15e3).optional().describe("Wartezeit auf den VaSt-Merge-Readback in Millisekunden")
      }).strict()
    };
  }
});

// src/mcp-schemas-interaction.ts
var SSE_MCP_INTERACTION_SCHEMAS;
var init_mcp_schemas_interaction = __esm({
  "src/mcp-schemas-interaction.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    SSE_MCP_INTERACTION_SCHEMAS = {
      "sse_click": external_exports.object({
        name: external_exports.string().optional().describe("Beschriftung, z. B. 'Weiter'"),
        aid: external_exports.string().optional().describe("AutomationId statt Beschriftung (Endstueck genuegt)"),
        rid: external_exports.string().optional().describe("RuntimeId aus sse_snapshot - eindeutig"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        type: external_exports.string().optional().describe("Optionaler UIA-Steuerelementtyp zur Eindeutigkeit"),
        pattern: external_exports.enum(SSE_CLICK_PATTERNS).optional().describe(
          "Vorgabe 'invoke'. expand/collapse aendern nur den Tree-Zustand, nicht die Seite. toggle ist fail-closed gesperrt; select nur mit exakter aid fuer einen RadioButton samt Gruppen-Readback."
        ),
        acknowledgeDestructive: external_exports.boolean().optional().describe(
          "Nur nach bewusstem Readback fuer lokale Loesch-/Import-/Uebernahme-/Zuruecksetzbefehle einmalig true setzen"
        ),
        expectedPageBefore: external_exports.string().optional().describe(
          "Optionale exakte Seitenueberschrift unmittelbar vor dem Ausloesen; bei Abweichung wird nichts aktiviert"
        ),
        expectedPageAfter: external_exports.string().optional().describe(
          "Optionale exakte Zielueberschrift fuer jede navigierende Schaltflaeche; wird im selben Worker rueckgelesen"
        ),
        waitMs: UI_WAIT_MS.optional().describe("Maximale Wartezeit auf die Nachbedingung; sonst 1200 ms, maximal 10 Sekunden"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_toggle": external_exports.object({
        expectedPage: external_exports.string().describe("Exakte aktuelle Seitenueberschrift"),
        name: external_exports.string().optional().describe("Exakte sichtbare Beschriftung"),
        aid: external_exports.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
        rid: external_exports.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        expectedBefore: external_exports.boolean().describe("Exakt erwarteter aktueller Haken-Zustand"),
        value: external_exports.boolean().describe("Gewuenschter Haken-Zustand"),
        expectedAfter: external_exports.boolean().describe("Exakt erwarteter Zustand nach Toggle und Readback"),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF().optional(),
        expectedCaseHash: SHA256().optional()
      }).strict(),
      "sse_click_point": external_exports.object({
        name: external_exports.string().optional().describe("Beschriftung, z. B. ein Eintrag im Navigationsbaum"),
        aid: external_exports.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
        rid: external_exports.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
        type: external_exports.string().optional().describe("'TreeItem' oder fuer eine reine Detailnavigation 'Hyperlink'"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        double: external_exports.boolean().optional().describe("Nur fuer einen nachweislich doppelklickbeduerftigen TreeItem-Pfad"),
        acknowledgeDestructive: external_exports.boolean().optional().describe(
          "Nur nach bewusstem Readback fuer destruktiv benannte TreeItems einmalig true setzen"
        ),
        expectedPageBefore: external_exports.string().optional().describe(
          "Optionale exakte Seitenueberschrift unmittelbar vor dem physischen Klick; bei Abweichung wird nicht geklickt"
        ),
        expectedPageAfter: external_exports.string().optional().describe(
          "Optionale exakte Zielueberschrift; eine blosse Auswahl-/Fingerprint-Aenderung gilt dann nicht als Erfolg"
        ),
        waitMs: UI_WAIT_MS.optional().describe("Wartezeit auf den Navigations-Readback"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_set_value": external_exports.object({
        rid: external_exports.string().min(1).describe(
          "Frische RuntimeId des strukturell ueber seinen Container gebundenen globalen Suchfelds, z. B. aus sse_get_value oder sse_snapshot; muss zum aktuell gebundenen Suchfeld passen"
        ),
        expectedBefore: external_exports.string().describe("Exakter unmittelbar erwarteter Suchtext; leerer String ist erlaubt"),
        value: external_exports.string().describe("Neuer Wert"),
        expectedAfter: external_exports.string().describe("Exakter erwarteter Suchtext nach ValuePattern-Readback"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_change_field": external_exports.object({
        expectedPage: external_exports.string().describe("Exakte aktuelle Seitenueberschrift; verhindert Schreiben auf einer falschen Seite"),
        name: external_exports.string().optional().describe("Beschriftung des Zielfelds"),
        aid: external_exports.string().optional().describe("AutomationId des Zielfelds; fuer unbeschriftete oder mehrdeutige Felder"),
        rid: external_exports.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Readback"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        expectedBefore: external_exports.string().describe("Exakter erwarteter Vorwert"),
        value: external_exports.string().describe("Zu setzender Wert"),
        expectedAfter: external_exports.string().describe("Exakter erwarteter Wert nach Qt-Formatierung/Commit"),
        valueKind: external_exports.enum(["text", "currency", "date"]).optional().describe(
          "Optionaler Formatvertrag; date akzeptiert ein von SSE bewusst ohne Jahr angezeigtes TT.MM"
        ),
        sumChecks: external_exports.array(external_exports.object({
          label: external_exports.string().describe("Exakte Beschriftung der Kontrollsumme"),
          occurrence: UI_OCCURRENCE.optional(),
          before: external_exports.string().describe("Exakter Summenwert vor dem Schreiben"),
          after: external_exports.string().describe("Exakter Summenwert nach dem Schreiben")
        }).strict()).max(SSE_OPERATION_LIMITS.readbackChecks).optional().describe("Optionale Seiten-Summenvertraege; jede Abweichung loest Rollback aus"),
        trackResults: external_exports.boolean().optional().describe("Werte-Info vor/nach lesen; Vorgabe true"),
        resultLabels: external_exports.array(external_exports.string()).max(SSE_OPERATION_LIMITS.resultLabels).optional().describe(
          "Optional nur diese Ergebniszeilen vergleichen; sonst alle geaenderten"
        ),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF().optional().describe("Optional exakter geoeffneter Steuerfall; bei mehreren SSE-Instanzen empfohlen"),
        expectedCaseHash: SHA256().optional().describe("Optional SHA256 der Falldatei, nur zusammen mit expectedCaseRef")
      }).strict(),
      "sse_change_known_field": external_exports.object({
        pageId: external_exports.string().describe("Stabile pageId aus sse_page_objects"),
        fieldId: external_exports.string().describe("Stabile fieldId der katalogisierten Seite"),
        expectedBefore: external_exports.string().describe("Exakter erwarteter Vorwert aus sse_page_state"),
        expectedEpoch: external_exports.string().optional().describe("Epoche aus sse_page_state; verhindert Schreiben nach zwischenzeitlicher UI-Aenderung"),
        value: external_exports.string().describe("Zu setzender fachlicher Wert"),
        expectedAfter: external_exports.string().describe("Exakter erwarteter Wert nach Qt-Formatierung und Readback"),
        sumChecks: external_exports.array(external_exports.object({
          label: external_exports.string().describe("Exakte Beschriftung der Kontrollsumme"),
          occurrence: UI_OCCURRENCE.optional(),
          before: external_exports.string().describe("Exakter Summenwert vor dem Schreiben"),
          after: external_exports.string().describe("Exakter Summenwert nach dem Schreiben")
        }).strict()).max(SSE_OPERATION_LIMITS.readbackChecks).optional().describe("Optionale Summenvertraege; jede Abweichung loest Rollback aus"),
        trackResults: external_exports.boolean().optional().describe("Werte-Info vor/nach lesen; Vorgabe true"),
        resultLabels: external_exports.array(external_exports.string()).max(SSE_OPERATION_LIMITS.resultLabels).optional().describe("Optional nur diese Werte-Info-Zeilen vergleichen"),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF().optional(),
        expectedCaseHash: SHA256().optional()
      }).strict(),
      "sse_fill_fields": external_exports.object({
        pageId: external_exports.string().min(1).max(200).describe(
          "Stabile pageId der bereits geoeffneten katalogisierten Seite"
        ),
        fields: external_exports.array(external_exports.object({
          fieldId: external_exports.string().min(1).max(200).describe("Stabile fieldId derselben Page-Object-Seite"),
          expectedBefore: external_exports.string().describe("Exakter Vorwert dieses Feldes"),
          value: external_exports.string().describe("Zu setzender fachlicher Wert"),
          expectedAfter: external_exports.string().describe("Exakter Wert nach Qt-Commit und Readback"),
          sumChecks: external_exports.array(external_exports.object({
            label: external_exports.string().describe("Exakte Beschriftung der Kontrollsumme"),
            occurrence: UI_OCCURRENCE.optional(),
            before: external_exports.string().describe("Exakter Summenwert vor diesem Feld"),
            after: external_exports.string().describe("Exakter Summenwert nach diesem Feld")
          }).strict()).max(SSE_OPERATION_LIMITS.readbackChecks).optional().describe(
            "Optionale Summenvertraege fuer diesen einzelnen Feldschritt"
          )
        }).strict()).min(1).max(20).refine(
          (fields) => new Set(fields.map((field) => field.fieldId)).size === fields.length,
          "Jede fieldId darf im Plan nur einmal vorkommen."
        ).describe("Ein bis 20 katalogisierte Felder derselben bereits geoeffneten Seite"),
        expectedEpoch: SHA256().optional().describe(
          "Optionale Anfangsepoche aus sse_page_state; sie bindet den ersten Schritt, danach gelten dessen unmittelbare Readbacks"
        ),
        stopOnError: external_exports.literal(true).optional().describe("Fail-fast ist fest; nach dem ersten Fehler folgen nur Rollback und Readback"),
        rollback: external_exports.literal("best-effort").optional().describe("Erfolgreiche vorherige Feldschritte werden in umgekehrter Reihenfolge zurueckgesetzt"),
        finalReadback: external_exports.literal(true).optional().describe("Vollstaendiger Page-Object-Readback ist verpflichtend"),
        trackResults: external_exports.boolean().optional().describe("Werte-Info je Feld verfolgen; Vorgabe wie bei sse_change_known_field"),
        resultLabels: external_exports.array(external_exports.string()).max(SSE_OPERATION_LIMITS.resultLabels).optional().describe(
          "Optional nur diese Werte-Info-Zeilen bei jedem Feldschritt vergleichen"
        ),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF().optional(),
        expectedCaseHash: SHA256().optional()
      }).strict(),
      "sse_combo_options": external_exports.object({
        name: external_exports.string().optional().describe("Exakte sichtbare Beschriftung des Dropdowns"),
        aid: external_exports.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
        rid: external_exports.string().optional().describe("RuntimeId aus sse_snapshot"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_combo_select": external_exports.object({
        expectedPage: external_exports.string().describe("Exakte aktuelle Seitenueberschrift"),
        name: external_exports.string().optional().describe("Exakte sichtbare Beschriftung des Dropdowns"),
        aid: external_exports.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
        rid: external_exports.string().optional().describe("RuntimeId aus sse_snapshot"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        hwnd: WINDOW_HANDLE.optional(),
        expectedCurrent: external_exports.string().describe("Exakter aktuell erwarteter Wert, leerer String ist erlaubt"),
        value: external_exports.string().describe("Exakte Optionsbeschriftung"),
        expectedAfter: external_exports.string().describe("Exakter erwarteter Wert nach Auswahl und Qt-Readback"),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF().optional(),
        expectedCaseHash: SHA256().optional()
      }).strict(),
      "sse_ustva_read": external_exports.object({
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_ustva_select_period": external_exports.object({
        selector: external_exports.enum(["frequency", "month", "quarter"]).describe("Zu aendernde Zeitraumdimension"),
        expectedCurrent: USTVA_PERIOD_KEY(),
        value: USTVA_PERIOD_KEY(),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF(),
        expectedCaseHash: SHA256()
      }).strict(),
      "sse_ustva_set_flag": external_exports.object({
        flag: external_exports.enum(["corrected", "documents", "offset_request", "revoke_sepa", "additional_information", "manual_input"]).describe("Stabiles fachliches UStVA-Kennzeichen"),
        expectedBefore: external_exports.boolean().describe("Exakt erwarteter aktueller Kennzeichenstatus"),
        value: external_exports.boolean().describe("Gewuenschter Kennzeichenstatus"),
        expectedAfter: external_exports.boolean().describe("Exakt erwarteter Status nach Readback"),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF(),
        expectedCaseHash: SHA256()
      }).strict(),
      "sse_ustva_change_value": external_exports.object({
        field: external_exports.enum([
          "taxable_19_base",
          "taxable_7_base",
          "taxable_zero_base",
          "other_rates_base",
          "other_rates_tax",
          "reverse_charge_eu_base",
          "reverse_charge_eu_tax",
          "reverse_charge_foreign_services_base",
          "reverse_charge_foreign_services_tax",
          "input_tax_invoices",
          "input_tax_reverse_charge",
          "input_tax_import",
          "input_tax_adjustment",
          "special_advance_payment",
          "reduction_taxable_base",
          "reduction_input_tax"
        ]).describe("Stabiles fachliches UStVA-Betragsfeld"),
        expectedBefore: external_exports.string().describe("Exakt erwarteter formatierter Vorwert"),
        value: external_exports.string().describe("Neuer fachlicher Betragswert"),
        expectedAfter: external_exports.string().describe("Exakt erwarteter formatierter Wert nach Readback"),
        manualInputConfirmed: external_exports.literal(true).optional().describe("Fuer manuelle Haupt-, §13b- und Vorsteuerwerte nur nach bewusster manueller Eingabeentscheidung true"),
        hwnd: WINDOW_HANDLE.optional(),
        pid: PROCESS_ID.optional(),
        expectedCaseRef: CASE_REF(),
        expectedCaseHash: SHA256()
      }).strict(),
      "sse_ustva_open_section": external_exports.object({
        section: external_exports.enum(["reverse_charge", "input_tax", "small_business", "tax_exempt", "non_taxable"]).describe("Stabiler fachlicher UStVA-Unterbereich"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_scroll": external_exports.object({
        mode: external_exports.enum(["intoview", "percent", "list"]).optional().describe("Scrollmodus; Vorgabe intoview"),
        name: external_exports.string().optional().describe("Element, das sichtbar werden soll (bei mode='intoview')"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        vPercent: external_exports.number().min(0).max(100).optional().describe("Vertikale Zielposition in Prozent"),
        hPercent: external_exports.number().min(0).max(100).optional().describe("Horizontale Zielposition in Prozent"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict()
    };
  }
});

// src/mcp-schemas-lifecycle.ts
var SSE_MCP_LIFECYCLE_SCHEMAS;
var init_mcp_schemas_lifecycle = __esm({
  "src/mcp-schemas-lifecycle.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    SSE_MCP_LIFECYCLE_SCHEMAS = {
      "sse_launch": external_exports.object({
        caseRef: CASE_REF().optional().describe(
          "Falldatei, z. B. cases:arbeitskopie.Gew2025 oder im Profil 2025 cases:ustva.GewErfass2026"
        ),
        mode: SSE_START_MODE.optional().describe(
          "Startmodus: normal=Einkommensteuer, einur=Gewinnermittlung/EUER (Vorgabe), einurvor=Gewinn-Erfassung des Folgejahres; bei einer .ESt-Datei immer normal explizit setzen"
        ),
        exe: external_exports.never().optional().describe("Nicht zulaessig; wird ausschliesslich in der lokalen API konfiguriert")
      }).strict(),
      "sse_case_create": external_exports.object({
        targetRef: CASE_REF().describe(
          "Neue, noch nicht vorhandene Falldatei im Bereich cases:; die Endung muss zum Startmodus passen (einurvor im Profil 2025 -> .GewErfass2026)"
        ),
        mode: external_exports.enum(["einurvor"]).describe(
          "Startmodus des neuen Falls; derzeit nur einurvor (Gewinn-Erfassung des freigegebenen Folgejahres) live verifiziert"
        )
      }).strict(),
      "sse_save": external_exports.object({
        caseRef: CASE_REF().describe("Exakte Referenz des aktuell geoeffneten Steuerfalls; der Aufruf impliziert keine Save-As-Kopie"),
        expectedHashBefore: SHA256().describe("SHA256 der Datei unmittelbar vor dem Speichern"),
        correction: external_exports.object({
          acknowledged: external_exports.literal(true).describe(
            "Bestaetigt die ausdrueckliche menschliche Freigabe dieser Korrekturspeicherung"
          ),
          period: external_exports.string().regex(
            /^\d{4}-(?:0[1-9]|1[0-2]|Q[1-4]|YEAR)$/u,
            "Zeitraum als YYYY-MM, YYYY-Q1 bis YYYY-Q4 oder YYYY-YEAR erwartet"
          ).describe("Exakter fachlicher Korrekturzeitraum"),
          reason: external_exports.string().trim().min(3).max(500).describe("Nachvollziehbarer Grund fuer die Korrektur"),
          sourceRef: CASE_REF().describe(
            "Unveraendertes uebermitteltes Original, aus dem die Korrektur-Arbeitskopie erzeugt wurde"
          ),
          expectedSourceHash: SHA256().describe("Unveraenderter SHA256 des uebermittelten Originals"),
          backupRef: BACKUP_REF().describe(
            "Hashverifizierte Sicherung des unmittelbar vor dem Speichern bestehenden Korrekturstands"
          ),
          expectedBackupHash: SHA256().describe(
            "SHA256 der Sicherung; muss expectedHashBefore des Korrekturstands entsprechen"
          )
        }).strict().optional().describe(
          "Expliziter Korrekturmodus fuer eine als Korrektur/Berichtigung benannte Arbeitskopie. Ohne dieses Objekt bleiben uebermittelte oder unbekannte Faelle gesperrt."
        ),
        hwnd: WINDOW_HANDLE.optional().describe("Exaktes SSE-Hauptfenster; bei mehreren offenen Steuerfaellen Pflicht"),
        waitMs: external_exports.number().int().min(800).max(3e4).optional().describe("Wartezeit auf Datei- und Hash-Readback")
      }).strict(),
      "sse_file_dialog_select": external_exports.object({
        expectedDialogTitle: external_exports.string().describe("Exakter Titel des bereits offenen nativen Windows-Dateidialogs"),
        resourceRef: RESOURCE_REF(),
        expectedHash: SHA256().optional().describe("Optionaler exakter SHA256 der auszuwaehlenden Datei"),
        waitMs: external_exports.number().int().min(500).max(3e4).optional().describe("Wartezeit auf Dialog- und Datei-Readback")
      }).strict(),
      "sse_save_as": external_exports.object({
        sourceRef: CASE_REF().describe("Exakte Referenz des aktuell geoeffneten Quellfalls"),
        expectedSourceHash: SHA256(),
        targetRef: CASE_REF().describe("Explizit vom Menschen verlangte neue Falldatei; kein automatischer Sicherheitsweg"),
        waitMs: external_exports.number().int().min(800).max(3e4).optional().describe("Wartezeit auf Ziel-, Hash- und Fenstertitel-Readback")
      }).strict(),
      "sse_close": external_exports.object({
        force: external_exports.boolean().optional().describe("Nur die gebundene PID bei Haenger oder bewusstem Hart-Stopp beenden"),
        save: external_exports.boolean().optional().describe("Veraltet und gesperrt: stattdessen zuerst sse_save hashgebunden aufrufen"),
        discardChanges: external_exports.boolean().optional().describe(
          "Explizite menschliche Erlaubnis, die ungespeicherten Aenderungen genau des frisch per hwnd/pid gebundenen Falls zu verwerfen; eine Aenderungs- oder Pruefbitte reicht nicht"
        ),
        hwnd: WINDOW_HANDLE.describe("Exaktes, unmittelbar zuvor über sse_instances gebundenes SSE-Hauptfenster; immer Pflicht"),
        pid: PROCESS_ID.optional().describe("Exakte SSE-PID; bei mehreren Instanzen Pflicht")
      }).strict(),
      "sse_list_cases": external_exports.object({
        includeBackups: external_exports.boolean().optional().describe("Backup-/Sicherungsdateien zusaetzlich auflisten; Vorgabe false"),
        verbose: external_exports.boolean().optional().describe("Alle Kopffelder mitliefern (umfangreich)")
      }).strict(),
      "sse_backup_cases": external_exports.object({
        destinationRef: BACKUP_REF().describe("Neuer Sicherungsordner im lokal konfigurierten Backupbereich")
      }).strict(),
      "sse_archive_cases": external_exports.object({
        destinationRef: BACKUP_REF().describe("Neuer Archivordner im lokal konfigurierten Backupbereich"),
        cases: external_exports.array(external_exports.object({
          name: external_exports.string().describe("Exakter Dateiname im aktiven Fallordner"),
          expectedSha256: SHA256()
        }).strict()).min(1).max(SSE_OPERATION_LIMITS.archiveCases).describe("Exakte zu verschiebende Fallnamen und aktuelle SHA256"),
        expectedRemaining: external_exports.array(external_exports.object({
          name: external_exports.string().describe("Exakter Dateiname des erwarteten Restbestands"),
          expectedSha256: SHA256()
        }).strict()).min(1).max(SSE_OPERATION_LIMITS.archiveCases).describe("Vollstaendiger erwarteter Restbestand nach dem Archivieren")
      }).strict(),
      "sse_make_working_copy": external_exports.object({
        sourceRef: CASE_REF().describe("Exakte Falldatei des gesicherten aktuellen Dateistands"),
        targetRef: CASE_COPY_TARGET_REF().describe(
          "Normalerweise ein neues privates backups:-Ziel; cases: nur bei ausdruecklich verlangter Arbeitskopie"
        ),
        expectedSourceHash: SHA256().describe("Aktueller Quellhash; gleiche Fall/Hash-Kombination je Aufgabe nur einmal sichern")
      }).strict()
    };
  }
});

// src/mcp-schemas-receipts.ts
var RECEIPT_AMOUNT, RECEIPT_DATE, RECEIPT_UPDATE_VALUES, RECEIPT_CLASSIFICATION_VALUES, RECEIPT_BULK_ITEM, SSE_MCP_RECEIPT_SCHEMAS, SSE_API_RECEIPT_MANAGER_LINK_SCHEMA;
var init_mcp_schemas_receipts = __esm({
  "src/mcp-schemas-receipts.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    RECEIPT_AMOUNT = external_exports.string().regex(
      /^(?:0|[1-9]\d{0,8})(?:[.,]\d{1,2})?$/u,
      "Betrag als positive Dezimalzahl mit hoechstens zwei Nachkommastellen erwartet"
    );
    RECEIPT_DATE = external_exports.string().regex(
      /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u,
      "Datum im Format YYYY-MM-DD erwartet"
    );
    RECEIPT_UPDATE_VALUES = external_exports.object({
      title: external_exports.string().trim().min(1).max(200).optional().describe("Bezeichnung des Belegs"),
      date: RECEIPT_DATE.optional().describe("Belegdatum im Format YYYY-MM-DD"),
      documentNumber: external_exports.string().trim().max(128).optional().describe("Rechnungs- oder Belegnummer; leer zum Entfernen"),
      amount: RECEIPT_AMOUNT.optional().describe("Bruttobetrag, sofern net=false; sonst Nettobetrag"),
      vatRate: external_exports.enum(["0", "7", "19"]).optional().describe("Umsatzsteuersatz in Prozent"),
      net: external_exports.boolean().optional().describe("Ob der eingegebene Betrag als Nettobetrag behandelt wird"),
      note: external_exports.string().max(2e3).optional().describe("Optionale Belegnotiz; leer zum Entfernen")
    }).strict().refine((value) => Object.keys(value).length > 0, {
      message: "Mindestens ein Belegfeld muss gesetzt werden."
    });
    RECEIPT_CLASSIFICATION_VALUES = external_exports.object({
      categories: external_exports.array(external_exports.string().trim().min(1).max(120)).max(50).optional().describe(
        "Exakte, vollstaendige Zielmenge vorhandener BelegManager-Kategorien; leere Liste entfernt alle Kategorien"
      ),
      persons: external_exports.array(external_exports.string().trim().min(1).max(160)).max(50).optional().describe(
        "Exakte, vollstaendige Zielmenge vorhandener BelegManager-Personen; leere Liste entfernt alle Personen"
      )
    }).strict().refine((value) => value.categories !== void 0 || value.persons !== void 0, {
      message: "Mindestens categories oder persons muss angegeben werden."
    }).refine(
      (value) => [value.categories, value.persons].every(
        (items) => items === void 0 || new Set(items).size === items.length
      ),
      { message: "Kategorie- und Personenlisten duerfen keine Duplikate enthalten." }
    );
    RECEIPT_BULK_ITEM = external_exports.object({
      resourceRef: RESOURCE_REF().describe("Vorhandene Belegdatei im documents:-Bereich"),
      expectedHash: SHA256().describe("SHA-256 der unveraenderten Quelldatei"),
      identity: external_exports.union([
        external_exports.object({
          exactTitle: external_exports.string().trim().min(1).max(200).describe("Exakte Bezeichnung zur Suche nach einem bereits vorhandenen Beleg"),
          documentNumber: external_exports.string().trim().min(1).max(128).describe("Exakte Rechnungs- oder Belegnummer als zweite Identitaetskomponente")
        }).strict(),
        external_exports.object({
          exactTitle: external_exports.string().trim().min(1).max(200).describe("Exakte Bezeichnung zur Suche nach einem bereits vorhandenen Beleg"),
          date: RECEIPT_DATE.describe("Belegdatum als zweite Identitaetskomponente zusammen mit amount"),
          amount: RECEIPT_AMOUNT.describe("Belegbetrag als zweite Identitaetskomponente zusammen mit date")
        }).strict()
      ]).describe("Stabile fachliche Identitaet; ein Titel allein reicht fuer Upsert nicht aus"),
      onExisting: external_exports.enum(["update", "skip", "error"]).optional().describe(
        "Verhalten bei genau einem vorhandenen Identitaetstreffer; Vorgabe update"
      ),
      values: RECEIPT_UPDATE_VALUES.describe("Nach dem Import vollstaendig rueckzulesende Belegfelder"),
      classification: RECEIPT_CLASSIFICATION_VALUES.optional().describe(
        "Optionale, exakt aus vorhandenen Dialogoptionen gesetzte Kategorien und Personen"
      )
    }).strict();
    SSE_MCP_RECEIPT_SCHEMAS = {
      "sse_receipt_manager_action": external_exports.object({
        actionId: external_exports.enum(["showAllReceipts", "goHome"]).describe(
          "Katalogisierte, reversible BelegManager-Navigation: 'showAllReceipts' von der Startseite zur Liste oder 'goHome' von der Liste zur Startseite"
        ),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer den semantischen Zustandswechsel; Vorgabe 2500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_list": external_exports.object({
        filter: external_exports.object({
          exactTitle: external_exports.string().trim().min(1).max(200).optional().describe("Exakte Bezeichnung; Gross-/Kleinschreibung wird beachtet"),
          titleContains: external_exports.string().trim().min(1).max(200).optional().describe("Teil der Bezeichnung; Gross-/Kleinschreibung wird ignoriert"),
          draft: external_exports.boolean().optional().describe("Optional nur Entwuerfe oder nur vollstaendige Belege")
        }).strict().refine((value) => value.exactTitle !== void 0 || value.titleContains !== void 0 || value.draft !== void 0, {
          message: "Mindestens ein Filter muss angegeben werden."
        }).optional().describe("Optionaler serverseitiger Kompaktfilter; die Listenbindung bleibt auf der vollstaendigen Liste"),
        limit: external_exports.number().int().min(1).max(200).optional().describe("Hoechstens so viele kompakte Treffer zurueckgeben; Vorgabe 50"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_read": external_exports.object({
        rowRid: external_exports.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
        rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
        expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer die Detailansicht; Vorgabe 2500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_update": external_exports.object({
        rowRid: external_exports.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
        rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
        expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
        expectedDetailFingerprint: SHA256().describe("Fingerprint der zuletzt mit sse_receipt_manager_read gelesenen Detailfelder"),
        values: RECEIPT_UPDATE_VALUES.describe("Gemeinsam und gebunden zu setzende Belegfelder"),
        acknowledgeUpdate: external_exports.literal(true).describe("Bestaetigt die gebundene Aenderung genau dieses Belegs"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je Feld und fuer den abschliessenden Readback; Vorgabe 3500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_classification_options": external_exports.object({
        rowRid: external_exports.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
        rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
        expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
        expectedDetailFingerprint: SHA256().describe("Fingerprint der zuletzt gelesenen Belegdetails"),
        kind: external_exports.enum(["categories", "persons"]).describe("Zu lesender, profilierter Auswahldialog"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer Dialog und sicheren Abbruch; Vorgabe 3000 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_classify": external_exports.object({
        rowRid: external_exports.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
        rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
        expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
        expectedDetailFingerprint: SHA256().describe("Fingerprint der zuletzt gelesenen Belegdetails"),
        values: RECEIPT_CLASSIFICATION_VALUES.describe("Vollstaendige Zielmenge fuer categories und/oder persons"),
        acknowledgeClassification: external_exports.literal(true).describe("Bestaetigt die exakten Kategorie-/Personen-Zielmengen fuer diesen Beleg"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je Auswahldialog; Vorgabe 3500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_link": external_exports.object({
        items: external_exports.array(external_exports.object({
          expectedReceiptTitle: external_exports.string().trim().min(1).max(200).describe("Exakte sichtbare Bezeichnung; sie muss genau eine Zeile treffen"),
          expectedDocumentNumber: external_exports.string().trim().min(1).max(200).optional().describe("Optionale exakte Belegnummer zur eindeutigen Bindung gleichnamiger Belege"),
          receiptContentFingerprint: SHA256().optional().describe("Optionale zusaetzliche Bindung; ersetzt niemals die Eindeutigkeitspruefung"),
          linked: external_exports.boolean().describe("Gewuenschter Verknuepfungszustand")
        }).strict()).min(1).max(20).refine(
          (items) => new Set(items.map((item) => `${item.expectedReceiptTitle}\0${item.expectedDocumentNumber ?? ""}\0${item.receiptContentFingerprint ?? ""}`)).size === items.length,
          "Jeder Belegselektor darf nur einmal vorkommen."
        ).describe("Ein bis 20 Belege in einem Oeffnen-/Uebernehmen-/Readback-Zyklus"),
        expectedTargetPage: external_exports.string().trim().min(1).max(300).describe("Exakte aktuelle Steuerseite, von der der Verknuepfungsmodus gestartet wird"),
        expectedLinkTarget: external_exports.string().trim().min(1).max(200).describe("Exakter Zieltext im BelegManager, zum Beispiel Lotterie"),
        acknowledgeLinkChange: external_exports.literal(true).describe("Bestaetigt die ziel-, seiten- und beleggebundene Verknuepfungsaenderung"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je UI-Phase; Vorgabe 4000 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_bulk_upsert": external_exports.object({
        items: external_exports.array(RECEIPT_BULK_ITEM).min(1).max(20).refine(
          (items) => new Set(items.map((item) => item.resourceRef)).size === items.length,
          "Jede resourceRef darf in einem Batch nur einmal vorkommen."
        ).refine(
          (items) => new Set(items.map((item) => JSON.stringify(item.identity))).size === items.length,
          "Jede fachliche identity darf in einem Batch nur einmal vorkommen."
        ).describe("Ein bis 20 Belege; vorhandene Identitaeten werden aktualisiert oder uebersprungen, neue werden importiert"),
        acknowledgeBulkUpsert: external_exports.literal(true).describe("Bestaetigt den gebundenen Import aller aufgefuehrten Dateien"),
        stopOnError: external_exports.literal(true).optional().describe("Fail-closed ist fest: beim ersten unklaren Beleg wird gestoppt"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je UI-Phase; Vorgabe 3500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_import": external_exports.object({
        resourceRef: RESOURCE_REF().describe("Vorhandene Belegdatei im documents:-Bereich"),
        expectedHash: SHA256().describe("SHA-256 der unveraenderten Quelldatei"),
        expectedListFingerprint: SHA256().describe("Frischer Fingerprint der Belegliste aus sse_receipt_manager_list"),
        expectedCountBefore: external_exports.number().int().min(0).max(1e5).describe("Frischer Gesamtzaehler aus sse_receipt_manager_list"),
        acknowledgeImport: external_exports.literal(true).describe("Bestaetigt genau diesen lokalen, dateihashgebundenen Import als neuen Beleg"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je Importphase; Vorgabe 3500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict(),
      "sse_receipt_manager_delete": external_exports.object({
        rowRid: external_exports.string().min(3).max(512).regex(/^[0-9.-]+$/u).describe("Frische Runtime-ID der Belegzeile aus sse_receipt_manager_list"),
        rowFingerprint: SHA256().describe("Fingerprint genau dieser Zeile aus sse_receipt_manager_list"),
        expectedListFingerprint: SHA256().describe("Fingerprint der gesamten Liste aus sse_receipt_manager_list"),
        expectedCountBefore: external_exports.number().int().min(1).max(1e5).describe("Frischer Gesamtzaehler aus sse_receipt_manager_list"),
        acknowledgeDelete: external_exports.literal(true).describe("Bestaetigt die unwiderrufliche Loeschung genau des gebundenen Belegs"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit fuer Auswahl, Dialog und Listen-Readback; Vorgabe 3500 ms"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters bei mehreren offenen Faellen")
      }).strict()
    };
    SSE_API_RECEIPT_MANAGER_LINK_SCHEMA = external_exports.union([
      SSE_MCP_RECEIPT_SCHEMAS.sse_receipt_manager_link,
      external_exports.object({
        receiptContentFingerprint: SHA256().describe("Legacy-Einzelmodus: Inhaltsfingerprint des exakt gemeinten Belegs"),
        expectedReceiptTitle: external_exports.string().trim().min(1).max(200).describe("Legacy-Einzelmodus: exakte sichtbare Bezeichnung"),
        expectedDocumentNumber: external_exports.string().trim().min(1).max(200).optional().describe("Legacy-Einzelmodus: optionale exakte Belegnummer"),
        expectedTargetPage: external_exports.string().trim().min(1).max(300).describe("Exakte aktuelle Steuerseite"),
        expectedLinkTarget: external_exports.string().trim().min(1).max(200).describe("Exakter Zieltext im BelegManager"),
        linked: external_exports.boolean().describe("Gewuenschter Verknuepfungszustand"),
        acknowledgeLinkChange: external_exports.literal(true).describe("Bestaetigt die ziel-, seiten- und beleggebundene Aenderung"),
        waitMs: UI_WAIT_MS.optional().describe("Hoechste Wartezeit je UI-Phase"),
        hwnd: WINDOW_HANDLE.optional().describe("Optionales HWND des zugehoerigen SSE-Hauptfensters")
      }).strict()
    ]);
  }
});

// src/mcp-schemas-ui.ts
var TABLE_COMBO_EXPECTED_BEFORE, SSE_MCP_UI_SCHEMAS;
var init_mcp_schemas_ui = __esm({
  "src/mcp-schemas-ui.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    TABLE_COMBO_EXPECTED_BEFORE = external_exports.record(
      external_exports.string().regex(/^(?:0|[1-9][0-9]{0,2})$/u),
      external_exports.string()
    ).refine(
      (value) => Object.keys(value).length <= SSE_OPERATION_LIMITS.tableValues,
      `Hoechstens ${SSE_OPERATION_LIMITS.tableValues} ComboBox-Vorwerte`
    ).describe(
      "Erwarteter semantischer Vorwert je 0-basierter ComboBox-Spalte, z. B. {'3':'Noch nicht zugeordnet'}; fuer jede im Produktprofil typisierte und geaenderte ComboBox Pflicht"
    );
    SSE_MCP_UI_SCHEMAS = {
      "sse_tree_top": external_exports.object({
        steps: external_exports.number().int().min(1).max(80).optional().describe("Mausradschritte nach oben, Vorgabe 40"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_tree_scroll": external_exports.object({
        direction: external_exports.enum(["up", "down"]).optional().describe("Vorgabe 'down'"),
        steps: external_exports.number().int().min(1).max(80).optional().describe("Mausradschritte, Vorgabe 8"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_goto": external_exports.object({
        name: external_exports.string().optional().describe("Ueberschrift der Zielseite, z. B. 'Einnahmen: Freiberufler'"),
        pageId: external_exports.string().min(1).max(200).optional().describe(
          "Bevorzugte stabile pageId aus sse_page_objects; erkennt auch dynamische nummerierte Ueberschriften"
        ),
        maxSteps: GOTO_MAX_STEPS.optional().describe("Hoechstzahl der Blaetterschritte, Vorgabe automatisch, maximal 200"),
        direction: external_exports.enum(["Weiter", "Zurück"]).optional().describe(
          "Bei unbekannten Seiten die Suchrichtung fest vorgeben; verhindert einen langen Lauf in die falsche Richtung"
        ),
        useSearch: external_exports.boolean().optional().describe(
          "Globale Qt-Suche zuerst versuchen; Vorgabe true. Auf verstecktem Desktop fuer einen rein linearen Lauf false setzen."
        ),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_table_read": external_exports.object({
        maxRows: TABLE_MAX_ROWS.optional().describe("Obergrenze der Pfeiltastenschritte, Vorgabe 200, maximal 1000"),
        noKeys: external_exports.boolean().optional().describe(
          "Nur sichtbare Zeilen, ohne Fenster nach vorn zu holen. Damit entfaellt der Cursorlauf, und der Vollstaendigkeitsbeweis ist unmoeglich: vollstaendig bleibt false und stopKind visible-only, auch wenn zufaellig alle Zeilen sichtbar waren. Fuer einen belastbaren Tabellenstand weglassen."
        ),
        sumLabel: external_exports.string().optional().describe("Bei mehreren Tabellen: Beschriftung der zugehoerigen Kontrollsumme"),
        sumOccurrence: UI_OCCURRENCE.optional().describe("1-basierte Position der Kontrollsumme; Vorgabe 1"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_table_add": external_exports.object({
        expectedPage: external_exports.string().describe("Exakte aktuelle Seitenueberschrift"),
        werte: external_exports.array(external_exports.string()).min(1).max(SSE_OPERATION_LIMITS.tableValues).describe(
          "Werte in Spaltenreihenfolge, maximal 100 Spalten; eine im Produktprofil typisierte ComboBox wird auch als UIA-DataItem nur ueber eine exakt popupgebundene SelectionItem-Option gesetzt, niemals per ValuePattern-Text"
        ),
        comboExpectedBefore: TABLE_COMBO_EXPECTED_BEFORE.optional(),
        sumLabel: external_exports.string().describe("Beschriftung der eindeutigen Kontrollsumme"),
        sumOccurrence: UI_OCCURRENCE.optional().describe("1-basierte Position bei mehrfacher Summenbeschriftung; Vorgabe 1"),
        expectedBefore: external_exports.string().describe("Exakter Summenwert vor dem Anlegen"),
        expectedAfter: external_exports.string().describe("Exakter Summenwert nach dem Anlegen"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_table_update": external_exports.object({
        expectedPage: external_exports.string().describe("Exakte aktuelle Seitenueberschrift"),
        text: external_exports.string().describe("Eindeutiger vorhandener Zelltext der Zielzeile"),
        targetRid: external_exports.string().optional().describe(
          "Frische Runtime-ID der Zielzelle aus sse_table_add oder sse_table_update; bindet bei gleichem Text exakt"
        ),
        werte: external_exports.array(external_exports.string().nullable()).min(1).max(SSE_OPERATION_LIMITS.tableValues).describe(
          "Neue Werte in sichtbarer Spaltenreihenfolge; null ueberspringt, true/false setzt Toggle-Zellen; profilierte Tabellen-ComboBoxen werden auch als UIA-DataItem nur ueber eine exakt popupgebundene SelectionItem-Option gesetzt"
        ),
        comboExpectedBefore: TABLE_COMBO_EXPECTED_BEFORE.optional(),
        sumLabel: external_exports.string().describe("Beschriftung der Kontrollsumme, z. B. 'Summe'"),
        sumOccurrence: UI_OCCURRENCE.optional().describe(
          "1-basierte Position von oben, falls das Summenlabel mehrfach vorkommt; Vorgabe 1"
        ),
        expectedBefore: external_exports.string().describe("Exakter Summenwert vor der Aktualisierung"),
        expectedAfter: external_exports.string().describe("Exakter Summenwert nach der Aktualisierung"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_table_delete": external_exports.object({
        expectedPage: external_exports.string().describe("Exakte aktuelle Seitenueberschrift"),
        text: external_exports.string().describe("Eindeutiger Text einer Zelle der zu loeschenden Zeile"),
        targetRid: external_exports.string().optional().describe(
          "Frische Runtime-ID der Zielzelle aus sse_table_update; bindet bei gleichem Text exakt"
        ),
        sumLabel: external_exports.string().describe("Beschriftung der Kontrollsumme, z. B. 'Summe der Einnahmen'"),
        sumOccurrence: UI_OCCURRENCE.optional().describe(
          "1-basierte Position von oben, falls dasselbe Summenlabel mehrfach vorkommt"
        ),
        expectedBefore: external_exports.string().describe("Exakter Wert der Kontrollsumme vor dem Loeschen, z. B. '89.340,00'"),
        expectedAfter: external_exports.string().describe("Exakter Wert der Kontrollsumme nach dem Loeschen, z. B. '83.940,00'"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_menu": external_exports.object({ name: external_exports.string().optional().describe("z. B. 'Extras'"), hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_menu_click": external_exports.object({
        name: external_exports.string().describe("Exakter sichtbarer Menueeintrag aus sse_menu"),
        waitMs: UI_WAIT_MS.optional(),
        acknowledgeDestructive: external_exports.boolean().optional().describe("Fuer einen lokal destruktiv benannten Menueeintrag bewusst einmalig true"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_menu_close": external_exports.object({
        name: external_exports.string().optional().describe("Optional das geoeffnete Hauptmenue, z. B. 'Datei'"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_ui_state": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        previousFingerprint: external_exports.string().regex(/^[A-Fa-f0-9]{64}$/).optional().describe(
          "stateFingerprint des vorherigen sse_ui_state; liefert changedSince ohne den alten Zustand erneut zu uebertragen"
        )
      }).strict(),
      "sse_dismiss": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_screenshot": external_exports.object({
        hwnd: WINDOW_HANDLE.optional().describe("Fensterhandle; ohne Angabe wird automatisch gewaehlt (Dialog vor Hauptfenster)"),
        resultRef: RESULT_REF().describe("Zieldatei .png im konfigurierten Ergebnisbereich"),
        includeImage: external_exports.boolean().optional().describe("Bild zusaetzlich als Base64 mitliefern (Vorgabe: nein)")
      }).strict(),
      "sse_read_page": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        minX: UI_COORDINATE.optional().describe("Linke Grenze ueberschreiben (sonst automatisch: rechts vom Navigationsbaum)"),
        maxX: UI_COORDINATE.optional().describe("Rechte Grenze ueberschreiben (sonst automatisch: links von der Hilfespalte)")
      }).strict(),
      "sse_read_table": external_exports.object({ hwnd: WINDOW_HANDLE.optional() }).strict(),
      "sse_snapshot": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        toolWindow: external_exports.string().min(1).max(64).optional().describe(
          "Statt des Hauptfensters ein katalogisiertes nichtmodales Nebenfenster lesen: 'receiptManager' (BelegManager), 'taxTips' (Steuer-Spar-Tipps) oder 'resultComparison' (Werte-Info). Nur lesen - diese Fenster lassen sich nicht bedienen. Ohne diese Angabe haengt es von Fenstergroesse und Knotenbudget ab, wie viel von ihrem Teilbaum ueberhaupt ankommt; beim BelegManager blieb auf einem Rechner nur der Titel uebrig."
        ),
        types: external_exports.array(external_exports.string()).max(SSE_OPERATION_LIMITS.snapshotTypes).optional().describe("Nur diese Steuerelementtypen, z. B. ['Button','Edit']; maximal 50"),
        namedOnly: external_exports.boolean().optional().describe("Nur Elemente mit Beschriftung"),
        maxNodes: SNAPSHOT_MAX_NODES.optional().describe("Maximale Knotenzahl; Vorgabe 2000, Maximum 5000")
      }).strict(),
      "sse_snapshot_compare": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        repetitions: external_exports.number().int().min(1).max(10).optional().describe(
          "Unmittelbare Legacy/Bulk-Vergleichspaare im selben Worker; Vorgabe 3, mindestens ein exaktes Paar ist fuer Paritaet erforderlich"
        )
      }).strict(),
      "sse_accessibility_probe": external_exports.object({
        hwnd: WINDOW_HANDLE.optional(),
        rid: external_exports.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
        aid: external_exports.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
        name: external_exports.string().optional().describe("Exakte sichtbare Beschriftung"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        type: external_exports.string().optional().describe("Optionaler UIA-Steuerelementtyp"),
        maxDepth: external_exports.number().int().min(1).max(10).optional().describe("Maximale RawView-Tiefe; hoechstens 10"),
        maxNodes: external_exports.number().int().min(1).max(500).optional().describe("Maximale Zahl untersuchter RawView-Knoten"),
        includePatterns: external_exports.boolean().optional().describe("Unterstuetzte UIA-Muster mitliefern"),
        includeRaw: external_exports.boolean().optional().describe("Begrenzten UIA-RawView-Unterbaum mitliefern"),
        includeMsaa: external_exports.boolean().optional().describe("Begrenzte MSAA-Punktprobe mitliefern")
      }).strict(),
      "sse_find": external_exports.object({
        name: external_exports.string().optional().describe("Beschriftung des Elements"),
        aid: external_exports.string().optional().describe(
          "AutomationId, z. B. '.MainToolBar.QWidget.SearchSSE.QLineEdit'. Stabiler als der Name; Endstueck genuegt. Unbeschriftete Felder sind nur so adressierbar."
        ),
        contains: external_exports.boolean().optional().describe("Teilstringsuche statt exakt"),
        type: external_exports.string().optional().describe("Auf Steuerelementtyp einschraenken, z. B. 'Button'"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict(),
      "sse_get_value": external_exports.object({
        name: external_exports.string().optional().describe("Exakte sichtbare Beschriftung des Zielfelds"),
        aid: external_exports.string().optional().describe("AutomationId oder eindeutiges Endstueck"),
        rid: external_exports.string().optional().describe("RuntimeId aus einem unmittelbar vorherigen Snapshot"),
        type: external_exports.string().optional().describe("Optionaler UIA-Steuerelementtyp, z. B. 'Edit'"),
        contains: external_exports.boolean().optional().describe("Teilstringsuche fuer name statt exakter Uebereinstimmung"),
        hwnd: WINDOW_HANDLE.optional()
      }).strict()
    };
  }
});

// src/mcp-operation-schemas.ts
var SSE_MCP_TOOL_SCHEMAS;
var init_mcp_operation_schemas = __esm({
  "src/mcp-operation-schemas.ts"() {
    "use strict";
    init_mcp_schemas_analysis();
    init_mcp_schemas_desktop();
    init_mcp_schemas_diagnostics();
    init_mcp_schemas_interaction();
    init_mcp_schemas_lifecycle();
    init_mcp_schemas_receipts();
    init_mcp_schemas_ui();
    SSE_MCP_TOOL_SCHEMAS = {
      ...SSE_MCP_DIAGNOSTIC_SCHEMAS,
      ...SSE_MCP_ANALYSIS_SCHEMAS,
      ...SSE_MCP_DESKTOP_SCHEMAS,
      ...SSE_MCP_UI_SCHEMAS,
      ...SSE_MCP_RECEIPT_SCHEMAS,
      ...SSE_MCP_INTERACTION_SCHEMAS,
      ...SSE_MCP_LIFECYCLE_SCHEMAS
    };
  }
});

// src/operation-schema-goto.ts
var SSE_API_GOTO_SCHEMA;
var init_operation_schema_goto = __esm({
  "src/operation-schema-goto.ts"() {
    "use strict";
    init_zod();
    init_operation_schema_primitives();
    SSE_API_GOTO_SCHEMA = external_exports.object({
      name: external_exports.string().optional().describe("Moderner Alias fuer die exakte Zielseitenueberschrift"),
      ziel: external_exports.string().optional().describe("Exakte Zielseitenueberschrift; historischer API-Name"),
      pageId: external_exports.string().min(1).max(200).optional().describe(
        "Stabile Page-Object-ID; bindet dynamische Ueberschriften und Pflichtfelder semantisch"
      ),
      maxSteps: GOTO_MAX_STEPS.optional(),
      direction: external_exports.enum(["Weiter", "Zurück"]).optional().describe("Explizite lineare Suchrichtung"),
      useSearch: external_exports.boolean().optional().describe("Moderne Option fuer die globale Qt-Suche; Vorgabe true"),
      viaSuche: external_exports.boolean().optional().describe("Historischer Alias fuer useSearch"),
      hwnd: WINDOW_HANDLE.optional()
    }).strict().superRefine((value, context) => {
      const hasHeading = value.name !== void 0 || value.ziel !== void 0;
      if (hasHeading === (value.pageId !== void 0)) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, message: "Genau pageId oder name/ziel ist erforderlich." });
      }
      if (value.name !== void 0 && value.ziel !== void 0 && value.name !== value.ziel) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, message: "'name' und 'ziel' widersprechen sich." });
      }
      if (value.useSearch !== void 0 && value.viaSuche !== void 0 && value.useSearch !== value.viaSuche) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, message: "'useSearch' und 'viaSuche' widersprechen sich." });
      }
    }).transform(({ name, ziel, useSearch, ...value }) => ({
      ...value,
      ...ziel !== void 0 || name !== void 0 ? { ziel: ziel ?? name } : {},
      ...value.viaSuche === void 0 && useSearch !== void 0 ? { viaSuche: useSearch } : {}
    }));
  }
});

// src/operation-catalog.ts
function withLegacyAlias(schema, alias, legacy) {
  const shape = { ...schema.shape };
  shape[alias] = shape[alias].optional();
  shape[legacy] = API_LOCAL_PATH.optional();
  return external_exports.object(shape).strict().superRefine((value, context) => {
    const hasAlias = value[alias] !== void 0;
    const hasLegacy = value[legacy] !== void 0;
    if (hasAlias === hasLegacy) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `Genau eines von '${alias}' oder '${legacy}' muss angegeben werden.`
      });
    }
  });
}
function optionalAliasWithLegacy(schema, alias, legacy) {
  const shape = { ...schema.shape };
  shape[alias] = shape[alias].optional();
  shape[legacy] = API_LOCAL_PATH.optional();
  return external_exports.object(shape).strict().superRefine((value, context) => {
    if (value[alias] !== void 0 && value[legacy] !== void 0) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `'${alias}' und '${legacy}' duerfen nicht gemeinsam angegeben werden.`
      });
    }
  });
}
function withLegacyAliases(schema, pairs) {
  const shape = { ...schema.shape };
  for (const [alias, legacy] of pairs) {
    shape[alias] = shape[alias].optional();
    shape[legacy] = API_LOCAL_PATH.optional();
  }
  return external_exports.object(shape).strict().superRefine((value, context) => {
    for (const [alias, legacy] of pairs) {
      if (value[alias] !== void 0 === (value[legacy] !== void 0)) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: `Genau eines von '${alias}' oder '${legacy}' muss angegeben werden.`
        });
      }
    }
  });
}
function extendStrict(schema, extension) {
  return external_exports.object({ ...schema.shape, ...extension }).strict();
}
function requireCaseHashBinding(schema) {
  return schema.superRefine((value, context) => {
    const hasCase = value.expectedCaseRef !== void 0 || value.expectedCasePath !== void 0;
    const hasHash = value.expectedCaseHash !== void 0;
    if (hasCase !== hasHash) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: "Steuerfallreferenz/-pfad und expectedCaseHash muessen gemeinsam angegeben werden."
      });
    }
  });
}
function requireSelector(schema, operation, selectors, containsRequiresName = false) {
  return schema.superRefine((value, context) => {
    if (!selectors.some((selector) => typeof value[selector] === "string" && value[selector] !== "")) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `${operation} braucht einen Bezeichner: ${selectors.join(", ")}.`
      });
    }
    if (containsRequiresName && value.contains === true && !value.name) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["contains"],
        message: "contains=true ist nur zusammen mit 'name' erlaubt."
      });
    }
  });
}
function argumentLimitError(path, message) {
  throw new external_exports.ZodError([{ code: external_exports.ZodIssueCode.custom, path, message }]);
}
function assertApiArgumentBudget(operation, args, initialPath = []) {
  let nodes = 0;
  const visit = (value, path, depth) => {
    nodes += 1;
    if (nodes > MAX_API_ARGUMENT_NODES) {
      argumentLimitError(path, `Operationsargumente duerfen hoechstens ${MAX_API_ARGUMENT_NODES} Werte enthalten.`);
    }
    if (depth > MAX_API_ARGUMENT_DEPTH) {
      argumentLimitError(path, `Operationsargumente duerfen hoechstens ${MAX_API_ARGUMENT_DEPTH} Ebenen tief sein.`);
    }
    if (typeof value === "string") {
      const limit = operation === "workspace_file_write_text" && path.length === 1 && path[0] === "text" ? MAX_WORKSPACE_TEXT_BYTES : MAX_API_ARGUMENT_STRING_BYTES;
      if (Buffer.byteLength(value) > limit) {
        argumentLimitError(path, `Zeichenkette ist groesser als ${limit} UTF-8-Bytes.`);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_API_ARGUMENT_COLLECTION_ITEMS) {
        argumentLimitError(path, `Liste darf hoechstens ${MAX_API_ARGUMENT_COLLECTION_ITEMS} Eintraege enthalten.`);
      }
      value.forEach((entry, index) => visit(entry, [...path, index], depth + 1));
      return;
    }
    if (!value || typeof value !== "object") return;
    const entries = Object.entries(value);
    if (entries.length > MAX_API_ARGUMENT_COLLECTION_ITEMS) {
      argumentLimitError(path, `Objekt darf hoechstens ${MAX_API_ARGUMENT_COLLECTION_ITEMS} Felder enthalten.`);
    }
    entries.forEach(([key, entry]) => visit(entry, [...path, key], depth + 1));
  };
  visit(args, initialPath, initialPath.length);
}
function parseApiOperationArgs(operation, args) {
  const parsed = SSE_API_OPERATION_SCHEMAS[operation].parse(args);
  assertApiArgumentBudget(operation, parsed);
  return parsed;
}
function parseCheckerReadOnlyClickArgs(args) {
  const parsed = checkerReadOnlyClickSchema.parse(args);
  assertApiArgumentBudget("click_point", parsed);
  return parsed;
}
function acceptedArgumentKeys(schema, keys = /* @__PURE__ */ new Set()) {
  const def = schema?._def;
  if (!def) return keys;
  if (def.typeName === "ZodObject") {
    for (const key of Object.keys(schema.shape)) keys.add(key);
  } else if (def.typeName === "ZodUnion") {
    for (const option of def.options) acceptedArgumentKeys(option, keys);
  } else if (def.typeName === "ZodEffects") {
    acceptedArgumentKeys(def.schema, keys);
  } else if (def.typeName === "ZodIntersection") {
    acceptedArgumentKeys(def.left, keys);
    acceptedArgumentKeys(def.right, keys);
  }
  return keys;
}
function hasUnrecognizedKey(issues) {
  return issues.some((issue) => issue.code === external_exports.ZodIssueCode.unrecognized_keys || issue.code === external_exports.ZodIssueCode.invalid_union && issue.unionErrors.some((entry) => hasUnrecognizedKey(entry.issues)));
}
function formatOperationArgumentError(error, operation) {
  const containsCustomIssue = (issues) => issues.some((issue) => issue.code === external_exports.ZodIssueCode.custom || issue.code === external_exports.ZodIssueCode.invalid_union && issue.unionErrors.some((entry) => containsCustomIssue(entry.issues)));
  const formatIssue = (issue) => {
    if (issue.code === external_exports.ZodIssueCode.invalid_union) {
      const candidates = issue.unionErrors.map((unionError) => ({
        custom: containsCustomIssue(unionError.issues),
        messages: unionError.issues.flatMap(formatIssue)
      }));
      const preferred = candidates.some((candidate) => candidate.custom) ? candidates.filter((candidate) => candidate.custom) : candidates;
      const alternatives = preferred.map((candidate) => candidate.messages).sort((left, right) => left.length - right.length || left.join("; ").length - right.join("; ").length);
      return alternatives[0] ?? [issue.message];
    }
    const path = issue.path.length ? `'${issue.path.join(".")}' ` : "";
    return [`${path}${issue.message}`];
  };
  const message = [...new Set(error.issues.flatMap(formatIssue))].join("; ");
  if (!operation || !hasUnrecognizedKey(error.issues)) return message;
  const erlaubt = [...acceptedArgumentKeys(SSE_API_OPERATION_SCHEMAS[operation])].sort();
  if (!erlaubt.length) return message;
  return `${message.replace(/\.$/u, "")}. Erlaubt sind: ${erlaubt.join(", ")}`;
}
var SSE_MCP_COMPOSED_TOOL_OPERATIONS, SSE_MCP_TOOL_OPERATIONS, RESOURCE_AREA, API_TEXT_WRITE_AREA, API_LOCAL_PATH, schemasByOperation, checkerReadOnlyClickSchema, SSE_API_OPERATION_SCHEMAS, MAX_API_ARGUMENT_STRING_BYTES, MAX_API_ARGUMENT_COLLECTION_ITEMS, MAX_API_ARGUMENT_DEPTH, MAX_API_ARGUMENT_NODES;
var init_operation_catalog = __esm({
  "src/operation-catalog.ts"() {
    "use strict";
    init_zod();
    init_api_contract();
    init_mcp_operation_schemas();
    init_mcp_schemas_receipts();
    init_operation_schema_goto();
    init_operation_schema_primitives();
    init_operation_schema_primitives();
    init_mcp_operation_schemas();
    SSE_MCP_COMPOSED_TOOL_OPERATIONS = {
      "sse_preflight": ["workspace_status", "product_info", "health"]
    };
    SSE_MCP_TOOL_OPERATIONS = {
      "sse_product_info": "product_info",
      "sse_capabilities": "capabilities",
      "sse_page_objects": "page_objects",
      "sse_page_state": "known_page_state",
      "sse_workspace_status": "workspace_status",
      "sse_workspace_files": "workspace_file_list",
      "sse_workspace_read_text": "workspace_file_read_text",
      "sse_workspace_write_text": "workspace_file_write_text",
      "sse_run_scenario": "scenario_run",
      "sse_health": "health",
      "sse_windows": "windows",
      "sse_instances": "instances",
      "sse_center_cases": "center_cases",
      "sse_center_refresh": "center_refresh",
      "sse_window_close": "window_close",
      "sse_window_restore": "window_restore",
      "sse_case_hash": "case_hash",
      "sse_dialog_list": "dialog_list",
      "sse_dialog_answer": "dialog_answer",
      "sse_warning_popup_read": "warning_popup_read",
      "sse_vast_dialog_read": "vast_dialog_read",
      "sse_vast_row_details": "vast_row_details",
      "sse_vast_row_set_expanded": "vast_row_set_expanded",
      "sse_vast_mapping_options": "vast_mapping_options",
      "sse_vast_mapping_select": "vast_mapping_select",
      "sse_vast_apply": "vast_apply",
      "sse_read_full": "read_full",
      "sse_scroll_page": "scroll_page",
      "sse_help": "help",
      "sse_subpages": "subpages",
      "sse_check_page": "check",
      "sse_result_details": "result_details",
      "sse_checker_results": "checker_results",
      "sse_checker_run": "checker_run",
      "sse_checker_reset": "checker_reset",
      "sse_checker_open": "checker_open",
      "sse_checker_close": "checker_close",
      "sse_desktop_start": "desktop_start",
      "sse_desktop_stop": "desktop_stop",
      "sse_desktop_status": "desktop_status",
      "sse_page": "page",
      "sse_positions": "positions",
      "sse_export_csv": "export_csv",
      "sse_collect": "collect",
      "sse_verify": "verify",
      "sse_tree_top": "tree_top",
      "sse_tree_scroll": "tree_scroll",
      "sse_goto": "goto",
      "sse_table_read": "table_read",
      "sse_table_add": "table_add",
      "sse_table_update": "table_update",
      "sse_table_delete": "table_delete",
      "sse_menu": "menu",
      "sse_menu_click": "menu_click",
      "sse_menu_close": "menu_close",
      "sse_receipt_manager_action": "receipt_manager_action",
      "sse_receipt_manager_bulk_upsert": "receipt_manager_bulk_upsert",
      "sse_receipt_manager_classification_options": "receipt_manager_classification_options",
      "sse_receipt_manager_classify": "receipt_manager_classify",
      "sse_receipt_manager_link": "receipt_manager_link",
      "sse_receipt_manager_delete": "receipt_manager_delete",
      "sse_receipt_manager_import": "receipt_manager_import",
      "sse_receipt_manager_list": "receipt_manager_list",
      "sse_receipt_manager_read": "receipt_manager_read",
      "sse_receipt_manager_update": "receipt_manager_update",
      "sse_ui_state": "ui_state",
      "sse_dismiss": "dismiss",
      "sse_screenshot": "screenshot",
      "sse_read_page": "read_page",
      "sse_read_table": "read_table",
      "sse_snapshot": "snapshot",
      "sse_snapshot_compare": "snapshot_compare",
      "sse_accessibility_probe": "accessibility_probe",
      "sse_find": "find",
      "sse_get_value": "get_value",
      "sse_click": "click",
      "sse_toggle": "toggle",
      "sse_click_point": "click_point",
      "sse_set_value": "set_value",
      "sse_change_field": "tracked_set_value",
      "sse_change_known_field": "tracked_set_value",
      "sse_combo_options": "combo_options",
      "sse_combo_select": "combo_select",
      "sse_ustva_read": "ustva_read",
      "sse_ustva_select_period": "ustva_select_period",
      "sse_ustva_set_flag": "ustva_set_flag",
      "sse_ustva_change_value": "ustva_change_value",
      "sse_ustva_open_section": "ustva_open_section",
      "sse_scroll": "scroll",
      "sse_launch": "launch",
      "sse_case_create": "case_create",
      "sse_save": "save",
      "sse_file_dialog_select": "file_dialog_select",
      "sse_fill_fields": "fill_fields",
      "sse_save_as": "save_as",
      "sse_close": "close",
      "sse_list_cases": "list_cases",
      "sse_backup_cases": "backup_cases",
      "sse_archive_cases": "archive_cases",
      "sse_make_working_copy": "make_working_copy"
    };
    RESOURCE_AREA = external_exports.enum(["cases", "documents", "workspace", "results", "backups"]).describe("Lokal konfigurierter Ressourcenbereich fuer einen relativen ref-Wert");
    API_TEXT_WRITE_AREA = external_exports.enum(["workspace", "results"]).describe(
      "Schreibbarer Ressourcenbereich; den Bereich nicht im relativen ref wiederholen"
    );
    API_LOCAL_PATH = external_exports.string().min(1).refine(
      (value) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !/[\x00-\x1f*?"<>|]/.test(value),
      "Absoluter Windows-Pfad ohne Platzhalter erwartet"
    ).describe("API-only Windows-Pfad; Ressourcenreferenz bevorzugen");
    schemasByOperation = {};
    for (const [toolName, operation] of Object.entries(SSE_MCP_TOOL_OPERATIONS)) {
      schemasByOperation[operation] ??= SSE_MCP_TOOL_SCHEMAS[toolName];
    }
    schemasByOperation.tracked_set_value = requireCaseHashBinding(external_exports.union([
      requireSelector(
        optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_change_field, "expectedCaseRef", "expectedCasePath"),
        "sse_change_field",
        ["name", "aid", "rid"],
        true
      ),
      optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_change_known_field, "expectedCaseRef", "expectedCasePath")
    ]));
    schemasByOperation.combo_select = requireCaseHashBinding(requireSelector(
      optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_combo_select, "expectedCaseRef", "expectedCasePath"),
      "sse_combo_select",
      ["name", "aid", "rid"],
      true
    ));
    schemasByOperation.toggle = requireCaseHashBinding(requireSelector(
      optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_toggle, "expectedCaseRef", "expectedCasePath"),
      "sse_toggle",
      ["name", "aid", "rid"],
      true
    ));
    schemasByOperation.find = requireSelector(SSE_MCP_TOOL_SCHEMAS.sse_find, "sse_find", ["name", "aid", "type"], true);
    schemasByOperation.get_value = requireSelector(
      SSE_MCP_TOOL_SCHEMAS.sse_get_value,
      "sse_get_value",
      ["name", "aid", "rid"],
      true
    );
    schemasByOperation.combo_options = requireSelector(
      SSE_MCP_TOOL_SCHEMAS.sse_combo_options,
      "sse_combo_options",
      ["name", "aid", "rid"],
      true
    );
    schemasByOperation.vast_apply = withLegacyAlias(
      SSE_MCP_TOOL_SCHEMAS.sse_vast_apply,
      "expectedCaseRef",
      "expectedCasePath"
    );
    schemasByOperation.checker_detail = external_exports.object({
      name: external_exports.string().min(1).describe("Exakter Prueferhinweis aus checker_results"),
      hwnd: WINDOW_HANDLE.optional()
    }).strict();
    schemasByOperation.click = external_exports.object({
      ...SSE_MCP_TOOL_SCHEMAS.sse_click.shape,
      // Nur die direkte API versteht den historischen Wert noch, um ihn mit
      // einer klaren Migrationsmeldung abzuweisen. MCP bewirbt ihn nicht mehr.
      pattern: external_exports.enum(SSE_API_CLICK_PATTERNS).optional().describe(
        "UIA-Aktionsmuster; toggle wird nur fuer eine klare Migrationsmeldung akzeptiert und danach gesperrt"
      )
    }).strict().superRefine((value, context) => {
      if (!value.name && !value.aid && !value.rid) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: "sse_click braucht einen Bezeichner: name, aid oder rid."
        });
      }
      if (value.pattern === "toggle") {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["pattern"],
          message: "Direktes TogglePattern ist gesperrt; Checkboxen mit sse_toggle setzen."
        });
      }
      if (value.pattern === "select" && !value.aid) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["aid"],
          message: "pattern='select' verlangt eine exakte AutomationId (aid)."
        });
      }
    });
    schemasByOperation.click_point = SSE_MCP_TOOL_SCHEMAS.sse_click_point.superRefine((value, context) => {
      if (!value.name && !value.aid && !value.rid) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: "sse_click_point braucht einen Bezeichner: name, aid oder rid."
        });
      }
    });
    schemasByOperation.read_page = SSE_MCP_TOOL_SCHEMAS.sse_read_page.superRefine((value, context) => {
      if (value.minX !== void 0 && value.maxX !== void 0 && value.minX > value.maxX) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["maxX"],
          message: "maxX muss groesser oder gleich minX sein."
        });
      }
    });
    checkerReadOnlyClickSchema = extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_click_point, {
      checkerReadOnly: external_exports.literal(true)
    });
    schemasByOperation.goto = SSE_API_GOTO_SCHEMA;
    schemasByOperation.workspace_file_list = external_exports.object({
      ref: external_exports.union([RESOURCE_REF(), BARE_RESOURCE_REF()]).optional().describe("Bereichsreferenz oder relativer Pfad innerhalb von area"),
      area: RESOURCE_AREA.optional(),
      limit: external_exports.number().int("'limit' muss eine ganze Zahl sein.").min(1).max(2e3).optional().describe("Maximale Zahl gelisteter Dateien; Vorgabe 500, Maximum 2000"),
      includeHashes: external_exports.boolean().optional().describe("SHA256 berechnen; Vorgabe true")
    }).strict();
    schemasByOperation.workspace_file_read_text = external_exports.object({
      ref: external_exports.union([RESOURCE_REF(), BARE_RESOURCE_REF()]).describe("Bereichsreferenz oder relativer Textdateipfad innerhalb von area"),
      area: RESOURCE_AREA.optional()
    }).strict();
    schemasByOperation.workspace_file_write_text = external_exports.object({
      ref: external_exports.union([TEXT_WRITE_REF(), BARE_RESOURCE_REF()]).describe(
        "Neue Textdateireferenz (z. B. results:bericht.md) oder relativer Pfad innerhalb von area; bei area='results' also 'bericht.md', nicht 'results/bericht.md'"
      ),
      area: API_TEXT_WRITE_AREA.optional(),
      text: external_exports.string().describe("Vollstaendiger UTF-8-Inhalt der exklusiv neu anzulegenden Datei")
    }).strict();
    schemasByOperation.scenario_run = external_exports.object({
      scenarioRef: external_exports.union([WORKSPACE_REF(), BARE_RESOURCE_REF()]).describe("Szenariodatei unter workspace: oder relativer Workspace-Pfad"),
      resultRef: external_exports.union([RESULT_REF(), BARE_RESOURCE_REF()]).optional().describe("Neue Ergebnisreferenz unter results: oder relativer Ergebnispfad")
    }).strict();
    schemasByOperation.case_hash = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_case_hash, "ref", "path");
    schemasByOperation.center_refresh = external_exports.object({
      ...SSE_MCP_TOOL_SCHEMAS.sse_center_refresh.shape,
      expectedDirectory: API_LOCAL_PATH.optional()
    }).strict().superRefine((value, context) => {
      const preconditions = [value.expectedDirectoryRef, value.expectedDirectory, value.expectedMode].filter((entry) => entry !== void 0);
      if (preconditions.length !== 1) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: "Genau eines von 'expectedDirectoryRef', 'expectedDirectory' oder 'expectedMode' muss angegeben werden."
        });
      }
    });
    schemasByOperation.window_close = external_exports.object({
      pid: PROCESS_ID,
      hwnd: WINDOW_HANDLE,
      titleFingerprint: SHA256().optional(),
      expectedTitle: external_exports.string().min(1).optional().describe("API-only exakter aktueller Fenstertitel statt Fingerprint"),
      waitMs: external_exports.number().int().min(300).max(1e4).optional().describe("Wartezeit auf das Schliessen in Millisekunden")
    }).strict().superRefine((value, context) => {
      if (value.titleFingerprint === void 0 === (value.expectedTitle === void 0)) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: "Genau eines von 'titleFingerprint' oder 'expectedTitle' muss angegeben werden."
        });
      }
    });
    schemasByOperation.desktop_start = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_desktop_start, "caseRef", "file");
    schemasByOperation.launch = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_launch, "caseRef", "file");
    schemasByOperation.case_create = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_case_create, "targetRef", "targetPath");
    schemasByOperation.collect = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_collect, "resultRef", "path");
    schemasByOperation.export_csv = optionalAliasWithLegacy(SSE_MCP_TOOL_SCHEMAS.sse_export_csv, "resultRef", "dir");
    schemasByOperation.verify = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_verify, "sourceRef", "from");
    schemasByOperation.screenshot = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_screenshot, "resultRef", "path");
    schemasByOperation.save = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_save, "caseRef", "expectedPath");
    schemasByOperation.file_dialog_select = withLegacyAlias(SSE_MCP_TOOL_SCHEMAS.sse_file_dialog_select, "resourceRef", "expectedPath");
    schemasByOperation.receipt_manager_import = withLegacyAlias(
      SSE_MCP_TOOL_SCHEMAS.sse_receipt_manager_import,
      "resourceRef",
      "expectedPath"
    );
    schemasByOperation.receipt_manager_link = SSE_API_RECEIPT_MANAGER_LINK_SCHEMA;
    schemasByOperation.save_as = withLegacyAliases(SSE_MCP_TOOL_SCHEMAS.sse_save_as, [
      ["sourceRef", "expectedSourcePath"],
      ["targetRef", "targetPath"]
    ]);
    schemasByOperation.make_working_copy = withLegacyAliases(SSE_MCP_TOOL_SCHEMAS.sse_make_working_copy, [
      ["sourceRef", "source"],
      ["targetRef", "target"]
    ]);
    schemasByOperation.backup_cases = withLegacyAlias(
      extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_backup_cases, { dir: API_LOCAL_PATH.optional() }),
      "destinationRef",
      "dest"
    );
    schemasByOperation.archive_cases = withLegacyAlias(
      extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_archive_cases, { dir: API_LOCAL_PATH.optional() }),
      "destinationRef",
      "dest"
    );
    schemasByOperation.list_cases = extendStrict(SSE_MCP_TOOL_SCHEMAS.sse_list_cases, { dir: API_LOCAL_PATH.optional() });
    for (const operation of SSE_API_OPERATIONS) {
      if (!schemasByOperation[operation]) throw new Error(`Kein API-Argumentschema fuer '${operation}'.`);
    }
    SSE_API_OPERATION_SCHEMAS = Object.freeze(
      schemasByOperation
    );
    MAX_API_ARGUMENT_STRING_BYTES = 64 * 1024;
    MAX_API_ARGUMENT_COLLECTION_ITEMS = 2e3;
    MAX_API_ARGUMENT_DEPTH = 32;
    MAX_API_ARGUMENT_NODES = 5e4;
  }
});

// src/operation-traits.ts
function operationAnnotations(operation) {
  const readOnly = READ_ONLY_SET.has(operation);
  return {
    readOnlyHint: readOnly,
    destructiveHint: DESTRUCTIVE_SET.has(operation),
    idempotentHint: readOnly,
    openWorldHint: false
  };
}
var SSE_READ_ONLY_OPERATIONS, SSE_DESTRUCTIVE_OPERATIONS, READ_ONLY_SET, DESTRUCTIVE_SET, SSE_STATEFUL_OPERATIONS, SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS, SSE_CLEANUP_OPERATIONS, SSE_BUILD_DRIFT_BLOCKED_OPERATIONS;
var init_operation_traits = __esm({
  "src/operation-traits.ts"() {
    "use strict";
    init_api_contract();
    SSE_READ_ONLY_OPERATIONS = [
      "accessibility_probe",
      "capabilities",
      "case_hash",
      "center_cases",
      "checker_results",
      "dialog_list",
      "find",
      "get_value",
      "health",
      "help",
      "instances",
      "known_page_state",
      "list_cases",
      "page",
      "page_objects",
      "positions",
      "product_info",
      "read_full",
      "read_page",
      "read_table",
      "receipt_manager_list",
      "result_details",
      "snapshot",
      "snapshot_compare",
      "subpages",
      "ui_state",
      "ustva_read",
      "vast_dialog_read",
      "vast_mapping_options",
      "vast_row_details",
      "verify",
      "warning_popup_read",
      "windows",
      "workspace_file_list",
      "workspace_file_read_text",
      "workspace_status"
    ];
    SSE_DESTRUCTIVE_OPERATIONS = [
      "archive_cases",
      "case_create",
      "click",
      "click_point",
      "close",
      "combo_select",
      "desktop_stop",
      "dialog_answer",
      "file_dialog_select",
      "fill_fields",
      "menu_click",
      "receipt_manager_delete",
      "receipt_manager_bulk_upsert",
      "receipt_manager_classify",
      "receipt_manager_link",
      "receipt_manager_import",
      "receipt_manager_update",
      "save",
      "save_as",
      "scenario_run",
      "table_add",
      "table_delete",
      "table_update",
      "toggle",
      "tracked_set_value",
      "ustva_change_value",
      "ustva_select_period",
      "ustva_set_flag",
      "vast_apply",
      "vast_mapping_select"
    ];
    READ_ONLY_SET = new Set(SSE_READ_ONLY_OPERATIONS);
    DESTRUCTIVE_SET = new Set(SSE_DESTRUCTIVE_OPERATIONS);
    SSE_STATEFUL_OPERATIONS = Object.freeze(
      SSE_API_OPERATIONS.filter((operation) => !READ_ONLY_SET.has(operation))
    );
    SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS = Object.freeze(
      SSE_STATEFUL_OPERATIONS.filter((operation) => !DESTRUCTIVE_SET.has(operation))
    );
    SSE_CLEANUP_OPERATIONS = [
      "checker_close",
      "checker_reset",
      "close",
      "desktop_stop",
      "dismiss",
      "menu_close",
      "window_close"
    ];
    SSE_BUILD_DRIFT_BLOCKED_OPERATIONS = [
      "case_create",
      "checker_run",
      "click",
      "click_point",
      "combo_select",
      "dialog_answer",
      "file_dialog_select",
      "fill_fields",
      "goto",
      "menu_click",
      "receipt_manager_action",
      "receipt_manager_bulk_upsert",
      "receipt_manager_classification_options",
      "receipt_manager_classify",
      "receipt_manager_link",
      "receipt_manager_delete",
      "receipt_manager_import",
      "receipt_manager_read",
      "receipt_manager_update",
      "save",
      "save_as",
      "set_value",
      "table_add",
      "table_delete",
      "table_update",
      "toggle",
      "tracked_set_value",
      "ustva_change_value",
      "ustva_open_section",
      "ustva_select_period",
      "ustva_set_flag",
      "vast_apply",
      "vast_mapping_select",
      "vast_row_set_expanded"
    ];
  }
});

// src/operation-live-evidence.ts
var SSE_LIVE_EVIDENCE_SCHEMA_VERSION, SSE_LIVE_EVIDENCE_BASIS, SSE_LIVE_EVIDENCE_SCOPE, SSE_LIVE_EVIDENCE_STATUSES, SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS, SSE_LIVE_UNTESTED_OPERATIONS, untested, errorPathOnly, operationStatus, operationsWithStatus, functionalOperations, errorPathOnlyOperations, untestedOperations, SSE_LIVE_EVIDENCE;
var init_operation_live_evidence = __esm({
  "src/operation-live-evidence.ts"() {
    "use strict";
    init_api_contract();
    SSE_LIVE_EVIDENCE_SCHEMA_VERSION = 1;
    SSE_LIVE_EVIDENCE_BASIS = "recorded-successful-live-execution";
    SSE_LIVE_EVIDENCE_SCOPE = "aggregate-release-snapshot";
    SSE_LIVE_EVIDENCE_STATUSES = Object.freeze([
      "functional",
      "error-path-only",
      "untested"
    ]);
    SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS = Object.freeze(
      [
        "vast_apply",
        "vast_dialog_read",
        "vast_mapping_options",
        "vast_mapping_select",
        "vast_row_details",
        "vast_row_set_expanded"
      ]
    );
    SSE_LIVE_UNTESTED_OPERATIONS = Object.freeze(
      []
    );
    untested = new Set(SSE_LIVE_UNTESTED_OPERATIONS);
    errorPathOnly = new Set(SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS);
    if (untested.size !== SSE_LIVE_UNTESTED_OPERATIONS.length) {
      throw new Error("Live-Evidenzkatalog enthaelt doppelte ungetestete Operationen.");
    }
    if (errorPathOnly.size !== SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS.length) {
      throw new Error("Live-Evidenzkatalog enthaelt doppelte Nur-Fehlerpfad-Operationen.");
    }
    if (SSE_LIVE_ERROR_PATH_ONLY_OPERATIONS.some((operation) => untested.has(operation))) {
      throw new Error("Eine Live-Operation darf nicht zugleich ungetestet und nur im Fehlerpfad belegt sein.");
    }
    operationStatus = Object.freeze(Object.fromEntries(
      SSE_API_OPERATIONS.map((operation) => [
        operation,
        untested.has(operation) ? "untested" : errorPathOnly.has(operation) ? "error-path-only" : "functional"
      ])
    ));
    operationsWithStatus = (status) => Object.freeze(
      SSE_API_OPERATIONS.filter((operation) => operationStatus[operation] === status)
    );
    functionalOperations = operationsWithStatus("functional");
    errorPathOnlyOperations = operationsWithStatus("error-path-only");
    untestedOperations = operationsWithStatus("untested");
    SSE_LIVE_EVIDENCE = Object.freeze({
      schemaVersion: SSE_LIVE_EVIDENCE_SCHEMA_VERSION,
      basis: SSE_LIVE_EVIDENCE_BASIS,
      scope: SSE_LIVE_EVIDENCE_SCOPE,
      profileSpecific: false,
      affectsAvailability: false,
      functionalCount: functionalOperations.length,
      errorPathOnlyCount: errorPathOnlyOperations.length,
      untestedCount: untestedOperations.length,
      untestedOperations,
      operationStatus
    });
  }
});

// src/worker-operation-policy.ts
function workerOperationNeedsMarkedDesktop(operation) {
  return !DESKTOP_INDEPENDENT_SET.has(operation);
}
var SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS, SSE_WORKER_CONTROLLER_BYPASS_OPERATIONS, DESKTOP_INDEPENDENT_SET;
var init_worker_operation_policy = __esm({
  "src/worker-operation-policy.ts"() {
    "use strict";
    SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS = Object.freeze([
      "page_objects",
      "product_info"
    ]);
    SSE_WORKER_CONTROLLER_BYPASS_OPERATIONS = SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS;
    DESKTOP_INDEPENDENT_SET = new Set(SSE_DESKTOP_INDEPENDENT_STATIC_WORKER_OPERATIONS);
  }
});

// src/version.ts
var SSE_PACKAGE_NAME, SSE_API_PACKAGE_NAME, SSE_PACKAGE_VERSION;
var init_version = __esm({
  "src/version.ts"() {
    "use strict";
    SSE_PACKAGE_NAME = "steuer-spar-erklaerung-mcp";
    SSE_API_PACKAGE_NAME = "@yadimon/steuer-spar-erklaerung-api";
    SSE_PACKAGE_VERSION = "0.1.0-beta.35";
  }
});

// src/capabilities.ts
var fallbackStages, SSE_CAPABILITIES;
var init_capabilities = __esm({
  "src/capabilities.ts"() {
    "use strict";
    init_api_contract();
    init_operation_catalog();
    init_operation_traits();
    init_operation_live_evidence();
    init_worker_operation_policy();
    init_version();
    fallbackStages = [
      {
        intent: "Schneller strukturierter Zustand",
        operations: ["known_page_state", "page", "ui_state"],
        rule: "Katalogisierte Seite bevorzugen; bei unbekannter Seite auf den generischen Snapshot wechseln."
      },
      {
        intent: "Unbekannte Controls entdecken",
        operations: ["snapshot", "find", "positions", "accessibility_probe"],
        rule: "Erst lesen; AutomationId oder RuntimeId aus demselben frischen Zustand uebernehmen."
      },
      {
        intent: "Eindeutig interagieren",
        operations: ["click", "click_point", "toggle", "combo_options", "combo_select", "tracked_set_value"],
        rule: "Spezialtransaktion fuer Checkbox, Dropdown und Schreibfeld; generischen Klick nur mit eindeutiger Bindung und Nachbedingung."
      },
      {
        intent: "Dialog sicher fortsetzen",
        operations: ["dialog_list", "warning_popup_read", "dialog_answer"],
        rule: "Nur obersten Dialog, exakten Fingerprint und freigegebenen Button verwenden; nie blind wiederholen."
      }
    ];
    SSE_CAPABILITIES = Object.freeze({
      schemaVersion: 1,
      architecture: {
        api: "Lokaler loopback-only Ausfuehrungskern",
        mcp: "PC-blinder Wrapper derselben Operationen",
        cli: "Direkter config-gebundener API-Client ohne Werte in Prozessargumenten",
        worker: "Kurzlebige, gebundene Windows-UI-Transaktionen"
      },
      transport: {
        packageName: SSE_PACKAGE_NAME,
        packageVersion: SSE_PACKAGE_VERSION,
        apiVersion: SSE_API_VERSION,
        directApiWithoutMcp: true,
        directCliWithoutMcp: true,
        discoveryPath: `/${SSE_API_VERSION}/operations`,
        operationDiscoveryPathTemplate: `/${SSE_API_VERSION}/operations/{operation}`,
        openApiPath: `/${SSE_API_VERSION}/openapi.json`,
        mcpCancellationPropagatesToApi: true,
        workerArguments: "exclusive-bounded-temp-json",
        workerArgumentsVisibleInProcessList: false,
        workerQueueDepth: MAX_WORKER_QUEUE_DEPTH,
        apiOperations: SSE_API_OPERATIONS,
        mcpToolOperations: SSE_MCP_TOOL_OPERATIONS,
        mcpComposedToolOperations: SSE_MCP_COMPOSED_TOOL_OPERATIONS,
        readOnlyOperations: SSE_READ_ONLY_OPERATIONS,
        statefulOperations: SSE_STATEFUL_OPERATIONS,
        nonDestructiveStatefulOperations: SSE_NON_DESTRUCTIVE_STATEFUL_OPERATIONS,
        potentiallyDestructiveOperations: SSE_DESTRUCTIVE_OPERATIONS
      },
      limits: {
        apiRequestBytes: MAX_API_BODY_BYTES,
        apiResponseBytes: MAX_API_RESPONSE_BYTES,
        operationTimeoutMs: MAX_OPERATION_TIMEOUT_MS,
        argumentStringBytes: MAX_API_ARGUMENT_STRING_BYTES,
        argumentCollectionItems: MAX_API_ARGUMENT_COLLECTION_ITEMS,
        argumentDepth: MAX_API_ARGUMENT_DEPTH,
        argumentNodes: MAX_API_ARGUMENT_NODES,
        workerArgumentBytes: MAX_API_BODY_BYTES,
        operation: SSE_OPERATION_LIMITS
      },
      selectors: {
        preferred: ["aid", "rid", "name"],
        containsRequiresUniqueMatch: true,
        expectedPageRecommended: true
      },
      click: {
        patterns: SSE_CLICK_PATTERNS,
        genericToggleBlocked: true,
        blockedLegacyPatterns: ["toggle"],
        safePatterns: SSE_CLICK_PATTERNS,
        observedMethods: ["uia-invoke", "verified-point", "uia-invoke+verified-point-fallback"]
      },
      dialogs: {
        allowedButtons: SSE_DIALOG_BUTTONS,
        unsupportedButtonsAreReportedButBlocked: true,
        requiresWindowAndFingerprint: true,
        warningAlsoRequiresBodyFingerprint: true
      },
      fallbackStages,
      // Ohne MCP ist die Selbstbeschreibung die einzige Quelle, aus der ein Agent
      // Nebenlaeufigkeit und Buendelung erfahren kann.
      concurrency: {
        singleFlight: true,
        rejectionCode: "busy",
        rejectionStatus: 409,
        progressRoute: "/healthz",
        workerController: {
          scope: "windows-session",
          includesDirectWorker: true,
          policy: "zero-wait",
          idlePrewarmHoldsLease: false,
          bypassOperations: SSE_WORKER_CONTROLLER_BYPASS_OPERATIONS,
          contentionKind: "busy",
          contentionReason: "session-controller-busy",
          contentionTransport: "operation-result",
          contentionHttpStatus: 200,
          observedAbandonmentKind: "worker-isolation-lost",
          observedAbandonmentReason: "controller-lock-abandoned",
          durableCrashDetection: false
        },
        rule: "Es laeuft immer nur eine Operation. Ein zweiter Aufruf wird mit 'busy' abgelehnt, nicht eingereiht. Warte auf das Ergebnis statt parallel erneut aufzurufen; /healthz meldet jederzeit, welche Operation seit wann laeuft. Abbrechen geschieht ausschliesslich durch Trennen der HTTP-Verbindung, nie durch einen zweiten Aufruf."
      },
      batching: {
        rule: "Jeder Aufruf startet einen frischen Arbeitsprozess und laedt das Workerskript neu. Diese Fixkosten fallen pro Aufruf an, nicht pro Schritt. Buendele deshalb, statt Feld fuer Feld einzeln abzurufen.",
        levels: [
          { intent: "Einzelner Handgriff", operations: ["click", "click_point", "set_value", "read_page"] },
          { intent: "Navigieren und lesen in einem Aufruf", operations: ["checker_open", "subpages", "table_read"] },
          { intent: "Ganze Seitenstrecke", operations: ["collect", "read_full", "export_csv"] },
          { intent: "Beliebige Schrittfolge in einem Arbeitsprozess", operations: ["scenario_run"] }
        ]
      },
      liveEvidence: SSE_LIVE_EVIDENCE,
      safety: {
        elsterAndSubmissionBlocked: true,
        directWorkerSubmissionBypass: false,
        writesRequireReadback: true,
        caseAndHashBindingAvailable: true,
        localPathsHiddenFromMcp: true,
        unknownOrAmbiguousStateFailsClosed: true,
        singleFlightEnforced: true
      }
    });
  }
});

// src/abortable.ts
function abortError() {
  return new DOMException("Aborted", "AbortError");
}
function abortable(operation, signal, cleanupLateResult) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = () => {
      if (finish()) rejectPromise(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    operation.then(
      (value) => {
        if (finish()) resolvePromise(value);
        else void cleanupLateResult?.(value);
      },
      (error) => {
        if (finish()) rejectPromise(error);
      }
    );
  });
}
var init_abortable = __esm({
  "src/abortable.ts"() {
    "use strict";
  }
});

// src/file-identity.ts
function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function sameFileState(left, right) {
  return sameFileIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
var init_file_identity = __esm({
  "src/file-identity.ts"() {
    "use strict";
  }
});

// src/case-file.ts
import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { basename as basename2, resolve as resolve8 } from "node:path";
function emptyHeader() {
  return Object.fromEntries(HEADER_KEYS.map((key) => [key, null]));
}
function unknownSummary(reason = "Uebermittlungsstatus nicht sicher lesbar") {
  return { header: emptyHeader(), transmitted: "unknown", transmittedReason: reason };
}
function trimmed(data) {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end -= 1;
  return data.subarray(0, end);
}
function plausibleRecord(data, offset) {
  if (offset < 0 || offset + 9 > data.length) return false;
  const nameLength = data.readUInt32LE(offset);
  if (nameLength < 2 || nameLength > 200 || offset + 4 + nameLength + 5 > data.length) return false;
  const nameStart = offset + 4;
  if (data[nameStart + nameLength - 1] !== 0) return false;
  for (let index = nameStart; index < nameStart + nameLength - 1; index += 1) {
    const value = data[index];
    if (value === void 0 || value < 33 || value >= 127) return false;
  }
  return true;
}
function decodeText(data) {
  const value = trimmed(data);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return value.toString("latin1");
  }
}
function variant(data, offset, length) {
  if (length < 0 || offset < 0 || offset + length > data.length) return void 0;
  return { raw: data.subarray(offset, offset + length), next: offset + length };
}
function parseAkadMeta(data) {
  if (data.length < 64 || data.toString("ascii", 0, 4) !== "AKAD") return void 0;
  const uuidLength = data.readUInt32LE(12);
  if (uuidLength < 8 || uuidLength > 256 || 16 + uuidLength + 8 > data.length) return void 0;
  let offset = 16 + uuidLength;
  if (data.toString("ascii", offset, offset + 4) !== "FIIF") return void 0;
  let start = -1;
  for (let candidate = offset + 4; candidate < Math.min(offset + 24, data.length); candidate += 1) {
    if (plausibleRecord(data, candidate)) {
      start = candidate;
      break;
    }
  }
  if (start < 0) return void 0;
  const meta = /* @__PURE__ */ new Map();
  let encryptedBytes = 0;
  offset = start;
  for (let recordIndex = 0; recordIndex < 400; recordIndex += 1) {
    if (offset + 4 > data.length) break;
    const nameLength = data.readUInt32LE(offset);
    if (nameLength < 1 || nameLength > 500 || offset + 4 + nameLength > data.length) break;
    const name = trimmed(data.subarray(offset + 4, offset + 4 + nameLength)).toString("latin1");
    const valueHeaderOffset = offset + 4 + nameLength;
    if (valueHeaderOffset + 5 > data.length) break;
    const type = data[valueHeaderOffset];
    if (type === void 0) break;
    const variants = [];
    const addVariant = (candidate) => {
      if (candidate) variants.push(candidate);
    };
    if (type === 6) addVariant(variant(data, valueHeaderOffset + 1, 1));
    if (type === 5) addVariant(variant(data, valueHeaderOffset + 1, 4));
    const prefixedLength = data.readUInt32LE(valueHeaderOffset + 1);
    addVariant(variant(data, valueHeaderOffset + 5, prefixedLength));
    if (type !== 6) addVariant(variant(data, valueHeaderOffset + 1, 1));
    if (type !== 5) addVariant(variant(data, valueHeaderOffset + 1, 4));
    if (!variants.length) break;
    const chosen = variants.find((candidate) => candidate.next === data.length || plausibleRecord(data, candidate.next)) ?? variants[0];
    if (!chosen) break;
    offset = chosen.next;
    if (name.toLowerCase() === "svcrypted") {
      encryptedBytes = data.length - (valueHeaderOffset + 5);
      break;
    }
    let value;
    if (type === 5 && chosen.raw.length === 4) {
      const day = chosen.raw[0] ?? 0;
      const month = chosen.raw[1] ?? 0;
      const year = chosen.raw.readUInt16LE(2);
      value = month >= 1 && month <= 12 && year > 1900 && year < 2200 ? `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}` : [...chosen.raw].map((entry) => entry.toString(16).padStart(2, "0")).join(" ");
    } else if (chosen.raw.length === 1 && type !== 4 && type !== 12) {
      value = chosen.raw[0] ?? 0;
    } else {
      value = decodeText(chosen.raw);
    }
    meta.set(name.toLowerCase(), { type, value });
  }
  return { meta, encryptedBytes };
}
function caseSummaryFromMeta(meta) {
  const header = Object.fromEntries(HEADER_KEYS.map((key) => [key, meta.get(key.toLowerCase())?.value ?? null]));
  if (!meta.has("elstertransfertime")) {
    return {
      header,
      transmitted: "unknown",
      transmittedReason: "Feld ElsterTransferTime nicht im Kopf gefunden - der Kopf wurde womöglich unvollständig gelesen. Keine Aussage möglich."
    };
  }
  const transferRecord = meta.get("elstertransfertime");
  if (!transferRecord || transferRecord.type !== 4) {
    const typeName = transferRecord ? AKAD_TYPE_NAMES[transferRecord.type] ?? String(transferRecord.type) : "undefined";
    return {
      header,
      transmitted: "unknown",
      transmittedReason: `ElsterTransferTime hat unerwarteten Typ '${typeName}' - keine Aussage möglich.`
    };
  }
  const transferTime = String(transferRecord.value).trim();
  if (["", "0", "-"].includes(transferTime)) {
    return {
      header,
      transmitted: false,
      transmittedReason: transferTime ? `ElsterTransferTime ist der Platzhalter '${transferTime}' - kein Versand` : "ElsterTransferTime ist leer"
    };
  }
  if (/\d/u.test(transferTime)) {
    return { header, transmitted: true, transmittedReason: `übermittelt am ${transferTime}` };
  }
  return {
    header,
    transmitted: "unknown",
    transmittedReason: `ElsterTransferTime '${transferTime}' ist weder Platzhalter noch Zeitstempel - keine Aussage möglich.`
  };
}
function parseAkadCaseSummary(input) {
  try {
    const data = Buffer.from(input).subarray(0, AKAD_MAX_HEADER_BYTES);
    const parsed = parseAkadMeta(data);
    return parsed ? caseSummaryFromMeta(parsed.meta) : unknownSummary();
  } catch {
    return unknownSummary("Datei nicht lesbar - keine Aussage moeglich");
  }
}
function parseAkadCaseListSummary(input) {
  try {
    const parsed = parseAkadMeta(Buffer.from(input).subarray(0, AKAD_MAX_HEADER_BYTES));
    return parsed ? { ...caseSummaryFromMeta(parsed.meta), encryptedBytes: parsed.encryptedBytes } : void 0;
  } catch {
    return void 0;
  }
}
function isProfileCaseFileName(path, profile, includeBackups = true) {
  const name = basename2(path);
  const types = [...new Set(Object.values(profile.startModes))];
  const escapedTypes = types.map((type2) => type2.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const match = new RegExp(`\\.(?<type>${escapedTypes.join("|")})(?<year>\\d{4})(?<backup>_Backup)?$`, "iu").exec(name);
  const type = match?.groups?.type;
  const year = Number(match?.groups?.year);
  if (!type || !Number.isInteger(year) || !includeBackups && Boolean(match?.groups?.backup)) return false;
  return Object.entries(profile.startModes).some(([mode, modeType]) => modeType.toUpperCase() === type.toUpperCase() && [profile.taxYear, ...profile.additionalCaseYears[mode] ?? []].includes(year));
}
function preciseIsoTime(milliseconds, nanoseconds) {
  const whole = new Date(Number(milliseconds)).toISOString().slice(0, 19);
  const fraction = String(nanoseconds % 1000000000n / 100n).padStart(7, "0");
  return `${whole}.${fraction}Z`;
}
async function openCaseFile(path, signal) {
  if (signal?.aborted) throw abortError();
  const openOperation = open(path, "r");
  return signal ? await abortable(openOperation, signal, (lateHandle) => lateHandle.close().catch(() => void 0)) : await openOperation;
}
async function readStableCaseHeader(path, signal) {
  let handle;
  try {
    if (signal?.aborted) throw new CaseFileError("API-Client hat die Fallliste abgebrochen.", "aborted");
    handle = await openCaseFile(path, signal);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new CaseFileError(`Falldatei fehlt: ${path}`, "not-found");
    const length = Number(before.size < BigInt(AKAD_MAX_HEADER_BYTES) ? before.size : BigInt(AKAD_MAX_HEADER_BYTES));
    const chunks = [];
    let bytesRead = 0;
    if (length > 0) {
      const stream = handle.createReadStream({ autoClose: false, end: length - 1, ...signal ? { signal } : {} });
      stream.on("error", () => void 0);
      for await (const entry of stream) {
        const chunk = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
        chunks.push(chunk);
        bytesRead += chunk.length;
      }
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      throw new CaseFileError(
        "Falldatei wurde waehrend des Kopflesens veraendert oder ersetzt; Fallliste wird verworfen.",
        "resource-changed"
      );
    }
    return { data: Buffer.concat(chunks, bytesRead), stats: before };
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
function roundedKilobytes(bytes) {
  const numerator = bytes * 10n;
  let tenths = numerator / 1024n;
  const remainder = numerator % 1024n;
  if (remainder > 512n || remainder === 512n && tenths % 2n !== 0n) tenths += 1n;
  return Number(tenths) / 10;
}
function localTimestamp(milliseconds) {
  const value = new Date(Number(milliseconds));
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-") + " " + [
    String(value.getHours()).padStart(2, "0"),
    String(value.getMinutes()).padStart(2, "0"),
    String(value.getSeconds()).padStart(2, "0")
  ].join(":");
}
async function listCaseFiles(directoryInput, profile, options = {}) {
  const dir = resolve8(directoryInput);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const entries = await abortable(readdir(dir, { withFileTypes: true }), controller.signal);
    const names = entries.filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, profile, options.includeBackups === true)).map((entry) => entry.name);
    if (!names.length) return { ok: true, dir: directoryInput, count: 0, cases: [] };
    const cases = [];
    for (const name of names) {
      if (controller.signal.aborted) throw abortError();
      const path = resolve8(dir, name);
      const { data, stats } = await readStableCaseHeader(path, controller.signal);
      const parsed = parseAkadCaseListSummary(data);
      if (!parsed) throw new CaseFileParserFallbackError(`AKAD-Kopf von '${name}' braucht den Worker-Parser.`);
      const header = parsed.header;
      cases.push({
        name,
        path,
        kb: roundedKilobytes(stats.size),
        modified: localTimestamp(stats.mtimeMs),
        module: name.slice(name.lastIndexOf(".") + 1).replace(/_Backup$/iu, ""),
        fileType: header.FileType ?? "",
        year: header.VJahr ?? "",
        steuernummer: header.Steuernummer ?? "",
        savedBy: header.FileSavedBy ?? "",
        elsterTransferTime: String(header.ElsterTransferTime ?? "").trim(),
        transmitted: parsed.transmitted,
        transmittedReason: parsed.transmittedReason,
        encryptedBytes: parsed.encryptedBytes,
        meta: null
      });
    }
    if (controller.signal.aborted) throw abortError();
    return { ok: true, dir: directoryInput, count: cases.length, cases, parserError: null };
  } catch (error) {
    if (error instanceof CaseFileParserFallbackError) throw error;
    if (error instanceof CaseFileError && error.kind !== "aborted") throw error;
    throw normalizeListError(error, dir, timedOut, options.signal?.aborted === true);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
function normalizeListError(error, dir, timedOut, aborted) {
  if (timedOut) return new CaseFileError(`Zeitueberschreitung beim Lesen des Fallordners: ${dir}`, "timeout");
  if (aborted) return new CaseFileError("API-Client hat die Fallliste abgebrochen.", "aborted");
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT" || code === "ENOTDIR") return new CaseFileError(`Fallordner fehlt: ${dir}`, "not-found");
  return new CaseFileError(error instanceof Error ? error.message : String(error), "worker");
}
function normalizeFileError(error, path, timedOut, aborted) {
  if (timedOut) return new CaseFileError(`Zeitueberschreitung beim Hashen der Falldatei: ${path}`, "timeout");
  if (aborted) return new CaseFileError("API-Client hat den Fallhash abgebrochen.", "aborted");
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT" || code === "ENOTDIR") return new CaseFileError(`Falldatei fehlt: ${path}`, "not-found");
  if (error instanceof CaseFileError) return error;
  return new CaseFileError(error instanceof Error ? error.message : String(error), "worker");
}
async function readCaseFileInfo(pathInput, profile, options = {}) {
  const path = resolve8(pathInput);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let handle;
  try {
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    handle = await openCaseFile(path, controller.signal);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new CaseFileError(`Falldatei fehlt: ${path}`, "not-found");
    if (!isProfileCaseFileName(path, profile)) {
      throw new CaseFileError(
        `Falldatei gehoert nicht zum freigegebenen Profil '${profile.id}'.`,
        "unsupported-case"
      );
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CaseFileError("Falldatei ist fuer eine sichere JSON-Groessenangabe zu gross.", "worker");
    }
    const hash2 = createHash("sha256");
    const headerChunks = [];
    let headerBytes = 0;
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const stream = handle.createReadStream({ autoClose: false, signal: controller.signal });
    stream.on("error", () => void 0);
    for await (const entry of stream) {
      const chunk = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
      hash2.update(chunk);
      if (headerBytes < AKAD_MAX_HEADER_BYTES) {
        const slice = chunk.subarray(0, AKAD_MAX_HEADER_BYTES - headerBytes);
        headerChunks.push(slice);
        headerBytes += slice.length;
      }
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      throw new CaseFileError(
        "Falldatei wurde waehrend des Hashens veraendert oder ersetzt; Ergebnis wird verworfen.",
        "resource-changed"
      );
    }
    return {
      ok: true,
      path,
      exists: true,
      size: Number(before.size),
      mtimeUtc: preciseIsoTime(before.mtimeMs, before.mtimeNs),
      sha256: hash2.digest("hex").toUpperCase(),
      ...parseAkadCaseSummary(Buffer.concat(headerChunks, headerBytes))
    };
  } catch (error) {
    throw normalizeFileError(error, path, timedOut, options.signal?.aborted === true);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    await handle?.close().catch(() => void 0);
  }
}
var AKAD_MAX_HEADER_BYTES, HEADER_KEYS, AKAD_TYPE_NAMES, CaseFileError, CaseFileParserFallbackError;
var init_case_file = __esm({
  "src/case-file.ts"() {
    "use strict";
    init_abortable();
    init_api_contract();
    init_file_identity();
    AKAD_MAX_HEADER_BYTES = 512 * 1024;
    HEADER_KEYS = [
      "FileType",
      "VJahr",
      "Steuernummer",
      "FileSavedBy",
      "ElsterTransferTime",
      "MitElsterVersendetText"
    ];
    AKAD_TYPE_NAMES = {
      4: "text",
      5: "datum",
      6: "zahl",
      12: "blob"
    };
    CaseFileError = class extends Error {
      constructor(message, kind) {
        super(message);
        this.kind = kind;
      }
      kind;
      name = "CaseFileError";
    };
    CaseFileParserFallbackError = class extends Error {
      name = "CaseFileParserFallbackError";
    };
  }
});

// src/checker-executor.ts
function errorKind(error) {
  return error && typeof error === "object" && typeof error.kind === "string" ? String(error.kind) : "worker";
}
function failedPlan(error, kind, workerProcessCount) {
  return {
    ok: false,
    kind,
    error,
    schemaVersion: 1,
    planKind: CHECKER_OPEN_PLAN_KIND,
    resultingState: workerProcessCount === 0 ? "unchanged" : "unknown",
    cleanupRequired: workerProcessCount === 1,
    performance: {
      workerProcessCount,
      internalOperationCount: 0,
      internalTimings: [],
      reusedReadbackCount: 0
    }
  };
}
async function executeCheckerOpen(args, timeoutMs, signal, worker) {
  if (typeof args.name !== "string" || !args.name.trim()) throw new Error("'name' fehlt.");
  if (args.hwnd !== void 0 && (typeof args.hwnd !== "number" || !Number.isSafeInteger(args.hwnd) || args.hwnd < 1)) {
    throw new Error("'hwnd' muss eine positive sichere Ganzzahl sein.");
  }
  if (signal?.aborted) {
    return failedPlan(
      "API-Client hat den Aufruf vor dem Workerstart abgebrochen; kein UI-Zustand wurde geaendert.",
      "aborted",
      0
    );
  }
  const plan = {
    schemaVersion: 1,
    planKind: CHECKER_OPEN_PLAN_KIND,
    name: args.name,
    ...args.hwnd === void 0 ? {} : { hwnd: args.hwnd }
  };
  try {
    const result = await worker(
      CHECKER_OPEN_WORKER_OPERATION,
      plan,
      Math.min(timeoutMs ?? 3e5, 3e5),
      signal
    );
    const performance9 = result.performance && typeof result.performance === "object" && !Array.isArray(result.performance) ? result.performance : {};
    return {
      ...result,
      schemaVersion: 1,
      planKind: CHECKER_OPEN_PLAN_KIND,
      resultingState: typeof result.resultingState === "string" ? result.resultingState : result.ok === true ? "detail-verified" : "unknown",
      cleanupRequired: typeof result.cleanupRequired === "boolean" ? result.cleanupRequired : result.ok !== true,
      performance: { ...performance9, workerProcessCount: 1 },
      ...result.ok === true ? { kontrollbildEnthalten: typeof result.bildBase64 === "string" && result.bildBase64.length > 0 } : {}
    };
  } catch (error) {
    return failedPlan(
      error instanceof Error ? error.message : String(error),
      errorKind(error),
      1
    );
  }
}
var CHECKER_OPEN_WORKER_OPERATION, CHECKER_OPEN_PLAN_KIND;
var init_checker_executor = __esm({
  "src/checker-executor.ts"() {
    "use strict";
    CHECKER_OPEN_WORKER_OPERATION = "checker_open_plan";
    CHECKER_OPEN_PLAN_KIND = "checker-open";
  }
});

// src/executor-errors.ts
function operationError(error, kind = "operation") {
  return { ok: false, kind, error };
}
var ExecutorArgumentError;
var init_executor_errors = __esm({
  "src/executor-errors.ts"() {
    "use strict";
    ExecutorArgumentError = class extends Error {
      name = "ExecutorArgumentError";
    };
  }
});

// src/resources.ts
import { existsSync as existsSync6, realpathSync as realpathSync2 } from "node:fs";
import { isAbsolute as isAbsolute4, relative as relative2, resolve as resolve9, sep as sep2, win32 } from "node:path";
function inside(root, candidate) {
  const rel = relative2(root, candidate);
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep2}`) && !isAbsolute4(rel);
}
function nearestExistingAncestor(path) {
  let current = path;
  while (!existsSync6(current)) {
    const parent = win32.dirname(current);
    if (parent === current) throw new Error("Ressourcenziel hat keinen existierenden, sicheren Vorfahren.");
    current = parent;
  }
  return current;
}
function normalizeRelativePath(value) {
  if (!value || value.includes("\0") || value !== value.trim()) {
    throw new Error("Ressourcenreferenz braucht einen nicht leeren, normalisierten relativen Pfad.");
  }
  if (win32.isAbsolute(value) || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
    throw new Error("Absolute Pfade sind in Ressourcenreferenzen nicht erlaubt.");
  }
  if (value.includes(":")) {
    throw new Error("Doppelpunkte sind im relativen Teil einer Ressourcenreferenz nicht erlaubt.");
  }
  const parts = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("Ressourcenreferenz darf kein '..' enthalten.");
    if (/[<>"|?*]/.test(part) || /[. ]$/.test(part) || WINDOWS_DEVICE_NAME.test(part)) {
      throw new Error(`Ungueltiges Windows-Pfadsegment in Ressourcenreferenz: '${part}'.`);
    }
    parts.push(part);
  }
  return parts.length ? parts.join("/") : ".";
}
function formatResourceReference(area, relativePath) {
  return `${area}:${normalizeRelativePath(relativePath)}`;
}
function parseResourceReference(value, allowedAreas = RESOURCE_AREAS) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error("Ressourcenreferenz muss eine nicht leere Zeichenkette sein.");
  }
  const separator = value.indexOf(":");
  if (separator < 1) throw new Error("Ressourcenreferenz muss das Format 'bereich:relativer/pfad' haben.");
  const areaText = value.slice(0, separator);
  if (!AREA_SET.has(areaText)) throw new Error(`Unbekannter Ressourcenbereich: '${areaText}'.`);
  const area = areaText;
  if (!allowedAreas.includes(area)) {
    throw new Error(`Ressourcenbereich '${area}' ist fuer diesen Aufruf nicht erlaubt.`);
  }
  const relativePath = normalizeRelativePath(value.slice(separator + 1));
  return { area, relativePath, ref: `${area}:${relativePath}` };
}
function resolveResourceReference(roots, value, allowedAreas = RESOURCE_AREAS) {
  const parsed = parseResourceReference(value, allowedAreas);
  const configuredRoot = roots[parsed.area];
  if (!configuredRoot) throw new Error(`Ressourcenbereich '${parsed.area}' ist lokal nicht konfiguriert.`);
  if (!win32.isAbsolute(configuredRoot)) {
    throw new Error(`Lokaler Ressourcenbereich '${parsed.area}' ist nicht absolut konfiguriert.`);
  }
  if (!existsSync6(configuredRoot)) {
    throw new Error(`Lokaler Ressourcenbereich '${parsed.area}' existiert nicht.`);
  }
  const root = realpathSync2(configuredRoot);
  const candidate = parsed.relativePath === "." ? root : resolve9(root, ...parsed.relativePath.split("/"));
  if (!inside(root, candidate)) throw new Error("Ressourcenreferenz verlaesst ihren konfigurierten Bereich.");
  const existing = existsSync6(candidate) ? candidate : nearestExistingAncestor(candidate);
  if (!inside(root, realpathSync2(existing))) {
    throw new Error("Ressourcenreferenz folgt einer Junction oder einem Link aus ihrem Bereich heraus.");
  }
  const path = existsSync6(candidate) ? realpathSync2(candidate) : candidate;
  if (!inside(root, path)) {
    throw new Error("Ressourcenreferenz folgt einer Junction oder einem Link aus ihrem Bereich heraus.");
  }
  return { ...parsed, root, path };
}
function assertResourceWriteBoundary(roots, resource) {
  if (resource.area !== "workspace") return;
  for (const area of RESOURCE_AREAS) {
    if (area === "workspace") continue;
    const configuredRoot = roots[area];
    if (!configuredRoot || !win32.isAbsolute(configuredRoot)) continue;
    const otherRoot = existsSync6(configuredRoot) ? realpathSync2(configuredRoot) : resolve9(configuredRoot);
    if (inside(otherRoot, resource.path)) {
      throw new Error(
        `Schreiben ueber 'workspace:' in den Ressourcenbereich '${area}' ist gesperrt; '${area}:' explizit verwenden.`
      );
    }
  }
}
function prepareResourceRoots(roots) {
  return RESOURCE_AREAS.flatMap((area) => {
    const configuredRoot = roots[area];
    if (!configuredRoot || !win32.isAbsolute(configuredRoot)) return [];
    const root = existsSync6(configuredRoot) ? realpathSync2(configuredRoot) : resolve9(configuredRoot);
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [{ area, root, embeddedPattern: new RegExp(`${escaped}(?:[\\\\/])?`, "gi") }];
  }).sort((left, right) => right.root.length - left.root.length);
}
function referenceForPreparedRoots(prepared, value) {
  if (typeof value !== "string" || !win32.isAbsolute(value)) return void 0;
  const candidate = existsSync6(value) ? realpathSync2(value) : resolve9(value);
  const match = prepared.find((entry) => inside(entry.root, candidate));
  if (!match) return void 0;
  const rel = relative2(match.root, candidate).replaceAll("\\", "/") || ".";
  try {
    return formatResourceReference(match.area, rel);
  } catch {
    return `${match.area}:[lokaler-pfad-entfernt]`;
  }
}
function createResourcePathRedactor(roots) {
  return (value) => {
    const prepared = prepareResourceRoots(roots);
    const redact = (entry) => {
      if (Array.isArray(entry)) return entry.map((item) => redact(item));
      if (entry && typeof entry === "object") {
        return Object.fromEntries(
          Object.entries(entry).map(([key, item]) => [redact(key), redact(item)])
        );
      }
      if (typeof entry !== "string") return entry;
      if (!entry.includes(":") && !entry.includes("\\") && !entry.includes("/")) return entry;
      const exactRef = referenceForPreparedRoots(prepared, entry);
      if (exactRef) return exactRef;
      let redacted = entry;
      for (const { area, embeddedPattern } of prepared) {
        redacted = redacted.replace(embeddedPattern, `${area}:`);
      }
      redacted = redacted.replace(
        /\b(cases|documents|workspace|results|backups):([^\s"'<>|;,\)\]\}\r\n]*)/g,
        (_match, area, tail) => `${area}:${tail.replaceAll("\\", "/")}`
      );
      return redacted;
    };
    return redact(value);
  };
}
var RESOURCE_AREAS, AREA_SET, WINDOWS_DEVICE_NAME;
var init_resources = __esm({
  "src/resources.ts"() {
    "use strict";
    RESOURCE_AREAS = ["cases", "documents", "workspace", "results", "backups"];
    AREA_SET = new Set(RESOURCE_AREAS);
    WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  }
});

// src/bulk-plan-executor.ts
function resolveReceiptManagerBulkReferences(args, resourceRefs, roots) {
  if (!Array.isArray(args.items)) return;
  args.items = args.items.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw new ExecutorArgumentError(`'items.${index}' muss ein Objekt sein.`);
    }
    const item = { ...rawItem };
    if (typeof item.resourceRef !== "string") {
      throw new ExecutorArgumentError(`'items.${index}.resourceRef' muss eine Ressourcenreferenz sein.`);
    }
    try {
      const resolved = resolveResourceReference(roots, item.resourceRef, ["documents"]);
      item.expectedPath = resolved.path;
      resourceRefs[`items.${index}.resourceRef`] = resolved.ref;
    } catch (error) {
      throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
    }
    return item;
  });
}
async function executeFillFieldsPlan(args, timeoutMs, signal, dependencies) {
  const pageId = String(args.pageId);
  const resolvedPage = resolvePageObjectDefinition(dependencies.pageObjectsCatalog, pageId);
  if (resolvedPage.status !== "found") {
    throw new ExecutorArgumentError(
      resolvedPage.status === "ambiguous" ? `Page-Object-ID '${pageId}' ist bei Gross-/Kleinschreibung mehrdeutig.` : `Unbekannte Page-Object-ID '${pageId}'.`
    );
  }
  const fields = args.fields;
  const pageFields = resolvedPage.page.fields ?? {};
  const resourceRefs = {};
  const sharedKeys = [
    "trackResults",
    "resultLabels",
    "hwnd",
    "pid",
    "expectedCaseRef",
    "expectedCaseHash"
  ];
  const actions = fields.map((field, index) => {
    const fieldId = String(field.fieldId);
    if (!Object.hasOwn(pageFields, fieldId)) {
      throw new ExecutorArgumentError(`Unbekannte fieldId '${fieldId}' auf Page-Object '${pageId}'.`);
    }
    const child = {
      pageId,
      fieldId,
      expectedBefore: field.expectedBefore,
      value: field.value,
      expectedAfter: field.expectedAfter,
      ...field.sumChecks === void 0 ? {} : { sumChecks: field.sumChecks },
      ...index === 0 && args.expectedEpoch !== void 0 ? { expectedEpoch: args.expectedEpoch } : {}
    };
    for (const key of sharedKeys) {
      if (args[key] !== void 0) child[key] = args[key];
    }
    const parsedChild = parseApiOperationArgs("tracked_set_value", child);
    const configuredChild = dependencies.configure("tracked_set_value", parsedChild);
    Object.assign(resourceRefs, configuredChild.resourceRefs);
    return {
      id: `field-${String(index + 1).padStart(2, "0")}`,
      operation: "tracked_set_value",
      args: configuredChild.args
    };
  });
  const finalReadbackArgs = { pageId };
  for (const key of ["hwnd", "pid"]) {
    if (args[key] !== void 0) finalReadbackArgs[key] = args[key];
  }
  const plan = {
    schemaVersion: 1,
    planKind: "fill-fields",
    actions,
    stopOnError: true,
    rollback: "best-effort",
    finalReadback: true,
    finalReadbackPlan: { operation: "known_page_state", args: finalReadbackArgs }
  };
  try {
    const result = await dependencies.worker("bulk_action", plan, timeoutMs, signal);
    return dependencies.finish(result, resourceRefs);
  } catch (error) {
    const failed = dependencies.executionError("fill_fields", error);
    return dependencies.finish({
      ...failed,
      schemaVersion: 1,
      planKind: "fill-fields",
      completed: [],
      failedAction: null,
      failedIndex: null,
      skipped: actions.map((action, index) => ({ ...action, index, status: "skipped" })),
      rollback: { mode: "best-effort", attempted: false, ok: null, entries: [] },
      cleanupRequired: true,
      finalReadback: null,
      finalReadbackVerified: false,
      resultingState: "unknown",
      verified: false,
      performance: { workerProcessCount: 1 }
    }, resourceRefs);
  }
}
async function executeReceiptManagerBulkPlan(args, configured, timeoutMs, signal, dependencies) {
  try {
    const result = await dependencies.worker("receipt_manager_bulk_upsert", configured.args, timeoutMs, signal);
    return dependencies.finish(result, configured.resourceRefs);
  } catch (error) {
    const failed = dependencies.executionError("receipt_manager_bulk_upsert", error);
    const items = Array.isArray(args.items) ? args.items : [];
    return dependencies.finish({
      ...failed,
      schemaVersion: 1,
      planKind: "receipt-manager-bulk-upsert",
      requestedCount: items.length,
      completedCount: 0,
      completed: [],
      failedIndex: null,
      failedAction: null,
      skipped: items.map((item, index) => ({ index, item, status: "skipped" })),
      rollback: { mode: "best-effort", attempted: false, ok: null, entries: [] },
      cleanupRequired: true,
      finalReadback: null,
      finalReadbackVerified: false,
      resultingState: "unknown",
      verified: false,
      performance: { workerProcessCount: 1 }
    }, configured.resourceRefs);
  }
}
var init_bulk_plan_executor = __esm({
  "src/bulk-plan-executor.ts"() {
    "use strict";
    init_executor_errors();
    init_operation_catalog();
    init_product_profiles();
    init_resources();
  }
});

// src/api-resource-bindings.ts
var API_RESOURCE_BINDINGS;
var init_api_resource_bindings = __esm({
  "src/api-resource-bindings.ts"() {
    "use strict";
    API_RESOURCE_BINDINGS = Object.freeze({
      case_hash: [{ alias: "ref", workerField: "path", allowedAreas: ["cases"] }],
      case_create: [{ alias: "targetRef", workerField: "targetPath", allowedAreas: ["cases"] }],
      center_refresh: [{ alias: "expectedDirectoryRef", workerField: "expectedDirectory", allowedAreas: ["cases"] }],
      launch: [{ alias: "caseRef", workerField: "file", allowedAreas: ["cases"] }],
      desktop_start: [{ alias: "caseRef", workerField: "file", allowedAreas: ["cases"] }],
      collect: [{ alias: "resultRef", workerField: "path", allowedAreas: ["results"] }],
      export_csv: [{ alias: "resultRef", workerField: "dir", allowedAreas: ["results"] }],
      verify: [{ alias: "sourceRef", workerField: "from", allowedAreas: ["results", "workspace"] }],
      screenshot: [{ alias: "resultRef", workerField: "path", allowedAreas: ["results"] }],
      save: [{ alias: "caseRef", workerField: "expectedPath", allowedAreas: ["cases"] }],
      dialog_answer: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
      file_dialog_select: [{
        alias: "resourceRef",
        workerField: "expectedPath",
        allowedAreas: ["cases", "documents", "workspace", "results", "backups"]
      }],
      receipt_manager_import: [{
        alias: "resourceRef",
        workerField: "expectedPath",
        allowedAreas: ["documents"]
      }],
      vast_apply: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
      tracked_set_value: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
      combo_select: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
      toggle: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
      save_as: [
        { alias: "sourceRef", workerField: "expectedSourcePath", allowedAreas: ["cases"] },
        { alias: "targetRef", workerField: "targetPath", allowedAreas: ["cases"] }
      ],
      make_working_copy: [
        { alias: "sourceRef", workerField: "source", allowedAreas: ["cases"] },
        // Backups sind hashgepruefte Arbeitskopien mit eigenem Ablagezweck.
        { alias: "targetRef", workerField: "target", allowedAreas: ["cases", "backups"] }
      ],
      backup_cases: [{ alias: "destinationRef", workerField: "dest", allowedAreas: ["backups"] }],
      archive_cases: [{ alias: "destinationRef", workerField: "dest", allowedAreas: ["backups"] }]
    });
  }
});

// src/case-create-executor.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync7, readFileSync } from "node:fs";
import { basename as basename3 } from "node:path";
async function cleanupStartedProcess(worker, pid) {
  let cleanup = { ok: false, kind: "cleanup-not-run", error: "Cleanup wurde nicht ausgefuehrt." };
  const errors = [];
  try {
    cleanup = await worker("close", { pid, force: true, discardChanges: true }, 3e4);
  } catch (error) {
    errors.push(`close: ${error instanceof Error ? error.message : String(error)}`);
  }
  let processStillRunning = true;
  try {
    const status = await worker("product_info", {}, 3e4);
    if (status.ok === true && Object.hasOwn(status, "supportedRunning") && Object.hasOwn(status, "ignoredRunning")) {
      const running = [
        ...asArray(status.supportedRunning),
        ...asArray(status.ignoredRunning)
      ];
      processStillRunning = running.some((entry) => Number(entry.pid) === pid);
    } else {
      errors.push("product_info: Prozessstatus war unvollstaendig.");
    }
  } catch (error) {
    errors.push(`product_info: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { cleanup, processStillRunning, ...errors.length ? { cleanupError: errors.join(" ") } : {} };
}
function expectedFileSuffix(profile, mode, wizard) {
  const documentType = profile.startModes[mode];
  const taxYear = profile.taxYear + wizard.yearOffset;
  const released = profile.additionalCaseYears?.[mode] ?? [];
  if (!documentType || !released.includes(taxYear)) {
    fail("bad-args", `Startmodus '${mode}' ist im aktiven Produktprofil nicht fuer einen neuen Fall des Jahres ${taxYear} freigegeben.`);
  }
  return { suffix: `.${documentType}${taxYear}`, taxYear };
}
async function executeCaseCreate(args, timeoutMs, signal, dependencies) {
  const now = dependencies.now ?? Date.now;
  const budgetMs = Math.min(timeoutMs ?? LAUNCH_OPERATION_TIMEOUT_MS, MAX_OPERATION_TIMEOUT_MS);
  const deadline = now() + budgetMs;
  const steps = [];
  let pid = 0;
  let hwnd = 0;
  let target;
  const step = async (operation, stepArgs, ceilingMs = budgetMs) => {
    if (signal?.aborted) fail("aborted", "API-Client hat die Fallanlage abgebrochen.");
    const remaining = deadline - now();
    if (remaining < MIN_STEP_MS) fail("timeout", `Zeitbudget der Fallanlage ist vor '${operation}' erschoepft.`);
    steps.push(operation);
    const result = await dependencies.execute(operation, stepArgs, Math.min(remaining, ceilingMs), signal);
    if (result.ok !== true) throw new StepFailure({ ...result, failedStep: operation });
    return result;
  };
  const wait = (ms) => new Promise((resolve16) => setTimeout(resolve16, ms));
  try {
    const mode = String(args.mode ?? "");
    const wizard = CASE_CREATE_WIZARDS[mode] ?? fail("bad-args", `Startmodus '${mode}' besitzt keinen live verifizierten Assistentenweg fuer neue Faelle.`);
    target = dependencies.resolveTarget(args);
    const { suffix, taxYear } = expectedFileSuffix(dependencies.profile, mode, wizard);
    const fileName = basename3(target.path);
    if (!fileName.endsWith(suffix) || fileName.length <= suffix.length) {
      fail("bad-args", `Zieldatei muss auf '${suffix}' enden und einen Namen davor tragen; '${fileName}' passt nicht.`);
    }
    if (existsSync7(target.path)) fail("target-exists", "Zieldatei existiert bereits; case_create ueberschreibt niemals.");
    const instances = await step("instances", {});
    if (Number(instances.count) !== 0) {
      fail("confirmation-required", "Es ist bereits eine SSE-Instanz offen. case_create startet nur ohne offene Instanz; den offenen Fall zuerst bewusst schliessen oder sichern.");
    }
    const desktop = await step("desktop_status", {});
    if (desktop.aktiv === true) {
      fail("hidden-desktop", "Der versteckte Desktop ist aktiv; der Startassistent braucht den sichtbaren Desktop.");
    }
    const launchBudget = Math.max(MIN_LAUNCH_MS, deadline - now() - WIZARD_RESERVE_MS);
    const launched = await step("launch", { mode }, launchBudget);
    pid = Number(launched.pid);
    if (!Number.isInteger(pid) || pid <= 0) fail("startup-pid", "Der Start lieferte keine verifizierbare PID.");
    let startHeading = "";
    for (; ; ) {
      const bound2 = await step("instances", {});
      const instance = asArray(bound2.instances).find((entry2) => Number(entry2.pid) === pid);
      if (instance && Number(bound2.count) === 1 && instance.hung !== true && instance.recoveredState !== true) {
        hwnd = Number(instance.hwnd);
        const state = await step("ui_state", { hwnd });
        const heading = String(state.heading ?? "");
        const match = wizard.startHeading.exec(heading);
        if (match) {
          if (Number(match[1]) !== taxYear) {
            fail("wizard-page", `Der Assistent bietet das Jahr ${match[1]} an, das Profil erlaubt fuer '${mode}' nur ${taxYear}.`);
          }
          startHeading = heading;
          break;
        }
      }
      if (deadline - now() < WIZARD_RESERVE_MS / 2) {
        fail("wizard-page", "Die Startseite des Assistenten erschien nicht rechtzeitig nach dem Programmstart.");
      }
      await wait(START_PAGE_POLL_MS);
    }
    const subpages = await step("subpages", { hwnd });
    const begin = asArray(subpages.unterseiten).find((entry2) => String(entry2.schalter ?? "") === wizard.beginLink && typeof entry2.rid === "string" && entry2.rid);
    if (!begin) fail("wizard-page", `Der Startlink '${wizard.beginLink}' fehlt auf '${startHeading}'.`);
    const began = await step("click", {
      rid: begin.rid,
      hwnd,
      expectedPageBefore: startHeading,
      expectedPageAfter: wizard.modeChoiceHeading,
      waitMs: 6e3
    });
    if (String(began.ueberschriftNachher ?? "") !== wizard.modeChoiceHeading) {
      fail("wizard-page", `Nach '${wizard.beginLink}' steht '${String(began.ueberschriftNachher ?? "")}' statt '${wizard.modeChoiceHeading}'.`);
    }
    await step("click", { aid: wizard.modeChoiceAid, hwnd, expectedPageBefore: wizard.modeChoiceHeading, waitMs: 3e3 });
    const master = await step("click", {
      name: wizard.nextButton,
      hwnd,
      expectedPageBefore: wizard.modeChoiceHeading,
      expectedPageAfter: wizard.masterDataHeading,
      waitMs: 9e3
    });
    if (String(master.ueberschriftNachher ?? "") !== wizard.masterDataHeading) {
      fail("wizard-page", `Nach '${wizard.nextButton}' steht '${String(master.ueberschriftNachher ?? "")}' statt '${wizard.masterDataHeading}'.`);
    }
    const menu = await step("menu", { name: wizard.saveMenu, hwnd });
    const entry = asArray(menu.eintraege).find((candidate) => String(candidate.name ?? "") === wizard.saveMenuEntry);
    if (!entry || entry.gesperrt === true || entry.aktiv === false) {
      fail("menu-entry", `Menueeintrag '${wizard.saveMenuEntry}' ist nicht aktiv verfuegbar.`);
    }
    try {
      await step("menu_click", { name: wizard.saveMenuEntry, hwnd, waitMs: 5e3 });
      const dialogs = await step("dialog_list", { pid });
      const saveDialogs = asArray(dialogs.dialogs).filter((dialog) => String(dialog.kind ?? "") === "native-dialog" && String(dialog.title ?? "") === wizard.saveDialogTitle);
      if (saveDialogs.length !== 1) {
        fail("save-dialog", `Erwartet genau einen nativen Dialog '${wizard.saveDialogTitle}', gefunden ${saveDialogs.length}.`);
      }
    } catch (error) {
      await dependencies.execute("menu_close", { hwnd }, MIN_STEP_MS * 5, signal).catch(() => void 0);
      throw error;
    }
    const saved = await step("file_dialog_select", {
      expectedDialogTitle: wizard.saveDialogTitle,
      expectedPath: target.path,
      waitMs: 15e3
    });
    const sha256 = String(saved.sha256 ?? "");
    if (saved.mode !== "save-new" || saved.verified !== true || !/^[A-F0-9]{64}$/iu.test(sha256)) {
      throw new StepFailure(operationError("Der Speicherdialog schloss ohne verifizierten save-new-Readback.", "postcondition-failed"));
    }
    const readback = await step("instances", { includeHash: true });
    const bound = asArray(readback.instances).find((entry2) => Number(entry2.pid) === pid);
    if (!bound || String(bound.caseName ?? "") !== fileName || bound.recoveredState === true) {
      throw new StepFailure(operationError("Die gespeicherte Datei ist nicht exakt an das offene Fallfenster gebunden.", "postcondition-failed"));
    }
    const instanceHash = typeof bound.caseSha256 === "string" ? bound.caseSha256.toUpperCase() : null;
    const diskHash = instanceHash ?? createHash2("sha256").update(readFileSync(target.path)).digest("hex").toUpperCase();
    if (diskHash !== sha256.toUpperCase()) {
      throw new StepFailure(operationError("Der Dateihash nach dem Speichern weicht vom Dialog-Readback ab.", "postcondition-failed"));
    }
    return {
      ok: true,
      created: true,
      caseRef: target.ref || target.path,
      sha256: sha256.toUpperCase(),
      pid,
      hwnd: Number(bound.hwnd),
      caseHashSource: instanceHash ? "instances" : "local-file",
      mode,
      taxYear,
      heading: wizard.masterDataHeading,
      steps,
      effects: { ...EFFECTS },
      note: "Der neue Fall ist geoeffnet und leer gespeichert. Stammdaten jetzt mit fill_fields fuellen; vor der ersten weiteren Mutation den Dateistand nach backups: sichern."
    };
  } catch (error) {
    const failure = error instanceof StepFailure ? error.result : operationError(error instanceof Error ? error.message : String(error), signal?.aborted ? "aborted" : "case-create");
    const created = target !== void 0 && existsSync7(target.path);
    if (pid > 0 && !created) {
      const cleanupState = await cleanupStartedProcess(dependencies.worker, pid);
      return { ...failure, created: false, steps, pid, ...cleanupState };
    }
    return {
      ...failure,
      created,
      steps,
      ...pid > 0 ? { pid, processStillRunning: true } : {},
      ...created ? { caseRef: target.ref || target.path } : {}
    };
  }
}
var CASE_CREATE_WIZARDS, MIN_STEP_MS, MIN_LAUNCH_MS, WIZARD_RESERVE_MS, START_PAGE_POLL_MS, EFFECTS, StepFailure, fail;
var init_case_create_executor = __esm({
  "src/case-create-executor.ts"() {
    "use strict";
    init_api_contract();
    init_executor_errors();
    CASE_CREATE_WIZARDS = Object.freeze({
      einurvor: {
        startHeading: /^Gewinn-Erfassung für das Jahr (\d{4})$/u,
        beginLink: "Jetzt beginnen",
        modeChoiceHeading: "Beginn der Datenbearbeitung",
        modeChoiceAid: "btnNavigatormodusEinURVor",
        nextButton: "Weiter",
        masterDataHeading: "Allgemeine Angaben zum Unternehmen",
        saveMenu: "Datei",
        saveMenuEntry: "Speichern unter... Strg+Alt+S",
        saveDialogTitle: "Gewinn-Erfassung speichern",
        yearOffset: 1
      }
    });
    MIN_STEP_MS = 2e3;
    MIN_LAUNCH_MS = 3e4;
    WIZARD_RESERVE_MS = 6e4;
    START_PAGE_POLL_MS = 1500;
    EFFECTS = Object.freeze({ taxDataChanged: false, savePerformed: true, submissionPerformed: false });
    StepFailure = class extends Error {
      constructor(result) {
        super(String(result.error ?? result.kind ?? "Schritt scheiterte."));
        this.result = result;
      }
      result;
    };
    fail = (kind, error) => {
      throw new StepFailure(operationError(error, kind));
    };
  }
});

// src/launch-executor.ts
async function executeLaunchOperation(args, timeoutMs, signal, worker) {
  if (timeoutMs !== void 0 && timeoutMs < MINIMUM_LAUNCH_TIMEOUT_MS) {
    return operationError(
      `SSE-Start verlangt timeoutMs >= ${MINIMUM_LAUNCH_TIMEOUT_MS}, damit nach dem Prozessstart eine PID- und Fensterbindung moeglich bleibt.`,
      "bad-args"
    );
  }
  const startedAt = Date.now();
  const launchBudgetMs = Math.min(timeoutMs ?? MAXIMUM_LAUNCH_TIMEOUT_MS, MAXIMUM_LAUNCH_TIMEOUT_MS);
  const deadline = startedAt + launchBudgetMs;
  const started = await worker("launch", args, MINIMUM_LAUNCH_TIMEOUT_MS, signal);
  if (started.ok === false) return started;
  const pid = Number(started.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return operationError(
      "SSE-Start lieferte keine verifizierbare PID; Zustand vor Wiederholung manuell pruefen.",
      "startup-pid"
    );
  }
  const cleanupStartedProcess2 = async () => {
    let cleanup = { ok: false, kind: "cleanup-not-run", error: "Cleanup wurde nicht ausgefuehrt." };
    const errors = [];
    try {
      cleanup = await worker("close", { pid, force: true, discardChanges: true }, 3e4);
    } catch (error) {
      errors.push(`close: ${error instanceof Error ? error.message : String(error)}`);
    }
    let stillRunning = true;
    try {
      const status = await worker("product_info", {}, 3e4);
      if (status.ok === true && Object.hasOwn(status, "supportedRunning") && Object.hasOwn(status, "ignoredRunning")) {
        const running = [
          ...asArray(status.supportedRunning),
          ...asArray(status.ignoredRunning)
        ];
        stillRunning = running.some((entry) => Number(entry.pid) === pid);
      } else {
        errors.push("product_info: Prozessstatus war unvollstaendig.");
      }
    } catch (error) {
      errors.push(`product_info: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      cleanup,
      stillRunning,
      ...errors.length ? { cleanupError: errors.join(" ") } : {}
    };
  };
  let lastProbeError;
  let probeFailures = 0;
  let lastStartupPrompts = [];
  try {
    if (signal?.aborted) {
      const cleanupState2 = await cleanupStartedProcess2();
      return {
        ok: false,
        kind: cleanupState2.stillRunning ? "startup-abort-cleanup" : "aborted",
        error: cleanupState2.stillRunning ? `API-Client brach den Start ab; die exakt gestartete SSE-PID ${pid} laeuft trotz Cleanup noch.` : "API-Client hat den Start abgebrochen; die exakt gestartete SSE-PID wurde ohne Speichern beendet.",
        pid,
        processStillRunning: cleanupState2.stillRunning,
        cleanup: cleanupState2.cleanup,
        cleanupError: cleanupState2.cleanupError,
        effectiveTimeoutMs: launchBudgetMs
      };
    }
    let observed = { ok: true, outcome: "deadline", windows: [], dialogs: [] };
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1e3) break;
      const launchProbePlan = {
        schemaVersion: 1,
        planKind: "launch-readiness",
        pid,
        hasCase: typeof args.file === "string" && args.file.length > 0,
        deadlineUnixMs: deadline
      };
      observed = await worker("launch_probe", launchProbePlan, remainingMs, signal);
      if (observed.ok === false) {
        lastProbeError = `launch_probe: ${String(observed.error ?? observed.kind ?? "Startinventur fehlgeschlagen.")}`;
        probeFailures += 1;
        break;
      }
      const reportedFailures = Number(observed.probeFailures);
      if (Number.isSafeInteger(reportedFailures) && reportedFailures >= 0) probeFailures += reportedFailures;
      if (typeof observed.lastProbeError === "string" && observed.lastProbeError.length > 0) {
        lastProbeError = observed.lastProbeError;
      }
      if (observed.outcome === "observed" || observed.outcome === "deadline") break;
      if (observed.outcome !== "retry-fresh") {
        lastProbeError = "launch_probe: Worker lieferte keinen bekannten Probe-Ausgang.";
        probeFailures += 1;
        observed = { ok: false, kind: "launch-probe-contract", error: lastProbeError };
        break;
      }
      if (observed.windowProbeSucceeded === true) {
        lastStartupPrompts = asArray(observed.startupPrompts).filter((window) => Number(window.pid) === pid && Number(window.hwnd) > 0);
      }
      if (!signal?.aborted) await waitForNextProbe();
    }
    const terminalProbeResult = observed.ok === true && ["observed", "deadline"].includes(String(observed.outcome));
    const windows = (terminalProbeResult ? asArray(observed.windows) : []).filter((window) => Number(window.pid) === pid && Number(window.hwnd) > 0);
    const hasCase = typeof args.file === "string" && args.file.length > 0;
    const titledLikeSse = windows.filter((window) => {
      const title = String(window.title ?? "");
      return title.includes("SteuerSparErklärung") || !hasCase && title === "Steuerprogramm";
    });
    const mainCandidates = titledLikeSse.filter((window) => Number(window.w) >= MIN_MAIN_WINDOW_WIDTH || window.minimiert === true).sort((left, right) => Number(right.w) * Number(right.h) - Number(left.w) * Number(left.h));
    if (terminalProbeResult) {
      lastStartupPrompts = titledLikeSse.filter((window) => !mainCandidates.includes(window));
    }
    const dialogs = (terminalProbeResult ? asArray(observed.dialogs) : []).filter((dialog) => Number(dialog.pid) === pid && ["native-dialog", "qt-dialog"].includes(String(dialog.kind)));
    if (mainCandidates.length > 0 || dialogs.length > 0) {
      const mainCandidate = mainCandidates[0];
      const instance = mainCandidates.length === 1 ? {
        pid,
        hwnd: Number(mainCandidate.hwnd),
        title: String(mainCandidate.title ?? ""),
        bindingMode: "launch-window"
      } : null;
      if (instance && RECOVERED_STATE_TITLE.test(instance.title)) {
        return {
          ok: false,
          kind: "recovered-state",
          error: "SteuerSparErklaerung hat eine Wiederherstellungsdatei geladen; der geoeffnete Fall entspricht nicht mehr der verifizierten Datei. Fall ohne Speichern schliessen, die Wiederherstellung im Programm verwerfen und danach erneut oeffnen.",
          pid,
          windows,
          instance,
          dialogs,
          effectiveTimeoutMs: launchBudgetMs,
          probeFailures
        };
      }
      return {
        ...started,
        waitedSec: Math.round((Date.now() - startedAt) / 100) / 10,
        windows,
        instance,
        ready: instance !== null,
        blockedByDialog: dialogs.length > 0,
        dialogs,
        effectiveTimeoutMs: launchBudgetMs,
        probeFailures
      };
    }
    if (lastStartupPrompts.length > 0) {
      return {
        ok: false,
        kind: "startup-question",
        error: "SteuerSparErklaerung zeigt statt des Fallfensters ein schmales Fenster und wartet auf eine Antwort. Meist ist das die Startfrage nach einer Wiederherstellungsdatei nach einem unsauberen Ende. Diese Frage im Programm beantworten - eine Wiederherstellung gehoert verworfen, weil ihr Inhalt nicht mehr zur geprueften Falldatei passt - und danach erneut oeffnen. Der gestartete Prozess laeuft absichtlich weiter; ihn hier zu beenden erzeugte die naechste Wiederherstellungsdatei.",
        pid,
        processStillRunning: true,
        windows: lastStartupPrompts,
        startupPrompts: lastStartupPrompts,
        instance: null,
        ready: false,
        effectiveTimeoutMs: launchBudgetMs,
        lastProbeError,
        probeFailures
      };
    }
    const cleanupState = await cleanupStartedProcess2();
    return {
      ok: false,
      kind: cleanupState.stillRunning ? "startup-timeout-cleanup" : "startup-timeout",
      error: cleanupState.stillRunning ? `SSE-PID ${pid} erzeugte kein verifiziertes Fallfenster und konnte nicht sicher beendet werden.` : `SSE-PID ${pid} erzeugte innerhalb von ${Math.round((Date.now() - startedAt) / 100) / 10} Sekunden kein verifiziertes Fallfenster; der gestartete Prozess wurde beendet.`,
      pid,
      processStillRunning: cleanupState.stillRunning,
      cleanup: cleanupState.cleanup,
      cleanupError: cleanupState.cleanupError,
      effectiveTimeoutMs: launchBudgetMs,
      lastProbeError,
      probeFailures
    };
  } catch (error) {
    const cleanupState = await cleanupStartedProcess2();
    const kind = error && typeof error === "object" && typeof error.kind === "string" ? String(error.kind) : "startup-probe";
    if (signal?.aborted || kind === "aborted") {
      return {
        ok: false,
        kind: cleanupState.stillRunning ? "startup-abort-cleanup" : "aborted",
        error: cleanupState.stillRunning ? `API-Client brach den Start ab; die exakt gestartete SSE-PID ${pid} laeuft trotz Cleanup noch.` : "API-Client hat den Start abgebrochen; die exakt gestartete SSE-PID wurde ohne Speichern beendet.",
        pid,
        processStillRunning: cleanupState.stillRunning,
        cleanup: cleanupState.cleanup,
        cleanupError: cleanupState.cleanupError,
        effectiveTimeoutMs: launchBudgetMs
      };
    }
    return {
      ok: false,
      kind: cleanupState.stillRunning ? "startup-probe-cleanup" : kind,
      error: cleanupState.stillRunning ? `${error instanceof Error ? error.message : String(error)} Die exakt gestartete PID ${pid} laeuft trotz Cleanup noch.` : `${error instanceof Error ? error.message : String(error)} Die exakt gestartete PID wurde ohne Speichern beendet.`,
      pid,
      processStillRunning: cleanupState.stillRunning,
      cleanup: cleanupState.cleanup,
      cleanupError: cleanupState.cleanupError,
      effectiveTimeoutMs: launchBudgetMs,
      lastProbeError,
      probeFailures
    };
  }
}
function waitForNextProbe() {
  return new Promise((resolve16) => setTimeout(resolve16, 250));
}
var MINIMUM_LAUNCH_TIMEOUT_MS, MAXIMUM_LAUNCH_TIMEOUT_MS, RECOVERED_STATE_TITLE, MIN_MAIN_WINDOW_WIDTH;
var init_launch_executor = __esm({
  "src/launch-executor.ts"() {
    "use strict";
    init_api_contract();
    init_executor_errors();
    MINIMUM_LAUNCH_TIMEOUT_MS = 3e4;
    MAXIMUM_LAUNCH_TIMEOUT_MS = 3e5;
    RECOVERED_STATE_TITLE = /\(Wiederhergestellt\)/iu;
    MIN_MAIN_WINDOW_WIDTH = 900;
  }
});

// src/receipt-interaction-policy.ts
function receiptInteractionRequirement(operation) {
  if (FOCUSLESS.has(operation)) return "focusless-read";
  if (FOREGROUND_REQUIRED.has(operation)) return "foreground-required";
  return null;
}
function receiptBlock(operation, args, interactiveLeaseActive = false) {
  if (receiptInteractionRequirement(operation) !== "foreground-required") return null;
  parseApiOperationArgs(operation, args);
  if (interactiveLeaseActive) return null;
  return {
    ok: false,
    kind: "blocked",
    error: `Operation '${operation}' ist im Hintergrund gesperrt, weil der verifizierte BelegManager-Weg Vordergrund- oder globale physische Eingabe benoetigt. Keine UI wurde geaendert; nicht automatisch wiederholen.`,
    reason: RECEIPT_FOREGROUND_BLOCK_REASON,
    retryable: false,
    interactionRequirement: "foreground-required",
    mutationStarted: false,
    resultingState: "unchanged",
    cleanupRequired: false,
    physicalInputUsed: false,
    foregroundLeaseUsed: false
  };
}
var SSE_FOCUSLESS_RECEIPT_OPERATIONS, SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS, FOCUSLESS, FOREGROUND_REQUIRED, RECEIPT_FOREGROUND_BLOCK_REASON;
var init_receipt_interaction_policy = __esm({
  "src/receipt-interaction-policy.ts"() {
    "use strict";
    init_operation_catalog();
    SSE_FOCUSLESS_RECEIPT_OPERATIONS = [
      "receipt_manager_list"
    ];
    SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS = [
      "receipt_manager_action",
      "receipt_manager_bulk_upsert",
      "receipt_manager_classification_options",
      "receipt_manager_classify",
      "receipt_manager_delete",
      "receipt_manager_import",
      "receipt_manager_link",
      "receipt_manager_read",
      "receipt_manager_update"
    ];
    FOCUSLESS = new Set(SSE_FOCUSLESS_RECEIPT_OPERATIONS);
    FOREGROUND_REQUIRED = new Set(SSE_FOREGROUND_REQUIRED_RECEIPT_OPERATIONS);
    RECEIPT_FOREGROUND_BLOCK_REASON = "foreground-required-operation-disabled";
  }
});

// src/profile-operation-policy.ts
function profileOperationClass(operation) {
  if (READ_ONLY.has(operation)) return "read";
  if (CLEANUP.has(operation)) return "cleanup";
  if (operation === "tracked_set_value") return "focusless-write-conditional";
  if (NAVIGATION.has(operation)) return "navigation";
  if (DESTRUCTIVE.has(operation)) return "destructive";
  return "mutation";
}
function createProfileOperationCapability(profileStatus, operationAccess, operateExperimental, operation, interactiveReceiptLeaseActive = false) {
  const interactionRequirement = receiptInteractionRequirement(operation);
  const common = {
    operation,
    class: profileOperationClass(operation),
    blockedOnBuildDrift: BUILD_DRIFT_BLOCKED.has(operation),
    ...interactionRequirement ? { interactionRequirement } : {}
  };
  if (BASE.has(operation)) {
    return {
      ...common,
      availability: "allowed",
      requiresExperimentalOptIn: false,
      reason: "Profilunabhängige Katalog-, Diagnose- oder sichere Dateiauskunft."
    };
  }
  if (profileStatus === "disabled") {
    return {
      ...common,
      availability: "blocked",
      requiresExperimentalOptIn: false,
      reason: "Das Produktprofil ist deaktiviert; Betriebsoperationen sind gesperrt."
    };
  }
  if (interactionRequirement === "foreground-required") {
    return {
      ...common,
      availability: interactiveReceiptLeaseActive ? "conditional" : "blocked",
      requiresExperimentalOptIn: false,
      requiresInteractiveReceiptLease: true,
      reason: interactiveReceiptLeaseActive ? "Nur im kurzlebigen lokalen Test-API-Servermodus freigegeben; der Worker prueft Nonce, Ablauf, Besitzer, Sitzung und sichtbaren Vordergrund je Aufruf erneut." : "Der verifizierte BelegManager-Weg benoetigt Vordergrund- oder globale physische Eingabe; Hintergrundaufrufe stoppen vor jeder UI-Aenderung."
    };
  }
  if (profileStatus === "supported" && operationAccess === "full") {
    return {
      ...common,
      availability: "allowed",
      requiresExperimentalOptIn: false,
      reason: "Vom vollständigen Profilvertrag freigegeben; operationsspezifische Guards gelten zusätzlich."
    };
  }
  if (operation === "dialog_answer") {
    return {
      ...common,
      availability: operateExperimental ? "conditional" : "blocked",
      requiresExperimentalOptIn: true,
      reason: operateExperimental ? "Nur der exakt gebundene passive OK-Startdialog ist erlaubt." : "Dialogantworten erfordern den Experimental-Opt-in und bleiben danach eng bedingt."
    };
  }
  if (VERIFICATION.has(operation)) {
    return {
      ...common,
      availability: operateExperimental ? "allowed" : "blocked",
      requiresExperimentalOptIn: true,
      reason: operateExperimental ? "Expliziter Lese-/Navigations-/Wegwerfkopie-Verifikationskatalog." : "Nur mit bewusstem Experimental-Opt-in zur Jahresverifikation verfügbar."
    };
  }
  return {
    ...common,
    availability: "blocked",
    requiresExperimentalOptIn: true,
    reason: "Für das experimentelle Profil nicht live verifiziert."
  };
}
function createProfileOperationMatrix(profileStatus, operationAccess, operateExperimental, interactiveReceiptLeaseActive = false) {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [
      operation,
      Object.freeze(createProfileOperationCapability(
        profileStatus,
        operationAccess,
        operateExperimental,
        operation,
        interactiveReceiptLeaseActive
      ))
    ])
  ));
}
var EXPERIMENTAL_PROFILE_BASE_OPERATIONS, EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS, BASE, VERIFICATION, READ_ONLY, CLEANUP, DESTRUCTIVE, BUILD_DRIFT_BLOCKED, NAVIGATION;
var init_profile_operation_policy = __esm({
  "src/profile-operation-policy.ts"() {
    "use strict";
    init_api_contract();
    init_operation_traits();
    init_receipt_interaction_policy();
    EXPERIMENTAL_PROFILE_BASE_OPERATIONS = [
      "capabilities",
      "health",
      "help",
      "product_info",
      "workspace_status",
      "list_cases",
      "case_hash",
      "workspace_file_list",
      "workspace_file_read_text"
    ];
    EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS = [
      "accessibility_probe",
      "check",
      "checker_close",
      "checker_detail",
      "checker_open",
      "checker_reset",
      "checker_results",
      "checker_run",
      "click_point",
      "close",
      "combo_options",
      "dialog_list",
      "find",
      "get_value",
      "goto",
      "known_page_state",
      "launch",
      "make_working_copy",
      "page",
      "page_objects",
      "positions",
      "read_full",
      "read_page",
      "read_table",
      "receipt_manager_list",
      "receipt_manager_read",
      "receipt_manager_classification_options",
      "result_details",
      "scroll",
      "scroll_page",
      "snapshot",
      "snapshot_compare",
      "subpages",
      "table_read",
      "tree_scroll",
      "tree_top",
      "ui_state",
      "ustva_read",
      "warning_popup_read",
      "window_close",
      "window_restore",
      "windows",
      "instances"
    ];
    BASE = new Set(EXPERIMENTAL_PROFILE_BASE_OPERATIONS);
    VERIFICATION = new Set(EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS);
    READ_ONLY = new Set(SSE_READ_ONLY_OPERATIONS);
    CLEANUP = new Set(SSE_CLEANUP_OPERATIONS);
    DESTRUCTIVE = new Set(SSE_DESTRUCTIVE_OPERATIONS);
    BUILD_DRIFT_BLOCKED = new Set(SSE_BUILD_DRIFT_BLOCKED_OPERATIONS);
    NAVIGATION = /* @__PURE__ */ new Set([
      "click",
      "click_point",
      "find",
      "goto",
      "scroll",
      "scroll_page",
      "set_value",
      "subpages",
      "tree_scroll",
      "tree_top",
      "ustva_open_section",
      "window_restore",
      "receipt_manager_action",
      "receipt_manager_bulk_upsert",
      "receipt_manager_classification_options",
      "receipt_manager_classify",
      "receipt_manager_link",
      "receipt_manager_delete",
      "receipt_manager_import",
      "receipt_manager_read",
      "receipt_manager_update"
    ]);
  }
});

// src/page-objects-executor.ts
import { performance } from "node:perf_hooks";
function executeLocalPageObjects(options) {
  const effectiveTimeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const localStartedAt = performance.now();
  const remainingTimeoutMs2 = () => Math.max(
    0,
    Math.floor(effectiveTimeoutMs - (performance.now() - localStartedAt))
  );
  const localStopResult = () => {
    if (options.signal?.aborted) {
      return operationError("API-Client hat den Page-Object-Katalog abgebrochen.", "aborted");
    }
    if (remainingTimeoutMs2() <= 0) {
      return operationError("Zeitbudget beim lokalen Lesen des Page-Object-Katalogs aufgebraucht.", "timeout");
    }
    return void 0;
  };
  const localResult = (result) => {
    const stoppedBeforeRedaction = localStopResult();
    if (stoppedBeforeRedaction) {
      return { kind: "result", result: options.redactPaths(stoppedBeforeRedaction) };
    }
    const redacted = options.redactPaths(result);
    const stoppedAfterRedaction = localStopResult();
    return {
      kind: "result",
      result: stoppedAfterRedaction ? options.redactPaths(stoppedAfterRedaction) : redacted
    };
  };
  const stoppedBeforeLoad = localStopResult();
  if (stoppedBeforeLoad) return localResult(stoppedBeforeLoad);
  let currentProfile;
  try {
    currentProfile = loadProductProfile(options.profileId, options.profilesRoot);
  } catch {
    return { kind: "worker-fallback", effectiveTimeoutMs, localStartedAt };
  }
  const stoppedAfterLoad = localStopResult();
  if (stoppedAfterLoad) return localResult(stoppedAfterLoad);
  const pageId = typeof options.args.pageId === "string" ? options.args.pageId : "";
  if (!pageId) return localResult({ ok: true, catalog: currentProfile.pageObjectsCatalog });
  const resolved = resolvePageObjectDefinition(currentProfile.pageObjectsCatalog, pageId);
  if (resolved.status === "ambiguous") {
    return { kind: "worker-fallback", effectiveTimeoutMs, localStartedAt };
  }
  if (resolved.status === "missing") {
    return localResult(operationError(`Unbekannte Page-Object-ID '${pageId}'.`, "unknown-page-object"));
  }
  return localResult({ ok: true, pageId, page: resolved.page });
}
var init_page_objects_executor = __esm({
  "src/page-objects-executor.ts"() {
    "use strict";
    init_api_contract();
    init_executor_errors();
    init_product_profiles();
  }
});

// src/ustva.ts
function parseUstvaPageHeading(value) {
  if (typeof value !== "string") return null;
  const match = USTVA_PAGE_HEADING_PATTERN.exec(value);
  if (!match?.groups?.taxYear) return null;
  const taxYear = Number(match.groups.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 2e3 || taxYear > 2200) return null;
  return { page: value, taxYear };
}
function normalizedLabel(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/gu, "").replace(/\s+/gu, " ").trim();
}
function cents(display) {
  if (typeof display !== "string") return null;
  const text = display.trim();
  if (text.length > 64 || !/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/u.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [euros = "", decimal = ""] = unsigned.split(",", 2);
  const exact = BigInt(euros.replaceAll(".", "")) * 100n + BigInt(decimal.padEnd(2, "0") || "0");
  const signed = negative ? -exact : exact;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(signed);
}
function amount(display) {
  const text = typeof display === "string" ? display : null;
  return { display: text, cents: cents(text) };
}
function findFields(fields, label, type) {
  return fields.filter((field) => normalizedLabel(field.label) === label && (!type || field.typ === type));
}
function firstValue(fields, label, type) {
  return findFields(fields, label, type)[0]?.wert;
}
function flagValue(fields, label) {
  const value = firstValue(fields, label, "CheckBox");
  return typeof value === "boolean" ? value : null;
}
function pair(fields, label) {
  const matches = findFields(fields, label, "Edit");
  const byAid = (...aids) => matches.find((field) => aids.includes(String(field.aid ?? "")))?.wert;
  return {
    base: amount(byAid("Wert", "BetragEigen")),
    tax: amount(byAid("WertUSt", "BetragUStEigen"))
  };
}
function detailPair(fields, label) {
  const matches = findFields(fields, label, "Edit");
  return {
    base: amount(matches[0]?.wert),
    tax: amount(matches[1]?.wert)
  };
}
function semanticPeriod(frequencyDisplay, periodDisplay) {
  const frequency = frequencyDisplay === "monatlich" ? "monthly" : frequencyDisplay === "vierteljährlich" ? "quarterly" : null;
  const selector = frequency === "monthly" ? "month" : frequency === "quarterly" ? "quarter" : null;
  let key = null;
  if (selector) {
    const values = USTVA_PERIOD_SELECTORS[selector].values;
    key = Object.entries(values).find(([, display]) => display === periodDisplay)?.[0] ?? null;
  }
  return { frequency, frequencyDisplay, selector, key, display: periodDisplay };
}
function mapUstvaPeriodValue(selector, key) {
  if (!Object.hasOwn(USTVA_PERIOD_SELECTORS, selector)) {
    throw new Error(`Unbekannter UStVA-Zeitraumselektor: '${selector}'.`);
  }
  const definition = USTVA_PERIOD_SELECTORS[selector];
  const display = definition.values[key];
  if (!display) throw new Error(`UStVA-Wert '${key}' ist fuer '${selector}' nicht erlaubt.`);
  return { aid: definition.aid, display };
}
function blockedPage(page) {
  if (page.ok === false) return page;
  const dialogs = Array.isArray(page.dialoge) ? page.dialoge : [];
  if (dialogs.length > 0) {
    return {
      ok: false,
      kind: "dialog-open",
      error: "Ein modaler Dialog ist offen; UStVA-Werte wurden nicht als belastbarer Snapshot ausgegeben.",
      dialogs
    };
  }
  return null;
}
function normalizeUstvaPage(page) {
  const blocked = blockedPage(page);
  if (blocked) return blocked;
  const heading = parseUstvaPageHeading(page.ueberschrift);
  if (!heading) {
    return {
      ok: false,
      kind: "ustva-page",
      error: `UStVA-Lesung braucht '${USTVA_PAGE_HEADING_PREFIX}<Jahr>'; aktuell ist '${String(page.ueberschrift ?? "")}' offen.`
    };
  }
  const fields = Array.isArray(page.felder) ? page.felder : [];
  const frequencyDisplay = firstValue(fields, "Voranmeldezeitraum", "ComboBox");
  const monthDisplay = firstValue(fields, "Auswahl Monat", "ComboBox");
  const quarterDisplay = firstValue(fields, "Auswahl Quartal", "ComboBox");
  const settlementPayment = firstValue(fields, "Umsatzsteuerzahllast", "Edit");
  const settlementRefund = firstValue(fields, "Umsatzsteuererstattung", "Edit");
  const actions = Array.isArray(page.aktionen) ? page.aktionen : [];
  const elster = actions.find((action) => normalizedLabel(action.name).includes("ELSTER"));
  const flags = Object.fromEntries(Object.entries({
    corrected: "Berichtigte Voranmeldung",
    documents: "Belege",
    offset_request: "Verrechnungswunsch",
    revoke_sepa: "Widerruf SEPA-Lastschriftmandat",
    additional_information: "Ergänzende Angaben zur Umsatzsteuer-Voranmeldung",
    manual_input: "Beträge für die Umsatzsteuer-Voranmeldung manuell erfassen"
  }).map(([key, label]) => [key, flagValue(fields, label)]));
  return {
    ok: true,
    pageKind: "overview",
    taxYear: heading.taxYear,
    page: heading.page,
    period: semanticPeriod(
      typeof frequencyDisplay === "string" ? frequencyDisplay : null,
      typeof monthDisplay === "string" ? monthDisplay : typeof quarterDisplay === "string" ? quarterDisplay : null
    ),
    flags,
    amounts: {
      taxable19: pair(fields, "Lieferungen/Leistungen zu 19%"),
      taxable7: pair(fields, "Lieferungen/Leistungen zu 7%"),
      taxableZero: amount(firstValue(fields, "Lieferungen/Leistungen zu 0%", "Edit")),
      otherRates: pair(fields, "Umsätze zu anderen Steuersätzen"),
      taxableTotal: pair(fields, "Steuerpflichtige Umsätze"),
      otherSales: amount(firstValue(fields, "Weitere Umsätze", "Edit")),
      reverseCharge: amount(firstValue(fields, "Steuerschuldner nach § 13b UStG", "Edit")),
      inputTax: amount(firstValue(fields, "Vorsteuer", "Edit")),
      inputTaxAdjustment: amount(firstValue(fields, "Vorsteuerberichtigung nach § 15a UStG", "Edit")),
      unauthorizedTax: amount(firstValue(fields, "unberechtigt ausgewiesene Steuerbeträge", "Edit")),
      specialAdvancePayment: amount(firstValue(fields, "Anrechnung Sondervorauszahlung", "Edit")),
      settlement: settlementPayment !== void 0 ? { kind: "payment", ...amount(settlementPayment) } : settlementRefund !== void 0 ? { kind: "refund", ...amount(settlementRefund) } : { kind: "unknown", ...amount(null) },
      reductionTaxableBase: amount(firstValue(fields, "Minderung der Bemessungsgrundlage", "Edit")),
      reductionInputTax: amount(firstValue(fields, "Minderung der abziehbaren Vorsteuer", "Edit"))
    },
    sections: Object.keys(USTVA_SECTIONS),
    blocked: page.blockiert === true,
    messages: Array.isArray(page.prueferMeldungen) ? page.prueferMeldungen : [],
    transmission: {
      blockedByApi: true,
      uiGuardObserved: elster ? elster.gesperrt === true : null,
      existingSubmissionStatus: "not-read"
    },
    effects: { savePerformed: false, submissionPerformed: false },
    note: "Read-only snapshot. Diese Operation speichert und uebermittelt nichts."
  };
}
function normalizeUstvaCurrentPage(page) {
  const blocked = blockedPage(page);
  if (blocked) return blocked;
  if (parseUstvaPageHeading(page.ueberschrift)) return normalizeUstvaPage(page);
  const fields = Array.isArray(page.felder) ? page.felder : [];
  if (page.ueberschrift === USTVA_REVERSE_CHARGE_PAGE) {
    return {
      ok: true,
      pageKind: "reverse_charge",
      page: USTVA_REVERSE_CHARGE_PAGE,
      amounts: {
        euServices: detailPair(fields, "Sonst. Leistungen ausländ. Unternehmer EU"),
        foreignWorkSupplies: detailPair(fields, "Werklieferungen ausländ. Unternehmer"),
        foreignServices: detailPair(fields, "Sonst. Leistungen ausländ. Unternehmer"),
        total: detailPair(fields, "Umsatzsteuer als Leistungsempfänger nach § 13b UStG")
      },
      effects: { savePerformed: false, submissionPerformed: false },
      note: "Read-only §13b-Snapshot. Diese Operation speichert und uebermittelt nichts."
    };
  }
  if (page.ueberschrift === USTVA_INPUT_TAX_PAGE) {
    return {
      ok: true,
      pageKind: "input_tax",
      page: USTVA_INPUT_TAX_PAGE,
      amounts: {
        invoices: amount(firstValue(fields, "Vorsteuer aus Rechnungen von anderen Unternehmern", "Edit")),
        reverseCharge: amount(firstValue(fields, "Vorsteuer als Steuerschuldner nach § 13b UStG", "Edit")),
        intraCommunityAcquisitions: amount(firstValue(fields, "Vorsteuer aus innergemeinschaftlichen Erwerben", "Edit")),
        import: amount(firstValue(fields, "Entrichtete Einfuhrumsatzsteuer", "Edit")),
        intraCommunityTriangular: amount(firstValue(fields, "Vorsteuer aus innergemeinschaftl. Dreiecksgeschäften", "Edit")),
        total: amount(firstValue(fields, "Summe der abziehbaren Vorsteuerbeträge", "Edit"))
      },
      effects: { savePerformed: false, submissionPerformed: false },
      note: "Read-only Vorsteuer-Snapshot. Diese Operation speichert und uebermittelt nichts."
    };
  }
  return {
    ok: false,
    kind: "ustva-page",
    error: `UStVA-Lesung braucht die Übersicht oder einen bekannten Detailbereich; aktuell ist '${String(page.ueberschrift ?? "")}' offen.`
  };
}
var USTVA_PAGE_HEADING_PREFIX, USTVA_PAGE_HEADING_PATTERN, USTVA_REVERSE_CHARGE_PAGE, USTVA_INPUT_TAX_PAGE, USTVA_PERIOD_SELECTORS, USTVA_FLAGS, USTVA_VALUE_FIELDS, USTVA_SECTIONS;
var init_ustva = __esm({
  "src/ustva.ts"() {
    "use strict";
    USTVA_PAGE_HEADING_PREFIX = "Umsatzsteuer-Voranmeldungen ";
    USTVA_PAGE_HEADING_PATTERN = /^Umsatzsteuer-Voranmeldungen (?<taxYear>\d{4})$/u;
    USTVA_REVERSE_CHARGE_PAGE = "Steuerschuldnerschaft nach § 13b UStG";
    USTVA_INPUT_TAX_PAGE = "Abziehbare Vorsteuer";
    USTVA_PERIOD_SELECTORS = {
      frequency: {
        aid: ".AuswahlAnmeldezeitraum.Zeitraum.Combobox",
        values: {
          monthly: "monatlich",
          quarterly: "vierteljährlich"
        }
      },
      month: {
        aid: ".AuswahlAnmeldezeitraum.AuswahlMonat.Combobox",
        values: {
          january: "Januar",
          february: "Februar",
          march: "März",
          april: "April",
          may: "Mai",
          june: "Juni",
          july: "Juli",
          august: "August",
          september: "September",
          october: "Oktober",
          november: "November",
          december: "Dezember"
        }
      },
      quarter: {
        aid: ".AuswahlAnmeldezeitraum.AuswahlQuartal.Combobox",
        values: {
          q1: "1. Vierteljahr",
          q2: "2. Vierteljahr",
          q3: "3. Vierteljahr",
          q4: "4. Vierteljahr"
        }
      }
    };
    USTVA_FLAGS = {
      corrected: ".AngabenZurVoranmeldung.Berichtigt",
      documents: ".AngabenZurVoranmeldung.Belege",
      offset_request: ".AngabenZurVoranmeldung.Verrech",
      revoke_sepa: ".AngabenZurVoranmeldung.Widerruf",
      additional_information: ".AngabenZurVoranmeldung.WeitereAngaben",
      manual_input: ".RahmenWerteUebersicht.ManuelleEingabe"
    };
    USTVA_VALUE_FIELDS = {
      taxable_19_base: {
        aid: ".RahmenWerteUebersicht.LieferungNorm.BetragEigen",
        page: "overview",
        manualOnly: true
      },
      taxable_7_base: {
        aid: ".RahmenWerteUebersicht.LieferungErm.BetragEigen",
        page: "overview",
        manualOnly: true
      },
      taxable_zero_base: {
        aid: ".RahmenWerteUebersicht.UStSatzNull.Wert",
        page: "overview",
        manualOnly: false
      },
      other_rates_base: {
        aid: ".RahmenWerteUebersicht.LieferungAnder.BetragEigen",
        page: "overview",
        manualOnly: true
      },
      other_rates_tax: {
        aid: ".RahmenWerteUebersicht.LieferungAnder.BetragUStEigen",
        page: "overview",
        manualOnly: true
      },
      reverse_charge_eu_base: {
        aid: ".Steuerschuldnerschaft13b.SonstigeLeistungEU.Betraege13bEigenAngaben.Wert",
        page: "reverse_charge",
        manualOnly: true
      },
      reverse_charge_eu_tax: {
        aid: ".Steuerschuldnerschaft13b.SonstigeLeistungEU.Betraege13bEigenAngaben.Wert2",
        page: "reverse_charge",
        manualOnly: true
      },
      reverse_charge_foreign_services_base: {
        aid: ".Steuerschuldnerschaft13b.SonstigeLeistungAuslUnternehmer.Betraege13bEigenAngaben.Wert",
        page: "reverse_charge",
        manualOnly: true
      },
      reverse_charge_foreign_services_tax: {
        aid: ".Steuerschuldnerschaft13b.SonstigeLeistungAuslUnternehmer.Betraege13bEigenAngaben.Wert2",
        page: "reverse_charge",
        manualOnly: true
      },
      input_tax_invoices: {
        aid: ".VoStManuell.SummeVoStAndere.BetragManuell",
        page: "input_tax",
        manualOnly: true
      },
      input_tax_reverse_charge: {
        aid: ".VoStManuell.VoStAuslandUndSumme.VoSt13b.BetragEigen",
        page: "input_tax",
        manualOnly: true
      },
      input_tax_import: {
        aid: ".VoStManuell.VoStAuslandUndSumme.EinfuhrUSt.BetragManuell",
        page: "input_tax",
        manualOnly: true
      },
      input_tax_adjustment: {
        aid: ".RahmenWerteUebersicht.VStBerichtigung.Wert",
        page: "overview",
        manualOnly: false
      },
      special_advance_payment: {
        aid: ".RahmenWerteUebersicht.SonderVZ.Wert",
        page: "overview",
        manualOnly: false
      },
      reduction_taxable_base: { aid: ".MinderungBMG.Wert", page: "overview", manualOnly: false },
      reduction_input_tax: { aid: ".MinderungVoSt.Wert", page: "overview", manualOnly: false }
    };
    USTVA_SECTIONS = {
      reverse_charge: {
        aid: ".RahmenWerteUebersicht.GrpAuslandsgeschaefte.Empf13b.Button",
        targetPage: USTVA_REVERSE_CHARGE_PAGE
      },
      input_tax: {
        aid: ".RahmenWerteUebersicht.VoSt.Button",
        targetPage: USTVA_INPUT_TAX_PAGE
      },
      small_business: {
        aid: ".RahmenKleinunternehmer.BesteuerungKleinU.Button",
        targetPage: "Themenfilter/Angaben zur Umsatzsteuer"
      },
      tax_exempt: {
        aid: ".RahmenSteuerfreiUndNichtSteuerbar.Stfr.Button",
        targetPage: "Steuerfreie Umsätze"
      },
      non_taxable: {
        aid: ".RahmenSteuerfreiUndNichtSteuerbar.NichtsteuerbareUmsaetze.Button",
        targetPage: "Meldepflichtige nicht steuerbare Umsätze"
      }
    };
  }
});

// src/ustva-executor.ts
function mutationEffects(taxDataChanged) {
  return { taxDataChanged, savePerformed: false, submissionPerformed: false };
}
function optionalWindow(args) {
  return {
    ...args.hwnd === void 0 ? {} : { hwnd: args.hwnd },
    ...args.pid === void 0 ? {} : { pid: args.pid }
  };
}
function caseBinding(args) {
  return {
    expectedCaseRef: args.expectedCaseRef,
    expectedCaseHash: args.expectedCaseHash
  };
}
async function readCurrentUstvaPage(args, step) {
  return normalizeUstvaCurrentPage(await step(
    "page",
    args.hwnd === void 0 ? {} : { hwnd: args.hwnd },
    MIN_USTVA_READ_MS
  ));
}
function requireOverview(page) {
  if (page.ok === false) return page;
  if (page.pageKind === "overview") return null;
  return {
    ok: false,
    kind: "ustva-page",
    error: `Die Operation braucht die UStVA-Uebersicht; aktuell ist '${String(page.page ?? "")}' offen.`
  };
}
function withUstvaMetadata(result, metadata, effects) {
  return result.ok === false ? result : { ...result, ustva: { ...metadata, effects } };
}
function isUstvaOperation(operation) {
  return USTVA_OPERATIONS.includes(operation);
}
async function executeUstvaOperation(operation, args, timeoutMs, signal, execute, options = {}) {
  const now = options.now ?? Date.now;
  const effectiveTimeoutMs = Math.max(
    0,
    Math.min(timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS, MAX_OPERATION_TIMEOUT_MS)
  );
  const deadline = now() + effectiveTimeoutMs;
  const step = async (nestedOperation, nestedArgs, minimumRemainingMs = MIN_USTVA_READ_MS) => {
    if (signal?.aborted) {
      return operationError(
        "API-Client hat die UStVA-Operation abgebrochen; Zustand vor Wiederholung lesen.",
        "aborted"
      );
    }
    const remainingMs = Math.floor(deadline - now());
    if (remainingMs < minimumRemainingMs) {
      return operationError(
        "Gesamtfrist der UStVA-Operation ist aufgebraucht; keine weitere UI-Aktion ausgefuehrt.",
        "timeout"
      );
    }
    return await execute(nestedOperation, nestedArgs, remainingMs, signal);
  };
  switch (operation) {
    case "ustva_read": {
      return readCurrentUstvaPage(args, step);
    }
    case "ustva_select_period": {
      const selector = String(args.selector);
      let expected;
      let requested;
      try {
        expected = mapUstvaPeriodValue(selector, String(args.expectedCurrent));
        requested = mapUstvaPeriodValue(selector, String(args.value));
      } catch (error) {
        throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
      }
      if (expected.aid !== requested.aid) {
        throw new ExecutorArgumentError("UStVA-Vorwert und Ziel gehoeren nicht zum selben Selektor.");
      }
      const page = await readCurrentUstvaPage(args, step);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await step("combo_select", {
        expectedPage: page.page,
        aid: requested.aid,
        expectedCurrent: expected.display,
        value: requested.display,
        expectedAfter: requested.display,
        ...optionalWindow(args),
        ...caseBinding(args)
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(result, {
        selector,
        before: args.expectedCurrent,
        selected: args.value
      }, mutationEffects(args.expectedCurrent !== args.value));
    }
    case "ustva_set_flag": {
      const flag = String(args.flag);
      const aid = USTVA_FLAGS[flag];
      if (!aid) throw new ExecutorArgumentError(`Unbekanntes UStVA-Flag: '${flag}'.`);
      const page = await readCurrentUstvaPage(args, step);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await step("toggle", {
        expectedPage: page.page,
        aid,
        expectedBefore: args.expectedBefore,
        value: args.value,
        expectedAfter: args.expectedAfter,
        ...optionalWindow(args),
        ...caseBinding(args)
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(result, { flag }, mutationEffects(args.expectedBefore !== args.expectedAfter));
    }
    case "ustva_change_value": {
      const field = String(args.field);
      const definition = USTVA_VALUE_FIELDS[field];
      if (!definition) throw new ExecutorArgumentError(`Unbekanntes UStVA-Wertfeld: '${field}'.`);
      if (definition.manualOnly && args.manualInputConfirmed !== true) {
        throw new ExecutorArgumentError(
          `UStVA-Feld '${field}' ist nur bei bewusst aktivierter manueller Erfassung erlaubt; manualInputConfirmed=true fehlt.`
        );
      }
      const page = await readCurrentUstvaPage(args, step);
      if (page.ok === false) return page;
      if (page.pageKind !== definition.page) {
        return {
          ok: false,
          kind: "ustva-page",
          error: `UStVA-Feld '${field}' braucht den Bereich '${definition.page}'; aktuell ist '${String(page.pageKind ?? page.page ?? "")}' offen.`,
          effects: mutationEffects(false)
        };
      }
      if (definition.manualOnly && definition.page === "overview") {
        const flags = page.flags;
        if (flags?.manual_input !== true) {
          return {
            ok: false,
            kind: "manual-input-disabled",
            error: "Das UStVA-Kennzeichen fuer manuelle Erfassung ist nicht nachweislich aktiv; keine Aenderung ausgefuehrt.",
            effects: mutationEffects(false)
          };
        }
      }
      const result = await step("tracked_set_value", {
        expectedPage: page.page,
        aid: definition.aid,
        expectedBefore: args.expectedBefore,
        value: args.value,
        expectedAfter: args.expectedAfter,
        trackResults: false,
        ...optionalWindow(args),
        ...caseBinding(args)
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(
        result,
        { field, manualOnly: definition.manualOnly },
        mutationEffects(args.expectedBefore !== args.expectedAfter)
      );
    }
    case "ustva_open_section": {
      const section = String(args.section);
      const definition = USTVA_SECTIONS[section];
      if (!definition) throw new ExecutorArgumentError(`Unbekannter UStVA-Bereich: '${section}'.`);
      const page = await readCurrentUstvaPage(args, step);
      const pageError = requireOverview(page);
      if (pageError) return pageError;
      const result = await step("click", {
        aid: definition.aid,
        expectedPageBefore: page.page,
        expectedPageAfter: definition.targetPage,
        waitMs: 3e3,
        ...args.hwnd === void 0 ? {} : { hwnd: args.hwnd }
      }, MIN_USTVA_FOLLOWUP_MS);
      return withUstvaMetadata(result, {
        section,
        targetPage: definition.targetPage
      }, mutationEffects(false));
    }
  }
}
var USTVA_OPERATIONS, MIN_USTVA_READ_MS, MIN_USTVA_FOLLOWUP_MS;
var init_ustva_executor = __esm({
  "src/ustva-executor.ts"() {
    "use strict";
    init_api_contract();
    init_executor_errors();
    init_ustva();
    USTVA_OPERATIONS = [
      "ustva_read",
      "ustva_select_period",
      "ustva_set_flag",
      "ustva_change_value",
      "ustva_open_section"
    ];
    MIN_USTVA_READ_MS = 200;
    MIN_USTVA_FOLLOWUP_MS = 2e3;
  }
});

// src/workspace.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import {
  existsSync as existsSync8,
  closeSync as closeSync2,
  fstatSync as fstatSync2,
  linkSync as linkSync2,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readSync as readSync2,
  readdirSync as readdirSync2,
  realpathSync as realpathSync3,
  statSync as statSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { dirname as dirname6, isAbsolute as isAbsolute5, relative as relative3, resolve as resolve10 } from "node:path";
import { performance as performance2 } from "node:perf_hooks";
function hash(buffer) {
  return createHash3("sha256").update(buffer).digest("hex");
}
function decodeUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Textdatei ist kein gueltiges UTF-8.");
  }
}
function* hashFile(path, bytes, budget) {
  if (bytes > MAX_LIST_HASH_BYTES) return null;
  const descriptor = openSync2(path, "r");
  const digest = createHash3("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    const opened = fstatSync2(descriptor);
    if (!opened.isFile() || opened.size !== bytes || opened.size > MAX_LIST_HASH_BYTES) return null;
    let total = 0;
    while (total < bytes) {
      const requested = Math.min(buffer.length, bytes - total, budget.remaining);
      if (requested <= 0) return null;
      const read = readSync2(descriptor, buffer, 0, requested, null);
      if (read <= 0) return null;
      total += read;
      budget.remaining -= read;
      digest.update(buffer.subarray(0, read));
      yield { kind: "hash-chunk" };
    }
    const after = fstatSync2(descriptor);
    if (!after.isFile() || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      return null;
    }
    return digest.digest("hex");
  } finally {
    closeSync2(descriptor);
  }
}
function inside2(root, candidate) {
  const rel = relative3(root, candidate);
  return rel === "" || !rel.startsWith("..") && !isAbsolute5(rel);
}
function resolveWorkspacePath(root, ref, createParent = false) {
  if (typeof ref !== "string" || !ref.trim() || ref.includes("\0") || isAbsolute5(ref) || /^[A-Za-z]:/.test(ref)) {
    throw new Error("Dateireferenz muss ein nicht leerer relativer Pfad sein.");
  }
  const realRoot = realpathSync3(root);
  const candidate = resolve10(realRoot, ref);
  if (!inside2(realRoot, candidate)) throw new Error("Dateireferenz verlaesst den konfigurierten Arbeitsbereich.");
  if (existsSync8(candidate)) {
    const realCandidate = realpathSync3(candidate);
    if (!inside2(realRoot, realCandidate)) throw new Error("Dateireferenz folgt einem Link ausserhalb des Arbeitsbereichs.");
    return realCandidate;
  }
  const parent = dirname6(candidate);
  if (createParent) {
    let ancestor = parent;
    while (!existsSync8(ancestor)) {
      const next = dirname6(ancestor);
      if (next === ancestor) throw new Error("Zielordner liegt ausserhalb des konfigurierten Arbeitsbereichs.");
      ancestor = next;
    }
    if (!inside2(realRoot, realpathSync3(ancestor))) {
      throw new Error("Zielordner liegt ausserhalb des konfigurierten Arbeitsbereichs.");
    }
    mkdirSync2(parent, { recursive: true });
  }
  if (!existsSync8(parent) || !inside2(realRoot, realpathSync3(parent))) {
    throw new Error("Zielordner liegt ausserhalb des konfigurierten Arbeitsbereichs.");
  }
  return candidate;
}
function validateWorkspaceTextWrite(root, ref) {
  const path = resolveWorkspacePath(root, ref, true);
  if (existsSync8(path)) {
    throw new Error("Textdatei existiert bereits; eine neue Dateireferenz verwenden.");
  }
}
function validateWorkspaceTextTarget(root, ref) {
  const path = resolveWorkspacePath(root, ref, true);
  if (!existsSync8(path)) return;
  const stats = statSync3(path);
  if (!stats.isFile()) throw new Error("Dateireferenz bezeichnet keine regulaere Datei.");
  if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
}
function ensureWorkspace(root) {
  mkdirSync2(root, { recursive: true });
}
function readWorkspaceText(root, ref) {
  const path = resolveWorkspacePath(root, ref);
  const stats = statSync3(path);
  if (!stats.isFile()) throw new Error("Dateireferenz bezeichnet keine regulaere Datei.");
  if (stats.size > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
  const buffer = readFileBounded(path, MAX_TEXT_FILE_BYTES);
  if (resolveWorkspacePath(root, ref) !== path) {
    throw new Error("Dateireferenz wurde waehrend des Lesens ausgetauscht.");
  }
  return { info: { ref, bytes: buffer.length, sha256: hash(buffer) }, text: decodeUtf8(buffer) };
}
function writeWorkspaceText(root, ref, text) {
  if (typeof text !== "string") throw new Error("'text' muss eine Zeichenkette sein.");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length > MAX_TEXT_FILE_BYTES) throw new Error(`Textdatei ist groesser als ${MAX_TEXT_FILE_BYTES} Bytes.`);
  validateWorkspaceTextWrite(root, ref);
  const path = resolveWorkspacePath(root, ref, true);
  const temporary = `${path}.tmp-${randomUUID2()}`;
  try {
    writeFileSync2(temporary, buffer, { flag: "wx" });
    linkSync2(temporary, path);
  } finally {
    if (existsSync8(temporary)) unlinkSync2(temporary);
  }
  return { ref, bytes: buffer.length, sha256: hash(buffer) };
}
function isVanishedPathError(error) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String(error.code);
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
function* walkWorkspaceFiles(root, ref, limit, includeHashes, maxDirectories, maxTotalHashBytes) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2e3) {
    throw new Error("Dateilimit muss eine ganze Zahl zwischen 1 und 2000 sein.");
  }
  if (!Number.isInteger(maxDirectories) || maxDirectories < 1 || maxDirectories > MAX_LIST_DIRECTORIES) {
    throw new Error(`Ordnerlimit muss eine ganze Zahl zwischen 1 und ${MAX_LIST_DIRECTORIES} sein.`);
  }
  if (!Number.isInteger(maxTotalHashBytes) || maxTotalHashBytes < 0 || maxTotalHashBytes > MAX_LIST_TOTAL_HASH_BYTES) {
    throw new Error(`Gesamthashlimit muss eine ganze Zahl zwischen 0 und ${MAX_LIST_TOTAL_HASH_BYTES} sein.`);
  }
  const start = ref === "." ? realpathSync3(root) : resolveWorkspacePath(root, ref);
  if (!statSync3(start).isDirectory()) throw new Error("Dateireferenz bezeichnet keinen Ordner.");
  const realRoot = realpathSync3(root);
  const pending = [start];
  const hashBudget = { remaining: maxTotalHashBytes };
  let visitedDirectories = 0;
  let emittedFiles = 0;
  while (pending.length > 0) {
    let current;
    try {
      current = realpathSync3(pending.pop());
    } catch (error) {
      if (!isVanishedPathError(error)) throw error;
      yield {};
      continue;
    }
    if (!inside2(realRoot, current)) {
      throw new Error("Dateiliste folgt einem ausgetauschten Ordner ausserhalb des Arbeitsbereichs.");
    }
    visitedDirectories += 1;
    if (visitedDirectories > maxDirectories) {
      throw new Error(`Dateiliste ueberschreitet das Ordnerlimit von ${maxDirectories}.`);
    }
    let entries;
    try {
      entries = readdirSync2(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "de"));
    } catch (error) {
      if (!isVanishedPathError(error)) throw error;
      yield {};
      continue;
    }
    yield {};
    for (const entry of entries) {
      try {
        const path = resolve10(current, entry.name);
        if (entry.isSymbolicLink()) {
          yield {};
          continue;
        }
        if (entry.isDirectory()) {
          const directory = realpathSync3(path);
          if (!inside2(realRoot, directory)) {
            throw new Error("Dateiliste folgt einem ausgetauschten Ordner ausserhalb des Arbeitsbereichs.");
          }
          pending.push(directory);
          yield {};
          continue;
        }
        if (!entry.isFile()) {
          yield {};
          continue;
        }
        const file = realpathSync3(path);
        if (!inside2(realRoot, file)) {
          throw new Error("Dateiliste folgt einer ausgetauschten Datei ausserhalb des Arbeitsbereichs.");
        }
        const bytes = statSync3(file).size;
        if (emittedFiles >= limit) {
          yield { truncated: true };
          return;
        }
        const mayHash = includeHashes && bytes <= hashBudget.remaining;
        const sha256 = mayHash ? yield* hashFile(file, bytes, hashBudget) : null;
        if (realpathSync3(path) !== file) {
          throw new Error("Dateireferenz wurde waehrend der Auflistung ausgetauscht.");
        }
        emittedFiles += 1;
        yield {
          file: {
            ref: relative3(realRoot, file).replaceAll("\\", "/"),
            bytes,
            sha256,
            ...sha256 === null ? { hashOmitted: true } : {}
          }
        };
      } catch (error) {
        if (!isVanishedPathError(error)) throw error;
        yield {};
      }
    }
  }
}
async function listWorkspaceFilesBounded(root, ref = ".", limit = 500, includeHashes = true, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("Zeitbudget fuer die Dateiliste muss eine nicht negative Zahl sein.");
  }
  const now = options.now ?? (() => performance2.now());
  const startedAt = now();
  const checkStopped = () => {
    if (options.signal?.aborted) {
      throw new WorkspaceListStoppedError("aborted", "API-Client hat die Workspace-Dateiliste abgebrochen.");
    }
    if (now() - startedAt >= timeoutMs) {
      throw new WorkspaceListStoppedError("timeout", "Zeitbudget der Workspace-Dateiliste ist aufgebraucht.");
    }
  };
  const files = [];
  let truncated = false;
  const maxTotalHashBytes = options.maxTotalHashBytes ?? MAX_LIST_TOTAL_HASH_BYTES;
  const walker = walkWorkspaceFiles(
    root,
    ref,
    limit,
    includeHashes,
    options.maxDirectories ?? MAX_LIST_DIRECTORIES,
    maxTotalHashBytes
  );
  try {
    while (true) {
      checkStopped();
      const next = walker.next();
      if (next.done) break;
      if (next.value.file) files.push(next.value.file);
      if (next.value.truncated) truncated = true;
      await options.afterWork?.(next.value.kind ?? "entry");
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      checkStopped();
    }
  } finally {
    walker.return(void 0);
  }
  return {
    files: files.sort((a, b) => a.ref.localeCompare(b.ref, "de")),
    truncated
  };
}
var MAX_TEXT_FILE_BYTES, MAX_LIST_HASH_BYTES, MAX_LIST_TOTAL_HASH_BYTES, MAX_LIST_DIRECTORIES, WorkspaceListStoppedError;
var init_workspace = __esm({
  "src/workspace.ts"() {
    "use strict";
    init_api_contract();
    init_bounded_files();
    MAX_TEXT_FILE_BYTES = MAX_WORKSPACE_TEXT_BYTES;
    MAX_LIST_HASH_BYTES = 16 * 1024 * 1024;
    MAX_LIST_TOTAL_HASH_BYTES = 64 * 1024 * 1024;
    MAX_LIST_DIRECTORIES = 5e3;
    WorkspaceListStoppedError = class extends Error {
      constructor(kind, message) {
        super(message);
        this.kind = kind;
      }
      kind;
      name = "WorkspaceListStoppedError";
    };
  }
});

// src/scenario.ts
import { isDeepStrictEqual } from "node:util";
import { createHash as createHash4 } from "node:crypto";
import { basename as basename4, dirname as dirname7, extname, join as join5 } from "node:path";
function requireAllowedScenarioOperations(groups, context) {
  for (const [phase, steps] of groups) {
    steps.forEach((step, index) => {
      if (!isSseApiOperation(step.operation) || SCENARIO_FORBIDDEN.has(step.operation)) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: [phase, index, "operation"],
          message: `Szenario-Operation '${step.operation}' ist nicht freigegeben.`
        });
      }
    });
  }
}
function requireUniqueStepIds(groups, context) {
  const seen = /* @__PURE__ */ new Set();
  for (const [phase, steps] of groups) {
    steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: [phase, index, "id"],
          message: `Schritt-ID '${step.id}' muss im gesamten Szenario eindeutig sein.`
        });
      }
      seen.add(step.id);
    });
  }
}
function requireSafeErrorContinuation(steps, context) {
  steps.forEach((step, index) => {
    if (step.continueOnError !== true) return;
    if (!CONTINUE_ON_ERROR_READ_ONLY.has(step.operation)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["steps", index, "continueOnError"],
        message: `continueOnError ist fuer die nicht rein lesende Operation '${step.operation}' gesperrt.`
      });
    }
    const laterMutation = steps.slice(index + 1).find((candidate) => !CONTINUE_ON_ERROR_READ_ONLY.has(candidate.operation));
    if (laterMutation) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["steps", index, "continueOnError"],
        message: `Nach continueOnError darf keine Hauptmutation wie '${laterMutation.operation}' folgen.`
      });
    }
  });
}
function locateValue(value, path) {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return { found: false };
    current = current[part];
  }
  return { found: true, value: current };
}
function valueAt(value, path) {
  return locateValue(value, path).value;
}
function summarizedValue(value, force = false) {
  let serialized;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    return { omitted: true, reason: "not-json-serializable" };
  }
  const bytes = Buffer.byteLength(serialized);
  if (!force && bytes <= MAX_CAPTURE_VALUE_BYTES) return value;
  return {
    omitted: true,
    bytes,
    sha256: createHash4("sha256").update(serialized).digest("hex")
  };
}
function capture(result, paths) {
  return Object.fromEntries(paths.map((path) => [path, summarizedValue(valueAt(result, path) ?? null)]));
}
function recordedError(error) {
  if (error.length <= MAX_RECORDED_ERROR_CHARS) return error;
  const sha256 = createHash4("sha256").update(error).digest("hex");
  return `${error.slice(0, MAX_RECORDED_ERROR_CHARS)}… [gekuerzt; sha256=${sha256}]`;
}
function compactStepRecord(record) {
  const compacted = { ...record };
  const omittedDetails = {};
  for (const field of ["values", "expectationFailures"]) {
    if (field in compacted) {
      omittedDetails[field] = summarizedValue(compacted[field], true);
      delete compacted[field];
    }
  }
  if (typeof compacted.error === "string") compacted.error = recordedError(compacted.error);
  return Object.keys(omittedDetails).length ? { ...compacted, omittedDetails } : compacted;
}
function compactScenarioReport(result, originalBytes) {
  return {
    ...result,
    reportCompacted: {
      originalBytes,
      reason: `Ausfuehrlicher Bericht ueberschritt ${MAX_TEXT_FILE_BYTES} Bytes.`
    },
    steps: Array.isArray(result.steps) ? result.steps.map((step) => compactStepRecord(step)) : [],
    ...Array.isArray(result.cleanup) ? { cleanup: result.cleanup.map((step) => compactStepRecord(step)) } : {}
  };
}
function same(left, right) {
  return isDeepStrictEqual(left, right);
}
function resolveStepReference(value, priorResults) {
  const match = STEP_REFERENCE.exec(value);
  if (!match) {
    throw new ScenarioReferenceError(
      `Ungueltige Schritt-Referenz '${value}'. Erwartet wird '$steps.<vorherige-id>.result.<pfad>'.`
    );
  }
  const stepId = match[1];
  const path = match[2];
  const result = priorResults.get(stepId);
  if (!result) {
    throw new ScenarioReferenceError(
      `Schritt-Referenz '${value}' verweist nicht auf einen bereits abgeschlossenen Schritt.`
    );
  }
  if (!path) return structuredClone(result);
  const parts = path.split(".");
  if (parts.some((part) => FORBIDDEN_REFERENCE_PARTS.has(part.toLowerCase()))) {
    throw new ScenarioReferenceError(`Schritt-Referenz '${value}' enthaelt einen gesperrten Eigenschaftsnamen.`);
  }
  const located = locateValue(result, path);
  if (!located.found || located.value === void 0) {
    throw new ScenarioReferenceError(`Schritt-Referenz '${value}' wurde im vorherigen Ergebnis nicht gefunden.`);
  }
  return structuredClone(located.value);
}
function resolveInput(value, workspaceDir, priorResults, allowStepReferences, operation, path) {
  if (allowStepReferences && typeof value === "string" && value.startsWith("$steps")) {
    return resolveStepReference(value, priorResults);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveInput(entry, workspaceDir, priorResults, allowStepReferences, operation, [...path, index]));
  }
  if (!value || typeof value !== "object") return value;
  const object = value;
  const keys = Object.keys(object);
  if (keys.length === 1 && typeof object.$text === "string") {
    return readWorkspaceText(workspaceDir, object.$text).text.trim();
  }
  if (keys.length === 1 && typeof object.$json === "string") {
    const parsed = JSON.parse(readWorkspaceText(workspaceDir, object.$json).text);
    assertApiArgumentBudget(operation, parsed, path);
    return resolveInput(parsed, workspaceDir, priorResults, allowStepReferences, operation, path);
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [
      key,
      resolveInput(entry, workspaceDir, priorResults, allowStepReferences, operation, [...path, key])
    ])
  );
}
function failedStep(step, kind, error) {
  return {
    record: { id: step.id, operation: step.operation, ok: false, values: {}, kind, error: recordedError(error) }
  };
}
async function executeScenarioStep(step, workspaceDir, priorResults, deadline, signal, execute, allowStepReferences, defaultTimeoutMs) {
  const remainingMs = deadline - Date.now();
  if (signal?.aborted || remainingMs < 200) {
    return failedStep(
      step,
      signal?.aborted ? "aborted" : "timeout",
      signal?.aborted ? "API-Client hat den Szenariolauf abgebrochen." : "Gesamtfrist des Szenarios ist abgelaufen."
    );
  }
  if (!isSseApiOperation(step.operation) || SCENARIO_FORBIDDEN.has(step.operation)) {
    return failedStep(step, "operation-not-allowed", `Szenario-Operation '${step.operation}' ist nicht freigegeben.`);
  }
  const operation = step.operation;
  let args;
  try {
    assertApiArgumentBudget(operation, step.args ?? {});
    args = resolveInput(
      step.args ?? {},
      workspaceDir,
      priorResults,
      allowStepReferences,
      operation,
      []
    );
    assertApiArgumentBudget(operation, args);
  } catch (error) {
    return failedStep(
      step,
      error instanceof ScenarioReferenceError ? "invalid-reference" : "invalid-input",
      error instanceof external_exports.ZodError ? formatOperationArgumentError(error) : error instanceof Error ? error.message : String(error)
    );
  }
  const stepTimeoutMs = Math.min(step.timeoutMs ?? defaultTimeoutMs ?? remainingMs, remainingMs);
  let result;
  try {
    result = await execute(operation, args, stepTimeoutMs, signal);
  } catch (error) {
    return failedStep(step, "execution-error", error instanceof Error ? error.message : String(error));
  }
  if (signal?.aborted || Date.now() > deadline) {
    const kind = signal?.aborted ? "aborted" : "timeout";
    const error = signal?.aborted ? "API-Client hat den Szenariolauf abgebrochen." : "Gesamtfrist des Szenarios ist abgelaufen.";
    return {
      result,
      record: {
        id: step.id,
        operation,
        ok: false,
        values: capture(result, step.capture ?? ["ok"]),
        kind,
        error
      }
    };
  }
  const expectationFailures = Object.entries(step.expect ?? {}).filter(([path, expected]) => !same(valueAt(result, path), expected)).map(([path, expected]) => ({
    path,
    expected: summarizedValue(expected),
    actual: summarizedValue(valueAt(result, path) ?? null)
  }));
  const ok = result.ok !== false && expectationFailures.length === 0;
  const values = capture(result, step.capture ?? ["ok"]);
  return {
    result,
    record: {
      id: step.id,
      operation,
      ok,
      values,
      ...expectationFailures.length ? { kind: "expectation-failed", expectationFailures } : {},
      ...!ok && !expectationFailures.length && typeof result.kind === "string" ? { kind: result.kind } : {},
      ...!ok && result.error ? { error: recordedError(String(result.error)) } : {}
    }
  };
}
function fallbackResultRef(requestedRef, sha256) {
  const extension = extname(requestedRef);
  const stem = basename4(requestedRef, extension);
  const fallbackName = `${stem}.conflict-${sha256}${extension || ".json"}`;
  const parent = dirname7(requestedRef);
  return (parent === "." ? fallbackName : join5(parent, fallbackName)).replaceAll("\\", "/");
}
async function runScenario(workspaceDir, resultDir, scenarioRef, resultRefOverride, totalTimeoutMs, signal, execute) {
  const source = readWorkspaceText(workspaceDir, scenarioRef);
  const scenario = scenarioSchema.parse(JSON.parse(source.text));
  const resultRef = resultRefOverride ?? scenario.resultFile;
  validateWorkspaceTextTarget(resultDir, resultRef);
  const steps = [];
  const cleanup = [];
  const priorResults = /* @__PURE__ */ new Map();
  let mainOk = true;
  const startedAt = Date.now();
  const totalBudgetMs = Math.min(totalTimeoutMs ?? 3e5, 3e5);
  const deadline = startedAt + totalBudgetMs;
  const cleanupSteps = scenario.schemaVersion === 2 ? scenario.finally : [];
  const requestedCleanupMs = Math.min(
    6e4,
    cleanupSteps.reduce((sum, step) => sum + (step.timeoutMs ?? 1e4), 0)
  );
  const cleanupReserveMs = Math.min(
    requestedCleanupMs,
    Math.floor(totalBudgetMs / 3),
    Math.max(0, totalBudgetMs - 200)
  );
  const mainDeadline = deadline - cleanupReserveMs;
  for (const step of scenario.steps) {
    const execution = await executeScenarioStep(
      step,
      workspaceDir,
      priorResults,
      mainDeadline,
      signal,
      execute,
      scenario.schemaVersion === 2
    );
    steps.push(execution.record);
    if (execution.result) priorResults.set(step.id, execution.result);
    if (execution.record.ok !== true) {
      mainOk = false;
      if (step.continueOnError !== true) break;
    }
  }
  mainOk = mainOk && steps.length === scenario.steps.length;
  for (let index = 0; index < cleanupSteps.length; index++) {
    const step = cleanupSteps[index];
    const remainingMs = deadline - Date.now();
    const remainingSteps = cleanupSteps.length - index;
    const defaultTimeoutMs = Math.max(200, Math.floor(remainingMs / remainingSteps));
    const execution = await executeScenarioStep(
      step,
      workspaceDir,
      priorResults,
      deadline,
      void 0,
      execute,
      true,
      defaultTimeoutMs
    );
    cleanup.push(execution.record);
    if (execution.result) priorResults.set(step.id, execution.result);
  }
  const cleanupOk = cleanup.length === cleanupSteps.length && cleanup.every((step) => step.ok === true);
  const stableResult = scenario.schemaVersion === 1 ? {
    schemaVersion: 1,
    scenario: scenario.name,
    ok: mainOk,
    steps
  } : {
    schemaVersion: 2,
    scenario: scenario.name,
    ok: mainOk && cleanupOk,
    mainOk,
    cleanupOk,
    status: mainOk && cleanupOk ? "ok" : !mainOk && !cleanupOk ? "main-and-cleanup-failed" : !mainOk ? "main-failed" : "cleanup-failed",
    steps,
    cleanup
  };
  let finalResult = stableResult;
  let json = `${JSON.stringify(finalResult, null, 2)}
`;
  const originalReportBytes = Buffer.byteLength(json);
  if (originalReportBytes > MAX_TEXT_FILE_BYTES) {
    finalResult = compactScenarioReport(finalResult, originalReportBytes);
    json = `${JSON.stringify(finalResult, null, 2)}
`;
  }
  let actualResultRef = resultRef;
  let info;
  let resultWriteConflict = false;
  try {
    info = writeWorkspaceText(resultDir, resultRef, json);
  } catch {
    const existing = (() => {
      try {
        return readWorkspaceText(resultDir, resultRef);
      } catch {
        return void 0;
      }
    })();
    if (existing?.text === json) {
      info = existing.info;
    } else {
      resultWriteConflict = true;
      finalResult = {
        ...stableResult,
        resultWriteConflict: { requestedRef: resultRef }
      };
      json = `${JSON.stringify(finalResult, null, 2)}
`;
      const jsonSha256 = createHash4("sha256").update(json).digest("hex");
      actualResultRef = fallbackResultRef(resultRef, jsonSha256);
      try {
        info = writeWorkspaceText(resultDir, actualResultRef, json);
      } catch (fallbackError) {
        let fallbackExisting;
        try {
          fallbackExisting = readWorkspaceText(resultDir, actualResultRef);
        } catch {
          throw fallbackError;
        }
        if (fallbackExisting.info.sha256 !== jsonSha256 || fallbackExisting.text !== json) throw fallbackError;
        info = fallbackExisting.info;
      }
    }
  }
  const firstFailedRecord = [...steps, ...cleanup].find((record) => record.ok !== true);
  const failureError = firstFailedRecord ? `Szenario '${scenario.name}' scheiterte in Schritt '${String(firstFailedRecord.id)}'` + (typeof firstFailedRecord.error === "string" ? `: ${firstFailedRecord.error}` : ".") : `Szenario '${scenario.name}' wurde nicht erfolgreich abgeschlossen.`;
  return {
    ok: finalResult.ok,
    ...!finalResult.ok ? { kind: "scenario-failed", error: recordedError(failureError) } : {},
    scenario: scenario.name,
    scenarioRef,
    resultRef: actualResultRef,
    ...resultWriteConflict ? { requestedResultRef: resultRef, resultWriteConflict: true } : {},
    sha256: info.sha256,
    bytes: info.bytes,
    result: finalResult
  };
}
var scenarioStepSchema, CONTINUE_ON_ERROR_READ_ONLY, SCENARIO_FORBIDDEN, FINALLY_CLEANUP_OPERATIONS, scenarioV1Schema, scenarioV2Schema, scenarioSchema, MAX_CAPTURE_VALUE_BYTES, MAX_RECORDED_ERROR_CHARS, ScenarioReferenceError, STEP_REFERENCE, FORBIDDEN_REFERENCE_PARTS;
var init_scenario = __esm({
  "src/scenario.ts"() {
    "use strict";
    init_zod();
    init_api_contract();
    init_workspace();
    init_operation_traits();
    init_operation_catalog();
    scenarioStepSchema = external_exports.object({
      id: external_exports.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i),
      operation: external_exports.string().min(1),
      args: external_exports.record(external_exports.unknown()).optional(),
      timeoutMs: external_exports.number().int().min(200).max(3e5).optional(),
      capture: external_exports.array(external_exports.string().min(1).max(128)).min(1).max(20).optional(),
      expect: external_exports.record(external_exports.unknown()).optional(),
      continueOnError: external_exports.boolean().optional()
    }).strict().superRefine((step, context) => {
      const expectationPaths = Object.keys(step.expect ?? {});
      if (expectationPaths.length > 20) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["expect"],
          message: "Ein Szenarioschritt darf hoechstens 20 Erwartungen enthalten."
        });
      }
      const longPath = expectationPaths.find((path) => path.length > 128);
      if (longPath) {
        context.addIssue({
          code: external_exports.ZodIssueCode.custom,
          path: ["expect", longPath],
          message: "Erwartungspfade duerfen hoechstens 128 Zeichen lang sein."
        });
      }
      const budgetOperation = isSseApiOperation(step.operation) ? step.operation : "health";
      for (const [field, value] of [["args", step.args], ["expect", step.expect]]) {
        if (value === void 0) continue;
        try {
          assertApiArgumentBudget(budgetOperation, value, [field]);
        } catch (error) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: [field],
            message: error instanceof external_exports.ZodError ? formatOperationArgumentError(error) : String(error)
          });
        }
      }
    });
    CONTINUE_ON_ERROR_READ_ONLY = new Set(SSE_READ_ONLY_OPERATIONS);
    SCENARIO_FORBIDDEN = /* @__PURE__ */ new Set(["scenario_run", "workspace_file_write_text"]);
    FINALLY_CLEANUP_OPERATIONS = /* @__PURE__ */ new Set([
      ...CONTINUE_ON_ERROR_READ_ONLY,
      ...SSE_CLEANUP_OPERATIONS
    ]);
    scenarioV1Schema = external_exports.object({
      schemaVersion: external_exports.literal(1),
      name: external_exports.string().min(1).max(200),
      resultFile: external_exports.string().min(1).max(260),
      steps: external_exports.array(scenarioStepSchema).min(1).max(100)
    }).strict().superRefine((scenario, context) => {
      requireUniqueStepIds([["steps", scenario.steps]], context);
      requireAllowedScenarioOperations([["steps", scenario.steps]], context);
      requireSafeErrorContinuation(scenario.steps, context);
    });
    scenarioV2Schema = external_exports.object({
      schemaVersion: external_exports.literal(2),
      name: external_exports.string().min(1).max(200),
      resultFile: external_exports.string().min(1).max(260),
      steps: external_exports.array(scenarioStepSchema).min(1).max(100),
      finally: external_exports.array(scenarioStepSchema).min(1).max(20)
    }).strict().superRefine((scenario, context) => {
      requireUniqueStepIds([["steps", scenario.steps], ["finally", scenario.finally]], context);
      requireAllowedScenarioOperations([["steps", scenario.steps], ["finally", scenario.finally]], context);
      requireSafeErrorContinuation(scenario.steps, context);
      scenario.finally.forEach((step, index) => {
        if (step.continueOnError === true) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: ["finally", index, "continueOnError"],
            message: "finally fuehrt ohnehin jeden Cleanup-Schritt aus; continueOnError ist dort ungueltig."
          });
        }
        if (!FINALLY_CLEANUP_OPERATIONS.has(step.operation)) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: ["finally", index, "operation"],
            message: `finally erlaubt nur Read-only- oder Cleanup-Operationen; '${step.operation}' ist gesperrt.`
          });
        }
      });
    });
    scenarioSchema = external_exports.union([scenarioV1Schema, scenarioV2Schema]);
    MAX_CAPTURE_VALUE_BYTES = 16 * 1024;
    MAX_RECORDED_ERROR_CHARS = 4096;
    ScenarioReferenceError = class extends Error {
    };
    STEP_REFERENCE = /^\$steps\.([a-z0-9][a-z0-9_-]*)\.result(?:\.([a-z0-9_-]+(?:\.[a-z0-9_-]+)*))?$/i;
    FORBIDDEN_REFERENCE_PARTS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  }
});

// src/workspace-executor.ts
import { performance as performance3 } from "node:perf_hooks";
function isWorkspaceExecutorOperation(operation) {
  return WORKSPACE_EXECUTOR_OPERATIONS.includes(operation);
}
function resourceArgument(roots, ref, area, defaultArea, allowedAreas) {
  if (ref.includes(":")) {
    if (area !== void 0) {
      throw new ExecutorArgumentError("'area' darf nicht zusammen mit einer vollstaendigen Ressourcenreferenz stehen.");
    }
    return resolveResourceReference(roots, ref, allowedAreas);
  }
  const selectedArea = area === void 0 ? defaultArea : String(area);
  if (!allowedAreas.includes(selectedArea)) {
    throw new ExecutorArgumentError(`Ressourcenbereich '${selectedArea}' ist fuer diesen Aufruf nicht erlaubt.`);
  }
  return resolveResourceReference(roots, formatResourceReference(selectedArea, ref), allowedAreas);
}
async function executeWorkspaceOperation(operation, args, context) {
  const { roots, workspaceDir, resultDir, timeoutMs, signal, execute, redactPaths } = context;
  const now = context.now ?? (() => performance3.now());
  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const startedAt = now();
  const stopped = (activity) => {
    if (signal?.aborted) return operationError(`API-Client hat ${activity} abgebrochen.`, "aborted");
    if (now() - startedAt >= effectiveTimeoutMs) {
      return operationError(`Zeitbudget fuer ${activity} ist aufgebraucht.`, "timeout");
    }
    return void 0;
  };
  switch (operation) {
    case "workspace_file_list": {
      const ref = typeof args.ref === "string" ? args.ref : "workspace:.";
      const limit = args.limit === void 0 ? 500 : Number(args.limit);
      const beforeList = stopped("die Workspace-Dateiliste");
      if (beforeList) return redactPaths(beforeList);
      const resource = resourceArgument(roots, ref, args.area, "workspace", [
        "cases",
        "documents",
        "workspace",
        "results",
        "backups"
      ]);
      const remainingTimeoutMs2 = Math.max(0, effectiveTimeoutMs - (now() - startedAt));
      const listing = await listWorkspaceFilesBounded(
        resource.root,
        resource.relativePath,
        limit,
        args.includeHashes !== false,
        { timeoutMs: remainingTimeoutMs2, ...signal ? { signal } : {} }
      );
      return redactPaths({
        ok: true,
        ref: resource.ref,
        files: listing.files.map((file) => ({
          ...file,
          ref: formatResourceReference(resource.area, file.ref)
        })),
        truncated: listing.truncated
      });
    }
    case "workspace_file_read_text": {
      const beforeRead = stopped("das Lesen der Workspace-Textdatei");
      if (beforeRead) return redactPaths(beforeRead);
      const resource = resourceArgument(roots, String(args.ref), args.area, "workspace", [
        "cases",
        "documents",
        "workspace",
        "results",
        "backups"
      ]);
      const file = readWorkspaceText(resource.root, resource.relativePath);
      const afterRead = stopped("das Lesen der Workspace-Textdatei");
      if (afterRead) return redactPaths(afterRead);
      return { ...redactPaths({ ok: true, ...file.info, ref: resource.ref }), text: file.text };
    }
    case "workspace_file_write_text": {
      const beforeWrite = stopped("das Schreiben der Workspace-Textdatei");
      if (beforeWrite) return redactPaths(beforeWrite);
      const resource = resourceArgument(roots, String(args.ref), args.area, "workspace", ["workspace", "results"]);
      assertResourceWriteBoundary(roots, resource);
      const info = writeWorkspaceText(resource.root, resource.relativePath, String(args.text));
      return redactPaths({ ok: true, ...info, ref: resource.ref });
    }
    case "scenario_run": {
      const scenarioResource = resourceArgument(roots, String(args.scenarioRef), void 0, "workspace", ["workspace"]);
      const resultResource = typeof args.resultRef === "string" ? resourceArgument(roots, args.resultRef, void 0, "results", ["results"]) : void 0;
      const scenarioResult = await runScenario(
        workspaceDir,
        resultDir,
        scenarioResource.relativePath,
        resultResource?.relativePath,
        timeoutMs,
        signal,
        execute
      );
      const stableResultRef = resultResource?.ref ?? (typeof scenarioResult.resultRef === "string" ? formatResourceReference("results", scenarioResult.resultRef) : void 0);
      return redactPaths({
        ...scenarioResult,
        scenarioRef: scenarioResource.ref,
        ...stableResultRef ? { resultRef: stableResultRef } : {}
      });
    }
  }
}
var WORKSPACE_EXECUTOR_OPERATIONS;
var init_workspace_executor = __esm({
  "src/workspace-executor.ts"() {
    "use strict";
    init_api_contract();
    init_executor_errors();
    init_resources();
    init_scenario();
    init_workspace();
    WORKSPACE_EXECUTOR_OPERATIONS = [
      "workspace_file_list",
      "workspace_file_read_text",
      "workspace_file_write_text",
      "scenario_run"
    ];
  }
});

// src/configuration-fingerprint.ts
import { createHash as createHash5 } from "node:crypto";
import { resolve as resolve11 } from "node:path";
function optionalResolved(path) {
  return path ? resolve11(path) : null;
}
function configurationFingerprint(config) {
  const stable = {
    profileId: config.profileId,
    caseDir: optionalResolved(config.caseDir),
    documentsDir: resolve11(config.documentsDir),
    workspaceDir: resolve11(config.workspaceDir),
    resultDir: resolve11(config.resultDir),
    backupsDir: resolve11(config.backupsDir),
    sseExecutable: optionalResolved(config.sseExecutable),
    operateExperimental: config.operateExperimental === true
  };
  return createHash5("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}
var init_configuration_fingerprint = __esm({
  "src/configuration-fingerprint.ts"() {
    "use strict";
  }
});

// src/workspace-status.ts
import { accessSync, constants, statSync as statSync4 } from "node:fs";
function directoryReady(path) {
  try {
    if (!statSync4(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function readWorkspaceStatus(config) {
  return {
    ok: true,
    profileId: config.profileId,
    configurationFingerprint: configurationFingerprint(config),
    workspaceReady: directoryReady(config.workspaceDir),
    resultAreaReady: directoryReady(config.resultDir),
    caseDirectoryConfigured: Boolean(config.caseDir),
    caseDirectoryReady: config.caseDir ? directoryReady(config.caseDir) : false,
    documentAreaReady: directoryReady(config.documentsDir),
    backupAreaReady: directoryReady(config.backupsDir),
    sseExecutableConfigured: Boolean(config.sseExecutable)
  };
}
var init_workspace_status = __esm({
  "src/workspace-status.ts"() {
    "use strict";
    init_configuration_fingerprint();
    init_configuration_fingerprint();
  }
});

// src/collect-verification.ts
function objectValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function dotNetWhitespace(character) {
  return character === "" || character !== "\uFEFF" && /^\s$/u.test(character);
}
function trimDotNet(value) {
  let start = 0;
  let end = value.length;
  while (start < end && dotNetWhitespace(value[start])) start += 1;
  while (end > start && dotNetWhitespace(value[end - 1])) end -= 1;
  return value.slice(start, end);
}
function removeDotNetWhitespace(value) {
  return [...value].filter((character) => !dotNetWhitespace(character)).join("");
}
function foldLocalOrdinal(value) {
  let folded = "";
  for (const character of value) {
    if (character >= "A" && character <= "Z") {
      folded += character.toLowerCase();
    } else if (character >= "a" && character <= "z") {
      folded += character;
    } else if (character === "Ä") {
      folded += "ä";
    } else if (character === "ä") {
      folded += character;
    } else if (character === "Ö") {
      folded += "ö";
    } else if (character === "ö") {
      folded += character;
    } else if (character === "Ü") {
      folded += "ü";
    } else if (character === "ü") {
      folded += character;
    } else if (character === "ß") {
      folded += character;
    } else if (character.toLowerCase() !== character || character.toUpperCase() !== character) {
      return void 0;
    } else {
      folded += character;
    }
  }
  return folded;
}
function foldLocalValue(value) {
  let folded = "";
  for (const character of value) {
    if (character >= "a" && character <= "z") {
      folded += character.toUpperCase();
    } else if (character >= "A" && character <= "Z") {
      folded += character;
    } else if (character === "ä" || character === "Ä") {
      folded += "Ä";
    } else if (character === "ö" || character === "Ö") {
      folded += "Ö";
    } else if (character === "ü" || character === "Ü") {
      folded += "Ü";
    } else if (character === "ß") {
      folded += "SS";
    } else if (new RegExp("^\\p{Cf}$", "u").test(character)) {
      return void 0;
    } else if (character.toLowerCase() !== character || character.toUpperCase() !== character) {
      return void 0;
    } else {
      folded += character;
    }
  }
  return folded;
}
function decimalFromNormalized(value) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "", fraction = ""] = unsigned.split(".", 2);
  let scale = fraction.length;
  let coefficient = BigInt(`${integer}${fraction}` || "0");
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (scale > 28 || coefficient > DOTNET_DECIMAL_MAX) return "worker-fallback";
  return { coefficient: negative ? -coefficient : coefficient, scale };
}
function parseTableNumber(value) {
  let text = trimDotNet(value);
  text = text.replace(/^(?:€|EUR)\s*/iu, "");
  text = text.replace(/\s*(?:€|EUR|%)$/iu, "");
  text = removeDotNetWhitespace(text);
  if (!text) return null;
  let normalized;
  if (/^-?[0-9]+$/u.test(text)) {
    normalized = text;
  } else if (/^-?(?:[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+),[0-9]+$/u.test(text)) {
    normalized = text.replaceAll(".", "").replace(",", ".");
  } else if (/^-?[0-9]+\.[0-9]+$/u.test(text)) {
    const fraction = text.replace(/^-/, "").split(".", 2)[1] ?? "";
    normalized = fraction.length === 3 ? text.replace(".", "") : text;
  } else if (/^-?[0-9]{1,3}(?:\.[0-9]{3}){2,}$/u.test(text)) {
    normalized = text.replaceAll(".", "");
  } else {
    return null;
  }
  return decimalFromNormalized(normalized);
}
function decimalEqual(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return left.coefficient * POWERS_OF_TEN[scale - left.scale] === right.coefficient * POWERS_OF_TEN[scale - right.scale];
}
function roundedDifference(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const difference = left.coefficient * POWERS_OF_TEN[scale - left.scale] - right.coefficient * POWERS_OF_TEN[scale - right.scale];
  let cents2;
  if (scale <= 2) {
    cents2 = difference * POWERS_OF_TEN[2 - scale];
  } else {
    const divisor = POWERS_OF_TEN[scale - 2];
    const absolute = difference < 0n ? -difference : difference;
    let rounded = absolute / divisor;
    const remainder = absolute % divisor;
    if (remainder * 2n > divisor || remainder * 2n === divisor && rounded % 2n !== 0n) rounded += 1n;
    cents2 = difference < 0n ? -rounded : rounded;
  }
  if (cents2 > BigInt(Number.MAX_SAFE_INTEGER) || cents2 < BigInt(Number.MIN_SAFE_INTEGER)) {
    return "worker-fallback";
  }
  return Number(cents2) / 100;
}
function resolveMatch(items, property, needle, occurrence) {
  const foldedNeedle = foldLocalOrdinal(needle);
  if (foldedNeedle === void 0) return "worker-fallback";
  const prepared = [];
  for (const candidate of items) {
    const item = objectValue(candidate);
    if (!item || typeof item[property] !== "string") return "worker-fallback";
    const value = item[property];
    const folded = foldLocalOrdinal(value);
    if (folded === void 0) return "worker-fallback";
    prepared.push({ item, value, folded });
  }
  const exact = prepared.filter((candidate) => candidate.folded === foldedNeedle);
  const matches = exact.length > 0 ? exact : prepared.filter((candidate) => candidate.folded.includes(foldedNeedle));
  const mode = exact.length > 0 ? "exact" : "substring";
  const candidates = matches.map((candidate) => candidate.value);
  if (matches.length === 0) {
    return { ok: false, kind: "missing", mode, count: 0, item: null, candidates };
  }
  if (occurrence !== void 0) {
    if (occurrence < 1 || occurrence > matches.length) {
      return { ok: false, kind: "occurrence-out-of-range", mode, count: matches.length, item: null, candidates };
    }
    return {
      ok: true,
      kind: "matched",
      mode: `${mode}-occurrence`,
      count: matches.length,
      item: matches[occurrence - 1].item,
      candidates
    };
  }
  if (matches.length !== 1) {
    return { ok: false, kind: "ambiguous", mode, count: matches.length, item: null, candidates };
  }
  return { ok: true, kind: "matched", mode, count: 1, item: matches[0].item, candidates };
}
function compareValues(actual, expected) {
  const actualNumber = parseTableNumber(actual);
  const expectedNumber = parseTableNumber(expected);
  if (actualNumber === "worker-fallback" || expectedNumber === "worker-fallback") return "worker-fallback";
  if (actualNumber !== null && expectedNumber !== null) {
    const difference = roundedDifference(actualNumber, expectedNumber);
    if (difference === "worker-fallback") return "worker-fallback";
    return { equal: decimalEqual(actualNumber, expectedNumber), difference };
  }
  const actualText = foldLocalValue(trimDotNet(actual));
  const expectedText = foldLocalValue(trimDotNet(expected));
  if (actualText === void 0 || expectedText === void 0) return "worker-fallback";
  return { equal: actualText === expectedText, difference: null };
}
function failureStatus(kind, target) {
  if (kind === "missing") return target === "page" ? "Seite fehlt" : "Feld fehlt";
  if (kind === "ambiguous") return target === "page" ? "Seite mehrdeutig" : "Feld mehrdeutig";
  return target === "page" ? "Seiten-Occurrence ungueltig" : "Feld-Occurrence ungueltig";
}
function compareCollectExpectations(source, expectations, allowIncompleteSource, sourceHash) {
  const document = objectValue(source);
  if (!document || !Array.isArray(document.seiten)) {
    return { kind: "result", result: { ok: false, kind: "invalid-source", error: "Collect-JSON enthaelt keine Seitenliste." } };
  }
  const pages = document.seiten;
  if (pages.length === 0) {
    return { kind: "result", result: { ok: false, kind: "invalid-source", error: "Collect-JSON enthaelt keine Seiten." } };
  }
  const sourceComplete = typeof document.vollstaendig === "boolean" ? document.vollstaendig : null;
  const sourceStopKind = document.stopKind ?? null;
  const sourceStopReason = document.stopReason ?? null;
  if (sourceComplete !== true && !allowIncompleteSource) {
    return {
      kind: "result",
      result: {
        ok: false,
        kind: "verification-source-incomplete",
        error: "Collect-JSON ist unvollstaendig oder stammt aus einem alten Format ohne Vollstaendigkeitsnachweis. Nur mit allowIncompleteSource=true ist ein klar begrenzter Teilstandsabgleich erlaubt.",
        sourceHash,
        sourceVollstaendig: sourceComplete,
        sourceStopKind,
        sourceStopReason,
        seiten: pages.length
      }
    };
  }
  const results = [];
  for (const rawExpectation of expectations) {
    const expectation = objectValue(rawExpectation);
    if (!expectation || typeof expectation.seite !== "string" || typeof expectation.label !== "string" || typeof expectation.wert !== "string") {
      return { kind: "worker-fallback" };
    }
    const requestedPage = expectation.seite;
    const requestedLabel = expectation.label;
    const expectedValue = expectation.wert;
    if (!trimDotNet(requestedPage) || !trimDotNet(requestedLabel)) {
      results.push({
        seite: requestedPage,
        label: requestedLabel,
        soll: expectedValue,
        ist: null,
        status: "Ungueltige Erwartung"
      });
      continue;
    }
    const pageMatch = resolveMatch(
      pages,
      "ueberschrift",
      requestedPage,
      typeof expectation.seiteOccurrence === "number" ? expectation.seiteOccurrence : void 0
    );
    if (pageMatch === "worker-fallback") return { kind: "worker-fallback" };
    if (!pageMatch.ok) {
      results.push({
        seite: requestedPage,
        label: requestedLabel,
        soll: expectedValue,
        ist: null,
        status: failureStatus(pageMatch.kind, "page"),
        matchMode: pageMatch.mode,
        treffer: pageMatch.count,
        kandidaten: pageMatch.candidates
      });
      continue;
    }
    const page = pageMatch.item;
    if (!Array.isArray(page.felder) || typeof page.ueberschrift !== "string") return { kind: "worker-fallback" };
    const fieldMatch = resolveMatch(
      page.felder,
      "label",
      requestedLabel,
      typeof expectation.labelOccurrence === "number" ? expectation.labelOccurrence : void 0
    );
    if (fieldMatch === "worker-fallback") return { kind: "worker-fallback" };
    if (!fieldMatch.ok) {
      results.push({
        seite: page.ueberschrift,
        label: requestedLabel,
        soll: expectedValue,
        ist: null,
        status: failureStatus(fieldMatch.kind, "field"),
        pageMatchMode: pageMatch.mode,
        matchMode: fieldMatch.mode,
        treffer: fieldMatch.count,
        kandidaten: fieldMatch.candidates
      });
      continue;
    }
    const field = fieldMatch.item;
    if (typeof field.label !== "string" || typeof field.wert !== "string") return { kind: "worker-fallback" };
    const comparison = compareValues(field.wert, expectedValue);
    if (comparison === "worker-fallback") return { kind: "worker-fallback" };
    results.push({
      seite: page.ueberschrift,
      label: field.label,
      soll: expectedValue,
      ist: field.wert,
      differenz: comparison.difference,
      pageMatchMode: pageMatch.mode,
      matchMode: fieldMatch.mode,
      status: comparison.equal ? "stimmt" : "ABWEICHUNG"
    });
  }
  const deviations = results.filter((result) => result.status !== "stimmt").length;
  return {
    kind: "result",
    result: {
      ok: true,
      vergleichOk: deviations === 0,
      sourceHash,
      sourceVollstaendig: sourceComplete,
      sourceStopKind,
      sourceStopReason,
      geprueft: results.length,
      abweichungen: deviations,
      ergebnis: results,
      zusammenfassung: deviations > 0 ? `${deviations} von ${results.length} Erwartungen weichen ab oder sind nicht eindeutig zugeordnet.` : sourceComplete === true ? `Alle ${results.length} Erwartungen stimmen im vollstaendigen Collect-Stand.` : `Alle ${results.length} Erwartungen stimmen im bewusst unvollstaendigen Teilstand; keine Gesamtaussage zur Erklaerung.`
    }
  };
}
var DOTNET_DECIMAL_MAX, POWERS_OF_TEN;
var init_collect_verification = __esm({
  "src/collect-verification.ts"() {
    "use strict";
    DOTNET_DECIMAL_MAX = 79228162514264337593543950335n;
    POWERS_OF_TEN = Array.from({ length: 29 }, (_, exponent) => 10n ** BigInt(exponent));
  }
});

// src/verify-executor.ts
import { createHash as createHash6 } from "node:crypto";
import { open as open2, stat as stat2 } from "node:fs/promises";
import { extname as extname2 } from "node:path";
import { performance as performance4 } from "node:perf_hooks";
async function readStableJsonFile(path, signal, includeBytes) {
  if (signal.aborted) throw abortError();
  const opening = open2(path, "r");
  const handle = await abortable(opening, signal, (lateHandle) => lateHandle.close().catch(() => void 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new VerifyFileError("from muss eine existierende .json-Datei sein.", "bad-args");
    if (before.size > BigInt(MAX_JSON_FILE_BYTES)) {
      throw new VerifyFileError(`Collect-JSON ist nicht lesbar: Datei ist groesser als ${MAX_JSON_FILE_BYTES} Bytes.`, "invalid-source");
    }
    const chunks = [];
    const digest = createHash6("sha256");
    let total = 0;
    const stream = handle.createReadStream({ autoClose: false, signal });
    stream.on("error", () => void 0);
    for await (const entry of stream) {
      const chunk = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
      total += chunk.length;
      if (total > MAX_JSON_FILE_BYTES) {
        throw new VerifyFileError(`Collect-JSON ist nicht lesbar: Datei ist groesser als ${MAX_JSON_FILE_BYTES} Bytes.`, "invalid-source");
      }
      if (includeBytes) chunks.push(chunk);
      digest.update(chunk);
    }
    const afterHandle = await handle.stat({ bigint: true });
    let afterPath;
    try {
      afterPath = await stat2(path, { bigint: true });
    } catch {
      throw new VerifyFileError("Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.", "verification-source-changed");
    }
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      throw new VerifyFileError("Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.", "verification-source-changed");
    }
    return {
      bytes: includeBytes ? Buffer.concat(chunks, total) : void 0,
      hash: digest.digest("hex").toUpperCase(),
      state: before
    };
  } finally {
    await handle.close().catch(() => void 0);
  }
}
function withResourceIdentity(result, resourceRefs) {
  return Object.keys(resourceRefs).length ? { ...result, resourceRefs } : result;
}
async function executeLocalVerify(options) {
  const effectiveTimeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const localStartedAt = performance4.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, effectiveTimeoutMs));
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const stopped = () => {
    if (options.signal?.aborted) return operationError("API-Client hat die Collect-Verifikation abgebrochen.", "aborted");
    if (timedOut || performance4.now() - localStartedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Pruefen des Collect-Stands aufgebraucht.", "timeout");
    }
    return void 0;
  };
  const localResult = (result) => {
    const beforeRedaction = stopped();
    const redacted = options.redactPaths(withResourceIdentity(beforeRedaction ?? result, options.resourceRefs));
    const afterRedaction = stopped();
    return {
      kind: "result",
      result: afterRedaction ? options.redactPaths(withResourceIdentity(afterRedaction, options.resourceRefs)) : redacted
    };
  };
  try {
    const path = options.args.from;
    const expectedHash = options.args.expectedSourceHash;
    const expectations = options.args.erwartungen;
    if (typeof path !== "string" || extname2(path).toLowerCase() !== ".json") {
      return localResult(operationError("from muss eine existierende .json-Datei sein.", "bad-args"));
    }
    if (typeof expectedHash !== "string" || !/^[A-Fa-f0-9]{64}$/u.test(expectedHash) || !Array.isArray(expectations)) {
      return localResult(operationError("Ungueltige Verify-Argumente.", "bad-args"));
    }
    const beforeRead = stopped();
    if (beforeRead) return localResult(beforeRead);
    const sourceBefore = await readStableJsonFile(path, controller.signal, true);
    const normalizedExpectedHash = expectedHash.toUpperCase();
    if (sourceBefore.hash !== normalizedExpectedHash) {
      return localResult(operationError(
        `Quellstand hat SHA256 ${sourceBefore.hash} statt ${normalizedExpectedHash}; nicht geprueft.`,
        "precondition-failed"
      ));
    }
    let document;
    try {
      const sourceBytes = sourceBefore.bytes;
      if (sourceBytes.length >= 3 && sourceBytes[0] === 239 && sourceBytes[1] === 187 && sourceBytes[2] === 191) {
        return localResult(operationError("Collect-JSON ist nicht lesbar: UTF-8-BOM ist nicht erlaubt.", "invalid-source"));
      }
      document = parseJsonBytesStrict(sourceBytes, "Collect-JSON");
      sourceBefore.bytes = void 0;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return localResult(operationError(`Collect-JSON ist nicht lesbar: ${detail}`, "invalid-source"));
    }
    await options.afterSourceRead?.();
    const sourceAfter = await readStableJsonFile(path, controller.signal, false);
    if (sourceAfter.hash !== sourceBefore.hash || !sameFileState(sourceBefore.state, sourceAfter.state)) {
      return localResult({
        ok: false,
        kind: "verification-source-changed",
        error: "Collect-JSON wurde waehrend des Lesens geaendert; kein Vergleich ausgefuehrt.",
        sourceHashBefore: sourceBefore.hash,
        sourceHashAfter: sourceAfter.hash
      });
    }
    const comparison = compareCollectExpectations(
      document,
      expectations,
      options.args.allowIncompleteSource === true,
      sourceAfter.hash
    );
    const afterComparison = stopped();
    if (afterComparison) return localResult(afterComparison);
    if (comparison.kind === "worker-fallback") {
      return { kind: "worker-fallback", effectiveTimeoutMs, localStartedAt };
    }
    return localResult(comparison.result);
  } catch (error) {
    const stopResult = stopped();
    if (stopResult) return localResult(stopResult);
    if (error instanceof VerifyFileError) return localResult(operationError(error.message, error.kind));
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return localResult(operationError("from muss eine existierende .json-Datei sein.", "bad-args"));
    }
    return localResult(operationError(
      `Collect-JSON ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`,
      "invalid-source"
    ));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
var VerifyFileError;
var init_verify_executor = __esm({
  "src/verify-executor.ts"() {
    "use strict";
    init_abortable();
    init_api_contract();
    init_collect_verification();
    init_executor_errors();
    init_file_identity();
    init_json_files();
    VerifyFileError = class extends Error {
      constructor(message, kind) {
        super(message);
        this.kind = kind;
      }
      kind;
      name = "VerifyFileError";
    };
  }
});

// src/owned-file.ts
import { lstat, open as open3, stat as stat3, unlink } from "node:fs/promises";
import { createHash as createHash7 } from "node:crypto";
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}
async function hashHandle(handle) {
  const digest = createHash7("sha256");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex").toUpperCase();
}
async function readHandle(handle, bytes) {
  const content = Buffer.alloc(bytes);
  let position = 0;
  while (position < bytes) {
    const { bytesRead } = await handle.read(content, position, bytes - position, position);
    if (bytesRead === 0) return void 0;
    position += bytesRead;
  }
  return content;
}
async function removeVerifiedOwnedFile(path, identity, verifyContent) {
  let handle;
  try {
    handle = await open3(path, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileIdentity(identity, before) || !await verifyContent(handle, before)) {
      return { stillOwned: false, removed: false };
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat3(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      return { stillOwned: false, removed: false };
    }
    await handle.close();
    handle = void 0;
    try {
      await unlink(path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return { stillOwned: true, removed: false };
    }
    return { stillOwned: true, removed: !await pathExists(path) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { stillOwned: false, removed: true };
    return { stillOwned: false, removed: false };
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
async function removeOwnedFile(path, identity, expectedBytes, expectedHash) {
  return await removeVerifiedOwnedFile(path, identity, async (handle, state) => state.size === BigInt(expectedBytes) && await hashHandle(handle) === expectedHash);
}
async function removeOwnedFilePrefix(path, identity, intendedContent) {
  return await removeVerifiedOwnedFile(path, identity, async (handle, state) => {
    if (state.size > BigInt(intendedContent.length)) return false;
    const bytes = Number(state.size);
    const actual = await readHandle(handle, bytes);
    return actual !== void 0 && actual.equals(intendedContent.subarray(0, bytes));
  });
}
var HASH_CHUNK_BYTES;
var init_owned_file = __esm({
  "src/owned-file.ts"() {
    "use strict";
    init_file_identity();
    HASH_CHUNK_BYTES = 1024 * 1024;
  }
});

// src/working-copy-executor.ts
import { createHash as createHash8 } from "node:crypto";
import { lstat as lstat2, open as open4, stat as stat4 } from "node:fs/promises";
import { dirname as dirname8, extname as extname3, resolve as resolve12 } from "node:path";
import { performance as performance5 } from "node:perf_hooks";
function errorCode2(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
async function pathExists2(path) {
  try {
    await lstat2(path);
    return true;
  } catch (error) {
    if (errorCode2(error) === "ENOENT") return false;
    throw error;
  }
}
async function hashHandle2(handle, checkStopped) {
  const digest = createHash8("sha256");
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let position = 0;
  while (true) {
    checkStopped();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    checkStopped();
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex").toUpperCase();
}
async function stableHash(handle, path, checkStopped) {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile()) throw new WorkingCopyFileError(`Falldatei fehlt: ${path}`, "not-found");
  const hash2 = await hashHandle2(handle, checkStopped);
  const afterHandle = await handle.stat({ bigint: true });
  let afterPath;
  try {
    afterPath = await stat4(path, { bigint: true });
  } catch {
    throw new WorkingCopyFileError(
      `Falldatei wurde waehrend des Lesens veraendert oder ersetzt: ${path}`,
      "resource-changed"
    );
  }
  if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
    throw new WorkingCopyFileError(
      `Falldatei wurde waehrend des Lesens veraendert oder ersetzt: ${path}`,
      "resource-changed"
    );
  }
  return { hash: hash2, state: before };
}
async function cleanupLateTargetOpen(handle, path) {
  let identity;
  try {
    identity = await handle.stat({ bigint: true });
  } catch {
  } finally {
    await handle.close().catch(() => void 0);
  }
  if (identity) await removeOwnedFile(path, identity, 0, EMPTY_SHA256);
}
function postconditionMessage(ownership) {
  if (ownership.removed) return "Arbeitskopie wich von der Quelle ab; eigenes Ziel wurde entfernt.";
  if (ownership.stillOwned) {
    return "Arbeitskopie wich von der Quelle ab; eigenes Ziel konnte nicht entfernt werden und blieb zur manuellen Klaerung erhalten.";
  }
  return "Arbeitskopie wurde nach dem Erstellen veraendert; unbekanntes Ziel blieb zur manuellen Klaerung erhalten.";
}
function withCleanupStatus(result, ownership) {
  if (!ownership) return result;
  const cleanupDetail = ownership.removed ? "" : ownership.stillOwned ? " Eigenes Arbeitskopieziel konnte nicht entfernt werden." : " Arbeitskopieziel ist nicht mehr eindeutig als eigener Schreibstand gebunden und blieb erhalten.";
  return {
    ...result,
    ...cleanupDetail ? { error: `${result.error ?? "Arbeitskopie fehlgeschlagen."}${cleanupDetail}` } : {},
    targetStillOwned: ownership.stillOwned,
    rolledBack: ownership.removed
  };
}
function withResourceIdentity2(result, resourceRefs) {
  return Object.keys(resourceRefs).length ? { ...result, resourceRefs } : result;
}
function appendHeaderBytes(chunks, chunk, currentBytes) {
  if (currentBytes >= AKAD_MAX_HEADER_BYTES) return currentBytes;
  const slice = chunk.subarray(0, AKAD_MAX_HEADER_BYTES - currentBytes);
  if (slice.length) chunks.push(Buffer.from(slice));
  return currentBytes + slice.length;
}
async function executeLocalWorkingCopy(options) {
  const effectiveTimeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const startedAt = performance5.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const stopped = () => {
    if (options.signal?.aborted) return operationError("API-Client hat die Arbeitskopie abgebrochen.", "aborted");
    if (timedOut || performance5.now() - startedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Erstellen der Arbeitskopie aufgebraucht.", "timeout");
    }
    return void 0;
  };
  const checkStopped = () => {
    const result = stopped();
    if (result) throw new WorkingCopyStopped(result);
  };
  const localResult = (result) => options.redactPaths(withResourceIdentity2(result, options.resourceRefs));
  const openFile = options.openFile ?? open4;
  let sourceHandle;
  let targetHandle;
  let targetIdentity;
  let sourcePath;
  let targetPath;
  let targetCreated = false;
  let bytesWritten = 0;
  const writtenDigest = createHash8("sha256");
  try {
    const sourceRaw = options.args.source;
    const targetRaw = options.args.target;
    const expectedHashRaw = options.args.expectedSourceHash;
    if (typeof sourceRaw !== "string" || !sourceRaw || typeof targetRaw !== "string" || !targetRaw || typeof expectedHashRaw !== "string" || !/^[A-Fa-f0-9]{64}$/u.test(expectedHashRaw)) {
      return localResult(operationError("source, target und expectedSourceHash sind Pflicht.", "bad-args"));
    }
    sourcePath = resolve12(sourceRaw);
    targetPath = resolve12(targetRaw);
    const expectedHash = expectedHashRaw.toUpperCase();
    checkStopped();
    try {
      sourceHandle = await abortable(
        openFile(sourcePath, "r"),
        controller.signal,
        (lateHandle) => lateHandle.close().catch(() => void 0)
      );
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(errorCode2(error))) {
        return localResult(operationError(`Quelldatei fehlt: ${sourcePath}`, "not-found"));
      }
      throw error;
    }
    const sourceInitialState = await sourceHandle.stat({ bigint: true });
    if (!sourceInitialState.isFile()) {
      return localResult(operationError(`Quelldatei fehlt: ${sourcePath}`, "not-found"));
    }
    if (await pathExists2(targetPath)) {
      return localResult(operationError(`Ziel existiert bereits: ${targetPath}`, "exists"));
    }
    if (!isProfileCaseFileName(sourcePath, options.profile, true) || !isProfileCaseFileName(targetPath, options.profile, true)) {
      return localResult(operationError(
        `Quelle und Ziel muessen Falldateien des Profils '${options.profile.id}' sein.`,
        "unsupported-case"
      ));
    }
    if (extname3(sourcePath).toUpperCase() !== extname3(targetPath).toUpperCase()) {
      return localResult(operationError("Quelle und Ziel muessen dieselbe Steuerfall-Endung haben.", "bad-args"));
    }
    let targetDirectoryState;
    try {
      targetDirectoryState = await stat4(dirname8(targetPath), { bigint: true });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode2(error))) {
        return localResult(operationError(`Zielordner fehlt: ${dirname8(targetPath)}`, "not-found"));
      }
      throw error;
    }
    if (!targetDirectoryState.isDirectory()) {
      return localResult(operationError(`Zielordner fehlt: ${dirname8(targetPath)}`, "not-found"));
    }
    const sourceBefore = await stableHash(sourceHandle, sourcePath, checkStopped);
    if (sourceBefore.hash !== expectedHash) {
      return localResult(operationError("Quell-Hash stimmt nicht; NICHT kopiert.", "precondition-failed"));
    }
    checkStopped();
    try {
      targetHandle = await abortable(
        openFile(targetPath, "wx+"),
        controller.signal,
        (lateHandle) => cleanupLateTargetOpen(lateHandle, targetPath)
      );
      targetCreated = true;
    } catch (error) {
      if (errorCode2(error) === "EEXIST") {
        return localResult(operationError(`Ziel existiert bereits: ${targetPath}`, "exists"));
      }
      throw error;
    }
    targetIdentity = await targetHandle.stat({ bigint: true });
    const targetPathIdentity = await stat4(targetPath, { bigint: true });
    if (!sameFileIdentity(targetIdentity, targetPathIdentity)) {
      throw new WorkingCopyFileError(
        "Arbeitskopieziel wurde unmittelbar nach dem Erstellen ersetzt.",
        "postcondition-failed"
      );
    }
    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    const headerChunks = [];
    let headerBytes = 0;
    let sourcePosition = 0;
    while (true) {
      checkStopped();
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, sourcePosition);
      checkStopped();
      if (bytesRead === 0) break;
      sourcePosition += bytesRead;
      let chunkOffset = 0;
      while (chunkOffset < bytesRead) {
        checkStopped();
        const { bytesWritten: written } = await targetHandle.write(
          buffer,
          chunkOffset,
          bytesRead - chunkOffset,
          bytesWritten
        );
        if (written <= 0) throw new Error("Arbeitskopie konnte keinen weiteren Dateiblock schreiben.");
        const writtenSlice = buffer.subarray(chunkOffset, chunkOffset + written);
        writtenDigest.update(writtenSlice);
        headerBytes = appendHeaderBytes(headerChunks, writtenSlice, headerBytes);
        chunkOffset += written;
        bytesWritten += written;
      }
      await options.afterChunk?.(bytesWritten);
      checkStopped();
    }
    await targetHandle.sync();
    checkStopped();
    await options.afterCopy?.();
    checkStopped();
    const sourceAfter = await stableHash(sourceHandle, sourcePath, checkStopped);
    const targetAfter = await stableHash(targetHandle, targetPath, checkStopped);
    const sourceHandleState = await sourceHandle.stat({ bigint: true });
    const sourcePathState = await stat4(sourcePath, { bigint: true });
    const targetHandleState = await targetHandle.stat({ bigint: true });
    const targetPathState = await stat4(targetPath, { bigint: true });
    const copiedHash = writtenDigest.copy().digest("hex").toUpperCase();
    const verified = sourceAfter.hash === sourceBefore.hash && sameFileState(sourceBefore.state, sourceAfter.state) && sameFileState(sourceAfter.state, sourceHandleState) && sameFileState(sourceAfter.state, sourcePathState) && copiedHash === sourceBefore.hash && targetAfter.hash === sourceBefore.hash && sameFileIdentity(targetIdentity, targetAfter.state) && sameFileState(targetAfter.state, targetHandleState) && sameFileState(targetAfter.state, targetPathState);
    if (!verified) {
      await targetHandle.close().catch(() => void 0);
      targetHandle = void 0;
      const ownership = await removeOwnedFile(targetPath, targetIdentity, bytesWritten, sourceBefore.hash);
      return localResult({
        ok: false,
        kind: "postcondition-failed",
        error: postconditionMessage(ownership),
        source: sourcePath,
        target: targetPath,
        sourceBefore: sourceBefore.hash,
        sourceAfter: sourceAfter.hash,
        targetHash: targetAfter.hash,
        targetStillOwned: ownership.stillOwned,
        rolledBack: ownership.removed
      });
    }
    await options.afterVerifiedTarget?.(targetAfter.state);
    checkStopped();
    const summary = parseAkadCaseSummary(Buffer.concat(headerChunks, headerBytes));
    return localResult({
      ok: true,
      copied: true,
      source: sourcePath,
      target: targetPath,
      sourceHash: sourceBefore.hash,
      targetHash: targetAfter.hash,
      verified: true,
      header: summary.header,
      transmitted: summary.transmitted
    });
  } catch (error) {
    if (targetCreated && !targetIdentity && targetHandle) {
      try {
        targetIdentity = await targetHandle.stat({ bigint: true });
      } catch {
      }
    }
    await targetHandle?.close().catch(() => void 0);
    targetHandle = void 0;
    let ownership;
    if (targetCreated && targetPath && targetIdentity) {
      const partialHash = bytesWritten > 0 ? writtenDigest.copy().digest("hex").toUpperCase() : EMPTY_SHA256;
      ownership = await removeOwnedFile(targetPath, targetIdentity, bytesWritten, partialHash);
    } else if (targetCreated) {
      ownership = { stillOwned: false, removed: false };
    }
    const failedResult = (result) => withCleanupStatus(
      targetCreated && sourcePath && targetPath ? { ...result, source: sourcePath, target: targetPath } : result,
      ownership
    );
    if (error instanceof WorkingCopyStopped) return localResult(failedResult(error.result));
    if (error instanceof WorkingCopyFileError) {
      const kind = targetCreated ? "postcondition-failed" : error.kind;
      return localResult(failedResult(operationError(error.message, kind)));
    }
    const stopResult = stopped();
    if (stopResult) return localResult(failedResult(stopResult));
    if (errorCode2(error) === "ENOENT") {
      return localResult(failedResult(
        operationError("Quelle oder Zielpfad wurde waehrend der Arbeitskopie entfernt.", "postcondition-failed")
      ));
    }
    return localResult(failedResult(
      operationError(
        `Arbeitskopie konnte nicht erstellt werden: ${error instanceof Error ? error.message : String(error)}`,
        "worker"
      )
    ));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await targetHandle?.close().catch(() => void 0);
    await sourceHandle?.close().catch(() => void 0);
  }
}
var COPY_CHUNK_BYTES, EMPTY_SHA256, WorkingCopyFileError, WorkingCopyStopped;
var init_working_copy_executor = __esm({
  "src/working-copy-executor.ts"() {
    "use strict";
    init_abortable();
    init_api_contract();
    init_case_file();
    init_executor_errors();
    init_file_identity();
    init_owned_file();
    COPY_CHUNK_BYTES = 1024 * 1024;
    EMPTY_SHA256 = createHash8("sha256").digest("hex").toUpperCase();
    WorkingCopyFileError = class extends Error {
      constructor(message, kind) {
        super(message);
        this.kind = kind;
      }
      kind;
      name = "WorkingCopyFileError";
    };
    WorkingCopyStopped = class extends Error {
      constructor(result) {
        super(result.error ?? result.kind ?? "Arbeitskopie gestoppt");
        this.result = result;
      }
      result;
      name = "WorkingCopyStopped";
    };
  }
});

// src/local-file-transaction.ts
import { lstat as lstat3, mkdir, readdir as readdir2, realpath, rmdir, stat as stat5 } from "node:fs/promises";
import { dirname as dirname9, isAbsolute as isAbsolute6, relative as relative4, sep as sep3 } from "node:path";
function errorCode3(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
async function pathExists3(path) {
  try {
    await lstat3(path);
    return true;
  } catch (error) {
    if (errorCode3(error) === "ENOENT") return false;
    throw error;
  }
}
function isInside(parent, candidate) {
  const relation = relative4(parent, candidate);
  return relation === "" || !isAbsolute6(relation) && relation !== ".." && !relation.startsWith(`..${sep3}`);
}
async function createOwnedDirectoryChain(options) {
  const { destination, sourceDirectory, created, destinationLabel, insideSourceMessage } = options;
  const missing = [];
  let existingAncestor = destination;
  while (true) {
    try {
      const state = await stat5(existingAncestor, { bigint: true });
      if (!state.isDirectory()) {
        throw new LocalFileError(`Zielvorfahr ist kein Ordner: ${existingAncestor}`, "not-found");
      }
      break;
    } catch (error) {
      if (error instanceof LocalFileError) throw error;
      if (errorCode3(error) !== "ENOENT") throw error;
      missing.push(existingAncestor);
      const parent = dirname9(existingAncestor);
      if (parent === existingAncestor) {
        throw new LocalFileError(`${destinationLabel} hat keinen existierenden Zielvorfahren.`, "not-found");
      }
      existingAncestor = parent;
    }
  }
  const [realSource, realAncestor] = await Promise.all([realpath(sourceDirectory), realpath(existingAncestor)]);
  if (isInside(realSource, realAncestor)) {
    throw new LocalFileError(insideSourceMessage, "bad-args");
  }
  if (!missing.length) {
    throw new LocalFileError(`${destinationLabel} existiert bereits: ${destination}`, "precondition-failed");
  }
  for (const path of missing.reverse()) {
    try {
      await mkdir(path);
    } catch (error) {
      if (errorCode3(error) === "EEXIST") {
        throw new LocalFileError(
          `${destinationLabel} erschien waehrend des Anlegens: ${path}`,
          "precondition-failed"
        );
      }
      throw error;
    }
    const owned = { path };
    created.push(owned);
    const identity = await stat5(path, { bigint: true });
    if (!identity.isDirectory()) {
      throw new LocalFileError(`${destinationLabel} wurde beim Anlegen ersetzt: ${path}`, "postcondition-failed");
    }
    owned.identity = identity;
  }
  const destinationIdentity = created.at(-1)?.identity;
  if (!destinationIdentity || created.at(-1)?.path !== destination) {
    throw new LocalFileError(
      `${destinationLabel} konnte nicht eindeutig neu gebunden werden.`,
      "postcondition-failed"
    );
  }
  return destinationIdentity;
}
function withResourceIdentity3(result, refs) {
  return Object.keys(refs).length ? { ...result, resourceRefs: refs } : result;
}
function csvManifest(hashes) {
  const quote = (value) => `"${value.replaceAll('"', '""')}"`;
  const rows = [
    `${quote("file")},${quote("sha256")}`,
    ...hashes.map((entry) => `${quote(entry.file)},${quote(entry.sha256)}`)
  ];
  return Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(`${rows.join("\r\n")}\r
`, "utf8")]);
}
async function handleContainsExactBytes(handle, expected) {
  const actual = Buffer.alloc(expected.length);
  let position = 0;
  while (position < actual.length) {
    const { bytesRead } = await handle.read(actual, position, actual.length - position, position);
    if (bytesRead === 0) return false;
    position += bytesRead;
  }
  return actual.equals(expected);
}
async function directoryStillOwned(path, identity) {
  try {
    const current = await stat5(path, { bigint: true });
    return current.isDirectory() && sameFileIdentity(identity, current);
  } catch {
    return false;
  }
}
function sameNames(actual, expected) {
  if (actual.length !== expected.length) return false;
  const expectedNames = new Set(expected);
  return actual.every((name) => expectedNames.has(name));
}
async function directoryHasExactEntries(path, identity, expectedNames) {
  if (!await directoryStillOwned(path, identity)) return false;
  return sameNames(await readdir2(path), expectedNames);
}
async function removeOwnedEmptyDirectory(path, identity) {
  try {
    if (!await directoryStillOwned(path, identity)) return false;
    if ((await readdir2(path)).length) return false;
    await rmdir(path);
    return !await pathExists3(path);
  } catch {
    return false;
  }
}
var LocalFileError, LocalOperationStopped;
var init_local_file_transaction = __esm({
  "src/local-file-transaction.ts"() {
    "use strict";
    init_file_identity();
    LocalFileError = class extends Error {
      constructor(message, kind) {
        super(message);
        this.kind = kind;
      }
      kind;
      name = "LocalFileError";
    };
    LocalOperationStopped = class extends Error {
      constructor(result) {
        super(result.error ?? result.kind ?? "Lokale Dateioperation gestoppt");
        this.result = result;
      }
      result;
      name = "LocalOperationStopped";
    };
  }
});

// src/backup-executor.ts
import { createHash as createHash9 } from "node:crypto";
import { open as open5, readdir as readdir3, stat as stat6 } from "node:fs/promises";
import { join as join6, resolve as resolve13 } from "node:path";
import { performance as performance6 } from "node:perf_hooks";
async function sourceInventoryStillStable(path, identity, expectedNames, profile) {
  if (!await directoryStillOwned(path, identity)) return false;
  const currentNames = (await readdir3(path, { withFileTypes: true })).filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, profile, true)).map((entry) => entry.name);
  return sameNames(currentNames, expectedNames);
}
async function assertVerifiedTargetStillOwned(file, profile, timeoutMs, signal) {
  const before = await stat6(file.path, { bigint: true });
  if (!sameFileIdentity(file.identity, before)) {
    throw new LocalFileError(`Sicherungskopie fuer '${file.name}' wurde ersetzt.`, "postcondition-failed");
  }
  const info = await readCaseFileInfo(file.path, profile, {
    timeoutMs,
    ...signal ? { signal } : {}
  });
  const after = await stat6(file.path, { bigint: true });
  if (info.sha256 !== file.sha256 || !sameFileState(before, after)) {
    throw new LocalFileError(`Sicherungskopie fuer '${file.name}' ist nicht mehr bytegleich.`, "postcondition-failed");
  }
}
async function executeLocalBackup(options) {
  const effectiveTimeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const startedAt = performance6.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, effectiveTimeoutMs);
  const stopped = () => {
    if (options.signal?.aborted) return operationError("API-Client hat die Fallsicherung abgebrochen.", "aborted");
    if (timedOut || performance6.now() - startedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Sichern der Steuerfaelle aufgebraucht.", "timeout");
    }
    return void 0;
  };
  const checkStopped = () => {
    const result = stopped();
    if (result) throw new LocalOperationStopped(result);
  };
  const remainingMs = () => Math.max(0, Math.floor(effectiveTimeoutMs - (performance6.now() - startedAt)));
  const localResult = (result) => options.redactPaths(withResourceIdentity3(result, options.resourceRefs));
  let destination = "";
  let destinationIdentity;
  const createdDirectories = [];
  let manifestHandle;
  let manifest;
  const copied = [];
  try {
    const directoryRaw = options.args.dir;
    const destinationRaw = options.args.dest;
    if (typeof directoryRaw !== "string" || !directoryRaw || typeof destinationRaw !== "string" || !destinationRaw) {
      return localResult(operationError("dir und dest sind Pflicht.", "bad-args"));
    }
    const directory = resolve13(directoryRaw);
    destination = resolve13(destinationRaw);
    let directoryState;
    try {
      directoryState = await stat6(directory, { bigint: true });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode3(error))) {
        return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
      }
      throw error;
    }
    if (!directoryState.isDirectory()) {
      return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
    }
    if (isInside(directory, destination)) {
      return localResult(operationError(
        "Sicherungsziel darf nicht im Fallordner liegen; sonst kopiert sich die Sicherung rekursiv selbst.",
        "bad-args"
      ));
    }
    if (await pathExists3(destination)) {
      return localResult(operationError(`Sicherungsziel existiert bereits: ${destination}`, "precondition-failed"));
    }
    const entries = await readdir3(directory, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, options.profile, true)).map((entry) => entry.name);
    if (!names.length) {
      return localResult(operationError(`Keine Falldateien in ${directory} gefunden.`, "not-found"));
    }
    if (!await sourceInventoryStillStable(directory, directoryState, names, options.profile)) {
      return localResult(operationError(
        "Fallordner wurde waehrend der Sicherungsvorbereitung veraendert.",
        "resource-changed"
      ));
    }
    checkStopped();
    destinationIdentity = await createOwnedDirectoryChain({
      destination,
      sourceDirectory: directory,
      created: createdDirectories,
      destinationLabel: "Sicherungsziel",
      insideSourceMessage: "Sicherungsziel folgt einem Link oder einer Junction in den Fallordner."
    });
    for (const name of names) {
      checkStopped();
      if (!destinationIdentity || !await directoryHasExactEntries(destination, destinationIdentity, copied.map((file) => file.name))) {
        throw new LocalFileError("Sicherungsziel wurde waehrend des Laufs veraendert.", "postcondition-failed");
      }
      if (!await sourceInventoryStillStable(directory, directoryState, names, options.profile)) {
        throw new LocalFileError("Fallbestand wurde waehrend der Sicherung veraendert.", "postcondition-failed");
      }
      const source = join6(directory, name);
      const target = join6(destination, name);
      const sourceInfo = await readCaseFileInfo(source, options.profile, {
        timeoutMs: remainingMs(),
        ...options.signal ? { signal: options.signal } : {}
      });
      let targetIdentity;
      const copy = await executeLocalWorkingCopy({
        args: { source, target, expectedSourceHash: sourceInfo.sha256 },
        resourceRefs: {},
        profile: options.profile,
        timeoutMs: remainingMs(),
        ...options.signal ? { signal: options.signal } : {},
        redactPaths: (value) => value,
        afterVerifiedTarget: (identity) => {
          targetIdentity = identity;
        }
      });
      if (!copy.ok || !targetIdentity) {
        throw new LocalFileError(
          copy.error ?? `Sicherungskopie fuer '${name}' ist nicht bytegleich.`,
          copy.kind ?? "postcondition-failed"
        );
      }
      if (targetIdentity.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new LocalFileError(`Sicherungskopie fuer '${name}' ist zu gross.`, "postcondition-failed");
      }
      const record = {
        name,
        path: target,
        sha256: sourceInfo.sha256,
        bytes: Number(targetIdentity.size),
        identity: targetIdentity
      };
      copied.push(record);
      await options.afterFileCopied?.({ source, target, sha256: record.sha256 });
    }
    for (const file of copied) {
      checkStopped();
      await assertVerifiedTargetStillOwned(file, options.profile, remainingMs(), options.signal);
    }
    if (!await sourceInventoryStillStable(directory, directoryState, names, options.profile)) {
      throw new LocalFileError("Fallbestand wurde waehrend der Sicherung veraendert.", "postcondition-failed");
    }
    if (!destinationIdentity || !await directoryHasExactEntries(destination, destinationIdentity, copied.map((file) => file.name))) {
      throw new LocalFileError("Sicherungsziel wurde vor dem Manifest veraendert.", "postcondition-failed");
    }
    const hashes = copied.map((entry) => ({ file: entry.name, sha256: entry.sha256 }));
    const manifestPath = join6(destination, "pruefsummen.csv");
    const manifestBytes = csvManifest(hashes);
    const manifestHash = createHash9("sha256").update(manifestBytes).digest("hex").toUpperCase();
    manifestHandle = await open5(manifestPath, "wx+");
    const manifestIdentity = await manifestHandle.stat({ bigint: true });
    manifest = {
      path: manifestPath,
      sha256: manifestHash,
      bytes: manifestBytes.length,
      identity: manifestIdentity,
      content: manifestBytes,
      complete: false
    };
    await (options.writeManifest ?? ((handle, content) => handle.writeFile(content)))(manifestHandle, manifestBytes);
    await manifestHandle.sync();
    const manifestContentMatches = await handleContainsExactBytes(manifestHandle, manifestBytes);
    const manifestHandleAfter = await manifestHandle.stat({ bigint: true });
    const manifestPathAfter = await stat6(manifestPath, { bigint: true });
    if (!sameFileIdentity(manifestIdentity, manifestHandleAfter) || !sameFileState(manifestHandleAfter, manifestPathAfter) || manifestHandleAfter.size !== BigInt(manifestBytes.length) || !manifestContentMatches) {
      throw new LocalFileError("Pruefsummenmanifest wurde waehrend des Schreibens ersetzt.", "postcondition-failed");
    }
    manifest.complete = true;
    await manifestHandle.close();
    manifestHandle = void 0;
    checkStopped();
    await options.afterManifestWritten?.({ destination, manifest: manifestPath });
    checkStopped();
    if (!await sourceInventoryStillStable(directory, directoryState, names, options.profile)) {
      throw new LocalFileError("Fallbestand wurde nach dem Manifest veraendert.", "postcondition-failed");
    }
    if (!destinationIdentity || !await directoryHasExactEntries(
      destination,
      destinationIdentity,
      [...copied.map((file) => file.name), "pruefsummen.csv"]
    )) {
      throw new LocalFileError("Sicherungsziel wurde nach dem Manifest veraendert.", "postcondition-failed");
    }
    return localResult({
      ok: true,
      dest: destination,
      anzahl: hashes.length,
      files: hashes.map((entry) => ({ name: entry.file, sha256: entry.sha256 })),
      hashes,
      manifest: manifestPath,
      verified: true
    });
  } catch (error) {
    const classifiedFailure = error instanceof LocalOperationStopped ? error.result : error instanceof LocalFileError ? operationError(error.message, error.kind) : stopped();
    await manifestHandle?.close().catch(() => void 0);
    manifestHandle = void 0;
    const removals = [];
    if (manifest) {
      removals.push({
        path: manifest.path,
        ownership: manifest.complete ? await removeOwnedFile(manifest.path, manifest.identity, manifest.bytes, manifest.sha256) : await removeOwnedFilePrefix(manifest.path, manifest.identity, manifest.content)
      });
    } else if (destination && await pathExists3(join6(destination, "pruefsummen.csv")).catch(() => false)) {
      removals.push({ path: join6(destination, "pruefsummen.csv"), ownership: { stillOwned: false, removed: false } });
    }
    for (const file of [...copied].reverse()) {
      removals.push({
        path: file.path,
        ownership: await removeOwnedFile(file.path, file.identity, file.bytes, file.sha256)
      });
    }
    const retainedTargets = removals.filter((entry) => !entry.ownership.removed).map((entry) => entry.path);
    const destinationDirectory = createdDirectories.find((entry) => entry.path === destination);
    if (destinationDirectory) {
      if (destinationDirectory.identity && await directoryStillOwned(destination, destinationDirectory.identity)) {
        try {
          for (const name of await readdir3(destination)) {
            const path = join6(destination, name);
            if (!retainedTargets.includes(path)) retainedTargets.push(path);
          }
        } catch {
          if (!retainedTargets.includes(destination)) retainedTargets.push(destination);
        }
      } else if (!retainedTargets.includes(destination)) {
        retainedTargets.push(destination);
      }
    }
    for (const directory of [...createdDirectories].reverse()) {
      const retainedDescendant = retainedTargets.some((path) => isInside(directory.path, path));
      const removed = directory.identity && !retainedDescendant ? await removeOwnedEmptyDirectory(directory.path, directory.identity) : false;
      if (!removed && await pathExists3(directory.path).catch(() => true) && !retainedDescendant) {
        retainedTargets.push(directory.path);
      }
    }
    const rolledBack = createdDirectories.length ? (await Promise.all(createdDirectories.map(async (entry) => !await pathExists3(entry.path).catch(() => true)))).every(Boolean) : true;
    const backupStillExists = destination ? await pathExists3(destination).catch(() => true) : false;
    const kind = classifiedFailure?.kind ?? (createdDirectories.length ? "postcondition-failed" : "worker");
    const message = classifiedFailure?.error ?? (error instanceof Error ? error.message : String(error));
    return localResult({
      ok: false,
      kind,
      error: retainedTargets.length ? `${message} Unbekannte oder veraenderte Sicherungsziele blieben zur manuellen Klaerung erhalten.` : message,
      copiedBeforeFailure: copied.length,
      rolledBack,
      retainedTargets,
      backupStillExists,
      ...destination ? { dest: destination } : {}
    });
  } finally {
    clearTimeout(timer);
    await manifestHandle?.close().catch(() => void 0);
  }
}
var init_backup_executor = __esm({
  "src/backup-executor.ts"() {
    "use strict";
    init_api_contract();
    init_case_file();
    init_executor_errors();
    init_file_identity();
    init_local_file_transaction();
    init_owned_file();
    init_working_copy_executor();
  }
});

// src/archive-file-copy.ts
import { createHash as createHash10 } from "node:crypto";
import { open as open6, stat as stat7, unlink as unlink2, utimes } from "node:fs/promises";
async function hashOpenFile(handle) {
  const digest = createHash10("sha256");
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES2);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return digest.digest("hex").toUpperCase();
}
async function hashFilePath(path) {
  const handle = await open6(path, "r");
  try {
    return await hashOpenFile(handle);
  } finally {
    await handle.close();
  }
}
async function openFileMatchesPath(handle, path, identity, expectedHash, requireOriginalState = true) {
  try {
    const [handleBefore, pathBefore] = await Promise.all([
      handle.stat({ bigint: true }),
      stat7(path, { bigint: true })
    ]);
    const bound = requireOriginalState ? sameFileState(identity, handleBefore) : sameFileIdentity(identity, handleBefore);
    if (!bound || !sameFileState(handleBefore, pathBefore)) return false;
    const actualHash = await hashOpenFile(handle);
    const [handleAfter, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      stat7(path, { bigint: true })
    ]);
    return actualHash === expectedHash && sameFileState(handleBefore, handleAfter) && sameFileState(handleAfter, pathAfter);
  } catch {
    return false;
  }
}
async function filePathMatchesIdentityAndHash(path, identity, expectedHash) {
  let handle;
  try {
    handle = await open6(path, "r");
    return await openFileMatchesPath(handle, path, identity, expectedHash, false);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
async function removeOwnedCopyPrefix(path, identity, source, writtenBytes) {
  let handle;
  try {
    handle = await open6(path, "r");
    const before = await handle.stat({ bigint: true });
    if (!sameFileIdentity(identity, before) || before.size > BigInt(writtenBytes)) return false;
    const sourceBuffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES2);
    const targetBuffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES2);
    let position = 0;
    const targetBytes = Number(before.size);
    while (position < targetBytes) {
      const length = Math.min(HASH_CHUNK_BYTES2, targetBytes - position);
      const [sourceRead, targetRead] = await Promise.all([
        source.read(sourceBuffer, 0, length, position),
        handle.read(targetBuffer, 0, length, position)
      ]);
      if (sourceRead.bytesRead !== length || targetRead.bytesRead !== length || !sourceBuffer.subarray(0, length).equals(targetBuffer.subarray(0, length))) return false;
      position += length;
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat7(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(afterHandle, afterPath)) return false;
    await handle.close();
    handle = void 0;
    await unlink2(path);
    return !await pathExists3(path);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
async function copyOpenFileToArchive(source, target, expectedHash, expectedBytes, signal, timestamps) {
  let targetHandle;
  let targetIdentity;
  let writtenBytes = 0;
  const intended = createHash10("sha256");
  try {
    targetHandle = await open6(target, "wx+");
    targetIdentity = await targetHandle.stat({ bigint: true });
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES2);
    let position = 0;
    while (position < expectedBytes) {
      if (signal?.aborted) {
        throw new LocalOperationStopped(operationError("API-Client hat die Fallarchivierung abgebrochen.", "aborted"));
      }
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, expectedBytes - position), position);
      if (bytesRead === 0) {
        throw new LocalFileError("Quellfall endete waehrend der Archivkopie vorzeitig.", "postcondition-failed");
      }
      intended.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await targetHandle.write(buffer, written, bytesRead - written, position + written);
        if (result.bytesWritten === 0) {
          throw new LocalFileError("Archivkopie konnte nicht vollstaendig geschrieben werden.", "postcondition-failed");
        }
        written += result.bytesWritten;
        writtenBytes += result.bytesWritten;
      }
      position += bytesRead;
    }
    if (intended.digest("hex").toUpperCase() !== expectedHash) {
      throw new LocalFileError("Quellfall wich waehrend der Archivkopie vom erwarteten Hash ab.", "postcondition-failed");
    }
    await targetHandle.sync();
    if (timestamps) await utimes(target, timestamps.atime, timestamps.mtime);
    const before = await targetHandle.stat({ bigint: true });
    const pathState = await stat7(target, { bigint: true });
    const targetHash = await hashOpenFile(targetHandle);
    const after = await targetHandle.stat({ bigint: true });
    const pathAfter = await stat7(target, { bigint: true });
    if (!sameFileIdentity(targetIdentity, before) || !sameFileState(before, after) || !sameFileState(after, pathState) || !sameFileState(after, pathAfter) || after.size !== BigInt(expectedBytes) || targetHash !== expectedHash) {
      throw new LocalFileError("Archivkopie wurde waehrend der Verifikation veraendert.", "postcondition-failed");
    }
    return { handle: targetHandle, identity: targetIdentity };
  } catch (error) {
    await targetHandle?.close().catch(() => void 0);
    if (targetIdentity) await removeOwnedCopyPrefix(target, targetIdentity, source, writtenBytes);
    throw error;
  }
}
var HASH_CHUNK_BYTES2;
var init_archive_file_copy = __esm({
  "src/archive-file-copy.ts"() {
    "use strict";
    init_executor_errors();
    init_file_identity();
    init_local_file_transaction();
    HASH_CHUNK_BYTES2 = 1024 * 1024;
  }
});

// src/sse-process-guard.ts
import { execFile } from "node:child_process";
import { join as join7 } from "node:path";
import { promisify } from "node:util";
function parseTasklistSseOutput(stdout) {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const csvLines = lines.filter((line) => line.startsWith('"'));
  if (csvLines.some((line) => /^"SSE\.exe"(?:,|$)/iu.test(line))) return true;
  if (csvLines.length) {
    throw new LocalFileError("SSE-Prozessliste enthielt eine unerwartete CSV-Antwort.", "precondition-failed");
  }
  if (lines.length && lines.every((line) => /^[^"\r\n]+:\s+/u.test(line))) return false;
  throw new LocalFileError("SSE-Prozessliste war nicht sicher auswertbar.", "precondition-failed");
}
async function hasRunningSseProcess() {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) {
    throw new LocalFileError("Windows-Systempfad fuer die SSE-Prozesspruefung fehlt.", "precondition-failed");
  }
  const executable = join7(systemRoot, "System32", "tasklist.exe");
  try {
    const result = await execFileAsync(executable, ["/FI", "IMAGENAME eq SSE.exe", "/NH", "/FO", "CSV"], {
      encoding: "utf8",
      timeout: TASKLIST_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return parseTasklistSseOutput(result.stdout);
  } catch (error) {
    if (error instanceof LocalFileError) throw error;
    throw new LocalFileError(
      `SSE-Prozessstatus konnte nicht sicher gelesen werden: ${error instanceof Error ? error.message : String(error)}`,
      "precondition-failed"
    );
  }
}
var TASKLIST_TIMEOUT_MS, execFileAsync;
var init_sse_process_guard = __esm({
  "src/sse-process-guard.ts"() {
    "use strict";
    init_local_file_transaction();
    TASKLIST_TIMEOUT_MS = 5e3;
    execFileAsync = promisify(execFile);
  }
});

// src/archive-executor.ts
import { createHash as createHash11 } from "node:crypto";
import { open as open7, readdir as readdir4, stat as stat8, unlink as unlink3 } from "node:fs/promises";
import { basename as basename5, join as join8, resolve as resolve14 } from "node:path";
import { performance as performance7 } from "node:perf_hooks";
function asArchiveArguments(value) {
  if (!Array.isArray(value) || !value.length) return void 0;
  const result = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return void 0;
    const name = entry.name;
    const hash2 = entry.expectedSha256;
    if (typeof name !== "string" || typeof hash2 !== "string") return void 0;
    result.push({ name, expectedSha256: hash2.toUpperCase() });
  }
  return result;
}
async function bindCase(source, argument, actualName, profile, remainingMs, signal) {
  const info = await readCaseFileInfo(source, profile, {
    timeoutMs: remainingMs(),
    ...signal ? { signal } : {}
  });
  let handle;
  try {
    handle = await open7(source, "r");
    const before = await handle.stat({ bigint: true });
    const pathBefore = await stat8(source, { bigint: true });
    if (!before.isFile() || !sameFileState(before, pathBefore) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new LocalFileError(`Fall '${actualName}' konnte nicht stabil gebunden werden.`, "resource-changed");
    }
    const hash2 = await hashOpenFile(handle);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await stat8(source, { bigint: true });
    if (!sameFileState(before, after) || !sameFileState(after, pathAfter) || hash2 !== info.sha256) {
      throw new LocalFileError(`Fall '${actualName}' wurde waehrend der Archivvorbereitung veraendert.`, "resource-changed");
    }
    if (hash2 !== argument.expectedSha256) {
      throw new LocalFileError(`Hash fuer '${argument.name}' stimmt nicht; NICHTS verschoben.`, "precondition-failed");
    }
    return {
      ...argument,
      actualName,
      source,
      handle,
      identity: before,
      bytes: Number(before.size),
      transmitted: info.transmitted
    };
  } catch (error) {
    await handle?.close().catch(() => void 0);
    throw error;
  }
}
async function sourcePathStillBound(file) {
  return await openFileMatchesPath(file.handle, file.source, file.identity, file.expectedSha256);
}
async function caseInventory(directory, profile) {
  const names = (await readdir4(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, profile, true)).map((entry) => entry.name);
  const byLowerName = /* @__PURE__ */ new Map();
  let collision;
  for (const name of names) {
    const key = name.toLowerCase();
    if (byLowerName.has(key)) collision = name;
    else byLowerName.set(key, name);
  }
  return { names, byLowerName, collision };
}
async function writeVerifiedManifest(destination, rows, writeManifest) {
  const path = join8(destination, "pruefsummen.csv");
  const content = csvManifest(rows);
  const sha256 = createHash11("sha256").update(content).digest("hex").toUpperCase();
  const handle = await open7(path, "wx+");
  const identity = await handle.stat({ bigint: true });
  const manifest = {
    path,
    identity,
    bytes: content.length,
    sha256,
    content,
    complete: false
  };
  try {
    await (writeManifest ?? ((target, bytes) => target.writeFile(bytes)))(handle, content);
    await handle.sync();
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat8(path, { bigint: true });
    if (!sameFileIdentity(identity, afterHandle) || !sameFileState(afterHandle, afterPath) || afterHandle.size !== BigInt(content.length) || !await handleContainsExactBytes(handle, content)) {
      throw new LocalFileError("Pruefsummenmanifest wurde waehrend des Schreibens ersetzt.", "postcondition-failed");
    }
    manifest.complete = true;
    return { manifest, handle };
  } catch (error) {
    await handle.close().catch(() => void 0);
    const removal = manifest.complete ? await removeOwnedFile(path, identity, content.length, sha256) : await removeOwnedFilePrefix(path, identity, content);
    if (!removal.removed) {
      throw new LocalFileError("Unvollstaendiges Archivmanifest blieb zur manuellen Klaerung erhalten.", "postcondition-failed");
    }
    throw error;
  }
}
async function preserveRecoveryCopy(file, directory, directoryIdentity) {
  if (!directoryIdentity || !await directoryStillOwned(directory, directoryIdentity)) return void 0;
  const stem = `.sse-recovery-${file.expectedSha256.slice(0, 16)}-${file.actualName}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const path = join8(directory, `${stem}${attempt === 0 ? "" : `.${attempt}`}.bin`);
    try {
      const copy = await copyOpenFileToArchive(
        file.handle,
        path,
        file.expectedSha256,
        file.bytes,
        void 0,
        file.identity
      );
      await copy.handle.close();
      return path;
    } catch (error) {
      if (errorCode3(error) !== "EEXIST") return void 0;
    }
  }
  return void 0;
}
async function executeLocalArchive(options) {
  const effectiveTimeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const startedAt = performance7.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, effectiveTimeoutMs);
  const stopped = () => {
    if (options.signal?.aborted) return operationError("API-Client hat die Fallarchivierung abgebrochen.", "aborted");
    if (timedOut || performance7.now() - startedAt >= effectiveTimeoutMs) {
      return operationError("Zeitbudget beim lokalen Archivieren der Steuerfaelle aufgebraucht.", "timeout");
    }
    return void 0;
  };
  const checkStopped = () => {
    const result = stopped();
    if (result) throw new LocalOperationStopped(result);
  };
  const remainingMs = () => Math.max(0, Math.floor(effectiveTimeoutMs - (performance7.now() - startedAt)));
  const localResult = (result) => options.redactPaths(withResourceIdentity3(result, options.resourceRefs));
  let directory = "";
  let destination = "";
  let directoryIdentity;
  let destinationIdentity;
  const createdDirectories = [];
  const bound = [];
  const moved = [];
  let manifestHandle;
  let manifest;
  let archiveArguments = [];
  let remainingArguments = [];
  try {
    const directoryRaw = options.args.dir;
    const destinationRaw = options.args.dest;
    archiveArguments = asArchiveArguments(options.args.cases) ?? [];
    remainingArguments = asArchiveArguments(options.args.expectedRemaining) ?? [];
    if (typeof directoryRaw !== "string" || !directoryRaw || typeof destinationRaw !== "string" || !destinationRaw || !archiveArguments.length || !remainingArguments.length) {
      return localResult(operationError("dir, dest, cases und expectedRemaining sind Pflicht und duerfen nicht leer sein.", "bad-args"));
    }
    directory = resolve14(directoryRaw);
    destination = resolve14(destinationRaw);
    try {
      directoryIdentity = await stat8(directory, { bigint: true });
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode3(error))) {
        return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
      }
      throw error;
    }
    if (!directoryIdentity.isDirectory()) {
      return localResult(operationError(`Fallordner fehlt: ${directory}`, "not-found"));
    }
    if (isInside(directory.toLowerCase(), destination.toLowerCase())) {
      return localResult(operationError("Archivziel muss ausserhalb des aktiven Fallordners liegen.", "bad-args"));
    }
    if (await pathExists3(destination)) {
      return localResult(operationError(`Archivziel existiert bereits: ${destination}`, "precondition-failed"));
    }
    const allArguments = [...archiveArguments, ...remainingArguments];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of allArguments) {
      const key = entry.name.toLowerCase();
      if (!entry.name || basename5(entry.name) !== entry.name || !isProfileCaseFileName(entry.name, options.profile, true)) {
        return localResult(operationError(`Ungueltiger Fallname '${entry.name}'. Nur ein einfacher Falldateiname ist erlaubt.`, "bad-args"));
      }
      if (!/^[0-9A-F]{64}$/u.test(entry.expectedSha256)) {
        return localResult(operationError(`Ungueltiger SHA256 fuer '${entry.name}'.`, "bad-args"));
      }
      if (seen.has(key)) {
        return localResult(operationError(`Fall '${entry.name}' ist mehrfach in der Bestandsvorgabe enthalten.`, "bad-args"));
      }
      seen.add(key);
    }
    checkStopped();
    const processIsRunning = options.hasRunningSseProcess ?? hasRunningSseProcess;
    if (await processIsRunning()) {
      return localResult(operationError(
        "SteuerSparErklaerung laeuft. Vor der Fallarchivierung alle SSE-Fenster kontrolliert schliessen.",
        "precondition-failed"
      ));
    }
    const inventory = await caseInventory(directory, options.profile);
    if (inventory.collision) {
      return localResult(operationError("Aktiver Fallbestand enthaelt eine nicht eindeutig aufloesbare Namenskollision.", "inventory-mismatch"));
    }
    const actualNames = inventory.names.map((name) => name.toLowerCase()).sort();
    const expectedNames = allArguments.map((entry) => entry.name.toLowerCase()).sort();
    if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
      return localResult({
        ok: false,
        kind: "inventory-mismatch",
        error: "Aktiver Fallbestand stimmt nicht exakt mit cases + expectedRemaining ueberein; NICHTS verschoben.",
        expected: expectedNames,
        actual: actualNames,
        differences: [
          ...expectedNames.filter((name) => !actualNames.includes(name)).map((InputObject) => ({ InputObject, SideIndicator: "<=" })),
          ...actualNames.filter((name) => !expectedNames.includes(name)).map((InputObject) => ({ InputObject, SideIndicator: "=>" }))
        ]
      });
    }
    for (const entry of allArguments) {
      checkStopped();
      const actualName = inventory.byLowerName.get(entry.name.toLowerCase());
      if (!actualName) throw new LocalFileError(`Fall '${entry.name}' fehlt waehrend der Archivvorbereitung.`, "resource-changed");
      const file = await bindCase(
        join8(directory, actualName),
        entry,
        actualName,
        options.profile,
        remainingMs,
        options.signal
      );
      bound.push(file);
      if (archiveArguments.includes(entry) && file.transmitted !== false) {
        throw new LocalFileError(
          `GESPERRT: '${entry.name}' ist uebermittelt oder der Status ist nicht sicher false.`,
          "blocked"
        );
      }
    }
    checkStopped();
    destinationIdentity = await createOwnedDirectoryChain({
      destination,
      sourceDirectory: directory,
      created: createdDirectories,
      destinationLabel: "Archivziel",
      insideSourceMessage: "Archivziel folgt einem Link oder einer Junction in den aktiven Fallordner."
    });
    const archiveFiles = bound.slice(0, archiveArguments.length);
    const manifestResult = await writeVerifiedManifest(
      destination,
      archiveFiles.map((entry) => ({ file: entry.actualName, sha256: entry.expectedSha256 })),
      options.writeManifest
    );
    manifest = manifestResult.manifest;
    manifestHandle = manifestResult.handle;
    await manifestHandle.close();
    manifestHandle = void 0;
    for (const file of archiveFiles) {
      checkStopped();
      if (!destinationIdentity || !await directoryHasExactEntries(
        destination,
        destinationIdentity,
        ["pruefsummen.csv", ...moved.map((entry) => entry.actualName)]
      )) {
        throw new LocalFileError("Archivziel wurde waehrend des Laufs veraendert.", "postcondition-failed");
      }
      if (!await sourcePathStillBound(file)) {
        throw new LocalFileError(`Fall '${file.actualName}' wurde vor dem Verschieben veraendert.`, "postcondition-failed");
      }
      const target = join8(destination, file.actualName);
      const copied = await copyOpenFileToArchive(
        file.handle,
        target,
        file.expectedSha256,
        file.bytes,
        options.signal,
        file.identity
      );
      if (!await sourcePathStillBound(file)) {
        await copied.handle.close();
        await removeOwnedFile(target, copied.identity, file.bytes, file.expectedSha256);
        throw new LocalFileError(`Fall '${file.actualName}' wurde vor dem Entfernen veraendert.`, "postcondition-failed");
      }
      if (await processIsRunning()) {
        await copied.handle.close();
        await removeOwnedFile(target, copied.identity, file.bytes, file.expectedSha256);
        throw new LocalFileError(
          "SteuerSparErklaerung wurde waehrend der Archivvorbereitung gestartet; NICHTS weiter verschoben.",
          "precondition-failed"
        );
      }
      try {
        await (options.removeSource ?? unlink3)(file.source);
      } catch (error) {
        await copied.handle.close();
        const removed = await removeOwnedFile(target, copied.identity, file.bytes, file.expectedSha256);
        if (!removed.removed) {
          throw new LocalFileError(
            `Quellfall '${file.actualName}' konnte nicht entfernt werden; verifiziertes Archivziel blieb erhalten.`,
            "postcondition-failed"
          );
        }
        throw error;
      }
      const movedFile = { ...file, target, targetIdentity: copied.identity };
      moved.push(movedFile);
      await copied.handle.close();
      const sourceStillVisible = await pathExists3(file.source).catch((error) => {
        if (["EACCES", "EPERM"].includes(errorCode3(error))) return true;
        throw error;
      });
      if (sourceStillVisible) {
        throw new LocalFileError(
          `Dateisystem entfernte Quellfall '${file.actualName}' nicht sicher bei offenem Handle; verifiziertes Archivziel bleibt als Wiederherstellungspunkt erhalten.`,
          "postcondition-failed"
        );
      }
      await options.afterFileMoved?.({ source: file.source, target, sha256: file.expectedSha256 });
    }
    checkStopped();
    const remainingFiles = bound.slice(archiveArguments.length);
    const remainingInventory = await caseInventory(directory, options.profile);
    const remainingActual = remainingInventory.names.map((name) => name.toLowerCase()).sort();
    const remainingExpected = remainingArguments.map((entry) => entry.name.toLowerCase()).sort();
    if (remainingInventory.collision || remainingActual.length !== remainingExpected.length || remainingActual.some((name, index) => name !== remainingExpected[index]) || !directoryIdentity || !await directoryStillOwned(directory, directoryIdentity)) {
      throw new LocalFileError("Restbestand stimmt nach der Archivierung nicht mit expectedRemaining ueberein.", "postcondition-failed");
    }
    for (const file of remainingFiles) {
      if (!await sourcePathStillBound(file)) {
        throw new LocalFileError(`Resthash stimmt fuer '${file.actualName}' nicht.`, "postcondition-failed");
      }
    }
    if (!destinationIdentity || !await directoryHasExactEntries(
      destination,
      destinationIdentity,
      ["pruefsummen.csv", ...moved.map((entry) => entry.actualName)]
    )) {
      throw new LocalFileError("Archivziel wurde vor der Endfreigabe veraendert.", "postcondition-failed");
    }
    for (const file of moved) {
      if (!await filePathMatchesIdentityAndHash(file.target, file.targetIdentity, file.expectedSha256)) {
        throw new LocalFileError(`Archivhash stimmt fuer '${file.actualName}' nicht.`, "postcondition-failed");
      }
    }
    await Promise.all(bound.map((file) => file.handle.close().catch(() => void 0)));
    return localResult({
      ok: true,
      archived: moved.length,
      dest: destination,
      files: moved.map((entry) => ({ name: entry.actualName, sha256: entry.expectedSha256 })),
      remaining: remainingArguments.map((entry) => ({ name: entry.name, sha256: entry.expectedSha256 })),
      manifest: join8(destination, "pruefsummen.csv"),
      verified: true,
      recoverable: true
    });
  } catch (error) {
    const classified = error instanceof LocalOperationStopped ? error.result : error instanceof LocalFileError ? operationError(error.message, error.kind) : stopped();
    await manifestHandle?.close().catch(() => void 0);
    manifestHandle = void 0;
    const rollbackFiles = [];
    const retainedTargets = [];
    const recoveryFiles = [];
    for (const file of [...moved].reverse()) {
      let restoreError;
      let restored = false;
      try {
        if (!await pathExists3(file.source) && await hashOpenFile(file.handle) === file.expectedSha256) {
          const restoredCopy = await copyOpenFileToArchive(
            file.handle,
            file.source,
            file.expectedSha256,
            file.bytes,
            void 0,
            file.identity
          );
          await restoredCopy.handle.close();
          restored = true;
        }
      } catch (restoreFailure) {
        restoreError = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure);
      }
      const targetStillOriginal = await filePathMatchesIdentityAndHash(
        file.target,
        file.targetIdentity,
        file.expectedSha256
      );
      let recoveryPath;
      if (!restored && !targetStillOriginal) {
        recoveryPath = await preserveRecoveryCopy(file, directory, directoryIdentity);
        if (recoveryPath) recoveryFiles.push(recoveryPath);
      }
      const targetRemoval = restored ? await removeOwnedFile(
        file.target,
        file.targetIdentity,
        file.bytes,
        file.expectedSha256
      ).catch(() => ({ stillOwned: false, removed: false })) : { stillOwned: false, removed: false };
      if (!targetRemoval.removed && await pathExists3(file.target).catch(() => true)) retainedTargets.push(file.target);
      const sourceHash = restored ? await hashFilePath(file.source).catch(() => void 0) : void 0;
      rollbackFiles.push({
        name: file.actualName,
        restored: restored && sourceHash === file.expectedSha256,
        recoverable: restored || targetStillOriginal || Boolean(recoveryPath),
        sourceHash,
        targetExists: await pathExists3(file.target).catch(() => true),
        ...recoveryPath ? { recoveryPath } : {},
        ...restoreError ? { error: restoreError } : {}
      });
    }
    if (manifest) {
      const removal = manifest.complete ? await removeOwnedFile(manifest.path, manifest.identity, manifest.bytes, manifest.sha256) : await removeOwnedFilePrefix(manifest.path, manifest.identity, manifest.content);
      if (!removal.removed && await pathExists3(manifest.path).catch(() => true)) retainedTargets.push(manifest.path);
    }
    const destinationDirectory = createdDirectories.find((entry) => entry.path === destination);
    if (destinationDirectory?.identity && await directoryStillOwned(destination, destinationDirectory.identity)) {
      for (const name of await readdir4(destination).catch(() => [])) {
        const path = join8(destination, name);
        if (!retainedTargets.includes(path)) retainedTargets.push(path);
      }
    }
    for (const entry of [...createdDirectories].reverse()) {
      const retainedDescendant = retainedTargets.some((path) => isInside(entry.path, path));
      const removed = entry.identity && !retainedDescendant ? await removeOwnedEmptyDirectory(entry.path, entry.identity) : false;
      if (!removed && await pathExists3(entry.path).catch(() => true) && !retainedDescendant) retainedTargets.push(entry.path);
    }
    await Promise.all(bound.map((file) => file.handle.close().catch(() => void 0)));
    const allSourcesRestored = rollbackFiles.length === moved.length && rollbackFiles.every((entry) => entry.restored === true);
    const recoverable = rollbackFiles.every((entry) => entry.recoverable === true);
    const rolledBack = allSourcesRestored && retainedTargets.length === 0 && (await Promise.all(createdDirectories.map(async (entry) => !await pathExists3(entry.path).catch(() => true)))).every(Boolean);
    const baseMessage = classified?.error ?? (error instanceof Error ? error.message : String(error));
    return localResult({
      ok: false,
      kind: classified?.kind ?? (createdDirectories.length ? "postcondition-failed" : "worker"),
      error: retainedTargets.length ? `${baseMessage} Unbekannte oder veraenderte Archivziele blieben zur manuellen Klaerung erhalten.` : baseMessage,
      movedBeforeFailure: moved.length,
      rolledBack,
      rollbackFiles,
      recoveryFiles,
      recoverable,
      retainedTargets,
      archiveStillExists: destination ? await pathExists3(destination).catch(() => true) : false,
      ...destination ? { dest: destination } : {}
    });
  } finally {
    clearTimeout(timer);
    await manifestHandle?.close().catch(() => void 0);
    await Promise.all(bound.map((file) => file.handle.close().catch(() => void 0)));
  }
}
var init_archive_executor = __esm({
  "src/archive-executor.ts"() {
    "use strict";
    init_api_contract();
    init_archive_file_copy();
    init_case_file();
    init_executor_errors();
    init_file_identity();
    init_local_file_transaction();
    init_owned_file();
    init_sse_process_guard();
  }
});

// src/api-executor.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync3, readdirSync as readdirSync3, rmdirSync } from "node:fs";
import { dirname as dirname10, join as join9 } from "node:path";
import { performance as performance8 } from "node:perf_hooks";
function resourceRoots(config) {
  return {
    cases: config.caseDir,
    documents: config.documentsDir ?? join9(config.workspaceDir, "documents"),
    workspace: config.workspaceDir,
    results: config.resultDir,
    backups: config.backupsDir ?? join9(config.workspaceDir, "backups")
  };
}
function resolveAlias(args, resourceRefs, roots, alias, legacy, allowedAreas) {
  if (args[alias] === void 0) return;
  if (args[legacy] !== void 0) {
    throw new ExecutorArgumentError(`'${alias}' und '${legacy}' duerfen nicht gemeinsam angegeben werden.`);
  }
  if (typeof args[alias] !== "string") throw new ExecutorArgumentError(`'${alias}' muss eine Ressourcenreferenz sein.`);
  let resolved;
  try {
    resolved = resolveResourceReference(roots, args[alias], allowedAreas);
  } catch (error) {
    throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
  }
  delete args[alias];
  args[legacy] = resolved.path;
  resourceRefs[alias] = resolved.ref;
}
function resolveSaveCorrectionReferences(args, resourceRefs, roots) {
  if (args.correction === void 0) return;
  if (!args.correction || typeof args.correction !== "object" || Array.isArray(args.correction)) {
    throw new ExecutorArgumentError("'correction' muss ein Objekt sein.");
  }
  const correction = { ...args.correction };
  const bindings = [
    ["sourceRef", "sourcePath", ["cases"]],
    ["backupRef", "backupPath", ["backups"]]
  ];
  for (const [alias, workerField, allowedAreas] of bindings) {
    const value = correction[alias];
    if (typeof value !== "string") {
      throw new ExecutorArgumentError(`'correction.${alias}' muss eine Ressourcenreferenz sein.`);
    }
    let resolved;
    try {
      resolved = resolveResourceReference(roots, value, allowedAreas);
    } catch (error) {
      throw new ExecutorArgumentError(error instanceof Error ? error.message : String(error));
    }
    delete correction[alias];
    correction[workerField] = resolved.path;
    resourceRefs[`correction.${alias}`] = resolved.ref;
  }
  args.correction = correction;
}
function configuredArgs(operation, args, config) {
  const result = { ...args };
  const roots = resourceRoots(config);
  const resourceRefs = {};
  for (const binding of API_RESOURCE_BINDINGS[operation] ?? []) {
    resolveAlias(
      result,
      resourceRefs,
      roots,
      binding.alias,
      binding.workerField,
      binding.allowedAreas
    );
  }
  if (operation === "save") resolveSaveCorrectionReferences(result, resourceRefs, roots);
  if (operation === "receipt_manager_bulk_upsert") {
    resolveReceiptManagerBulkReferences(result, resourceRefs, roots);
  }
  if (operation === "launch" || operation === "desktop_start") {
    if (result.exe !== void 0) {
      throw new ExecutorArgumentError("'exe' wird ausschliesslich in der lokalen API-Konfiguration festgelegt.");
    }
    if (config.sseExecutable) result.exe = config.sseExecutable;
  }
  if ((operation === "list_cases" || operation === "backup_cases" || operation === "archive_cases") && result.dir === void 0 && config.caseDir) {
    result.dir = config.caseDir;
  }
  return { args: result, resourceRefs };
}
function withResourceIdentity4(redactPaths, result, resourceRefs = {}) {
  const redacted = redactPaths(result);
  if (!Object.keys(resourceRefs).length) return redacted;
  return { ...redacted, resourceRefs };
}
function executionError(operation, error) {
  const explicitKind = error && typeof error === "object" && typeof error.kind === "string" ? String(error.kind) : void 0;
  return {
    ok: false,
    kind: explicitKind ?? (error instanceof ZodError || error instanceof ExecutorArgumentError ? "bad-args" : operation.startsWith("workspace_") || operation === "scenario_run" ? "workspace" : "worker"),
    error: error instanceof Error ? error.message : String(error)
  };
}
function remainingTimeoutMs(timeoutMs, startedAt) {
  return Math.max(0, Math.floor(timeoutMs - (performance8.now() - startedAt)));
}
function isExperimentalDialogAnswerCandidate(operation, args) {
  return operation === "dialog_answer" && args.button === "OK";
}
function createApiExecutor(config, worker, dependencies = {}) {
  const roots = resourceRoots(config);
  const profilesRoot = dependencies.profilesRoot ?? defaultProfilesRoot;
  const profile = loadProductProfile(config.profileId, profilesRoot);
  ensureWorkspace(config.workspaceDir);
  ensureWorkspace(config.resultDir);
  ensureWorkspace(roots.documents);
  ensureWorkspace(roots.backups);
  const redactPaths = createResourcePathRedactor(roots);
  const receiptLease = /^[A-F0-9]{64}$/u.test(config.interactiveReceiptLeaseToken ?? "");
  const executeWorkerFallback = async (operation, configured, effectiveTimeoutMs, localStartedAt, timeoutError, signal) => {
    const fallbackTimeoutMs = remainingTimeoutMs(effectiveTimeoutMs, localStartedAt);
    if (fallbackTimeoutMs < MIN_WORKER_FALLBACK_TIMEOUT_MS) {
      return withResourceIdentity4(
        redactPaths,
        operationError(timeoutError, "timeout"),
        configured.resourceRefs
      );
    }
    const result = await worker(operation, configured.args, fallbackTimeoutMs, signal);
    return withResourceIdentity4(redactPaths, result, configured.resourceRefs);
  };
  const executeOperation = async (operation, args, timeoutMs, signal, internalCheckerClick = false, internalCheckerNavigation = false) => {
    try {
      if (profile.status === "disabled" && !EXPERIMENTAL_PROFILE_BASE.has(operation)) {
        return operationError(
          `Produktprofil '${profile.id}' ist deaktiviert; Betriebsoperationen sind gesperrt.`,
          "profile-disabled"
        );
      }
      const block = receiptBlock(operation, args, receiptLease);
      if (block) return block;
      const verificationOnlyProfile = profile.status !== "supported" || profile.operationAccess !== "full";
      if (verificationOnlyProfile && !EXPERIMENTAL_PROFILE_BASE.has(operation)) {
        if (config.operateExperimental !== true) {
          return operationError(
            `Produktprofil '${profile.id}' ist nicht vollstaendig freigegeben (status=${profile.status}, operationAccess=${profile.operationAccess}). Nur Katalog- und Dateiauskuenfte sind erlaubt. Fuer eine bewusste Jahresverifikation operateExperimental: true in der API-Konfiguration setzen.`,
            "profile-unverified"
          );
        }
        if (!EXPERIMENTAL_PROFILE_VERIFICATION.has(operation) && !internalCheckerNavigation && !isExperimentalDialogAnswerCandidate(operation, args)) {
          return operationError(
            `Operation '${operation}' ist fuer das eingeschraenkte Produktprofil '${profile.id}' nicht im expliziten Verifikationskatalog. operateExperimental erlaubt nur den geprueften Lese-, Navigations- und Disposable-Copy-Lebenszyklus.`,
            "profile-operation-unverified"
          );
        }
      }
      args = internalCheckerClick ? parseCheckerReadOnlyClickArgs(args) : parseApiOperationArgs(operation, args);
      if (operation === "capabilities") {
        return {
          ok: true,
          ...SSE_CAPABILITIES,
          profile: {
            id: profile.id,
            status: profile.status,
            operationAccess: profile.operationAccess,
            operateExperimental: config.operateExperimental === true,
            interactiveReceiptLeaseActive: receiptLease
          },
          operationPolicy: createProfileOperationMatrix(
            profile.status,
            profile.operationAccess,
            config.operateExperimental === true,
            receiptLease
          ),
          buildDriftPolicy: "block-ui-tax-mutations"
        };
      }
      if (operation === "workspace_status") {
        return readWorkspaceStatus({
          ...config,
          profileId: config.profileId ?? "2025",
          documentsDir: roots.documents,
          backupsDir: roots.backups
        });
      }
      if (operation === "page_objects") {
        const configured2 = configuredArgs(operation, args, config);
        const local = executeLocalPageObjects({
          profileId: profile.id,
          profilesRoot,
          args: configured2.args,
          timeoutMs,
          ...signal ? { signal } : {},
          redactPaths
        });
        if (local.kind === "result") return local.result;
        return await executeWorkerFallback(
          operation,
          configured2,
          local.effectiveTimeoutMs,
          local.localStartedAt,
          "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback des Page-Object-Katalogs.",
          signal
        );
      }
      if (operation === "verify") {
        const configured2 = configuredArgs(operation, args, config);
        const local = await executeLocalVerify({
          args: configured2.args,
          resourceRefs: configured2.resourceRefs,
          timeoutMs,
          ...signal ? { signal } : {},
          redactPaths
        });
        if (local.kind === "result") return local.result;
        return await executeWorkerFallback(
          operation,
          configured2,
          local.effectiveTimeoutMs,
          local.localStartedAt,
          "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback der Collect-Verifikation.",
          signal
        );
      }
      if (operation === "make_working_copy") {
        const configured2 = configuredArgs(operation, args, config);
        return await executeLocalWorkingCopy({
          args: configured2.args,
          resourceRefs: configured2.resourceRefs,
          profile,
          timeoutMs,
          ...signal ? { signal } : {},
          redactPaths
        });
      }
      if (operation === "backup_cases") {
        const configured2 = configuredArgs(operation, args, config);
        return await executeLocalBackup({
          args: configured2.args,
          resourceRefs: configured2.resourceRefs,
          profile,
          timeoutMs,
          ...signal ? { signal } : {},
          redactPaths
        });
      }
      if (operation === "archive_cases") {
        const configured2 = configuredArgs(operation, args, config);
        return await executeLocalArchive({
          args: configured2.args,
          resourceRefs: configured2.resourceRefs,
          profile,
          timeoutMs,
          ...signal ? { signal } : {},
          redactPaths,
          ...dependencies.archiveHasRunningSseProcess ? { hasRunningSseProcess: dependencies.archiveHasRunningSseProcess } : {}
        });
      }
      if (isWorkspaceExecutorOperation(operation)) {
        return await executeWorkspaceOperation(operation, args, {
          roots,
          workspaceDir: config.workspaceDir,
          resultDir: config.resultDir,
          timeoutMs,
          ...signal ? { signal } : {},
          execute,
          redactPaths
        });
      }
      if (operation === "checker_open") {
        const configured2 = configuredArgs(operation, args, config);
        return redactPaths(await executeCheckerOpen(
          configured2.args,
          timeoutMs,
          signal,
          (privateOperation, privateArgs, privateTimeoutMs, privateSignal) => worker(
            privateOperation,
            privateArgs,
            privateTimeoutMs,
            privateSignal
          )
        ));
      }
      if (isUstvaOperation(operation)) {
        return await executeUstvaOperation(operation, args, timeoutMs, signal, executeOperation);
      }
      if (operation === "case_create") {
        return redactPaths(await executeCaseCreate(args, timeoutMs, signal, {
          execute: executeOperation,
          worker,
          resolveTarget: (raw) => {
            const configured2 = configuredArgs("case_create", raw, config);
            return { path: String(configured2.args.targetPath ?? ""), ref: configured2.resourceRefs.targetRef ?? "" };
          },
          profile
        }));
      }
      if (operation === "fill_fields") {
        return await executeFillFieldsPlan(args, timeoutMs, signal, {
          pageObjectsCatalog: profile.pageObjectsCatalog,
          configure: (nestedOperation, nestedArgs) => configuredArgs(nestedOperation, nestedArgs, config),
          worker,
          finish: (result2, resourceRefs) => withResourceIdentity4(redactPaths, result2, resourceRefs),
          executionError
        });
      }
      if (operation === "receipt_manager_bulk_upsert") {
        const configured2 = configuredArgs(operation, args, config);
        return await executeReceiptManagerBulkPlan(args, configured2, timeoutMs, signal, {
          worker,
          finish: (result2, resourceRefs) => withResourceIdentity4(redactPaths, result2, resourceRefs),
          executionError
        });
      }
      const configured = configuredArgs(operation, args, config);
      if (internalCheckerNavigation) {
        configured.args.experimentalCheckerNavigation = true;
      }
      if (operation === "screenshot" && typeof configured.args.path === "string" && existsSync9(configured.args.path)) {
        throw new ExecutorArgumentError(
          "Screenshot-Zieldatei existiert bereits; fuer Kontrollbilder immer eine neue results:-Referenz verwenden."
        );
      }
      if (operation === "launch") {
        const result2 = await executeLaunchOperation(configured.args, timeoutMs, signal, worker);
        return withResourceIdentity4(redactPaths, result2, configured.resourceRefs);
      }
      if (operation === "list_cases" && configured.args.verbose !== true && typeof configured.args.dir === "string" && existsSync9(configured.args.dir)) {
        const effectiveTimeoutMs = timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
        const localStartedAt = performance8.now();
        try {
          const result2 = await listCaseFiles(configured.args.dir, profile, {
            includeBackups: configured.args.includeBackups === true,
            timeoutMs: effectiveTimeoutMs,
            ...signal ? { signal } : {}
          });
          return withResourceIdentity4(redactPaths, result2, configured.resourceRefs);
        } catch (error) {
          if (!(error instanceof CaseFileParserFallbackError)) {
            return withResourceIdentity4(redactPaths, executionError(operation, error), configured.resourceRefs);
          }
          return await executeWorkerFallback(
            operation,
            configured,
            effectiveTimeoutMs,
            localStartedAt,
            "Verbleibendes Zeitbudget reicht nicht fuer einen sicheren Worker-Fallback der Fallliste.",
            signal
          );
        }
      }
      if (operation === "case_hash") {
        const path = configured.args.path;
        if (typeof path !== "string") throw new ExecutorArgumentError("'path' fehlt.");
        try {
          const result2 = await readCaseFileInfo(path, profile, {
            ...timeoutMs === void 0 ? {} : { timeoutMs },
            ...signal ? { signal } : {}
          });
          return withResourceIdentity4(redactPaths, result2, configured.resourceRefs);
        } catch (error) {
          return withResourceIdentity4(redactPaths, executionError(operation, error), configured.resourceRefs);
        }
      }
      let createdExportDirectory;
      if (operation === "export_csv" && typeof configured.args.dir === "string" && configured.resourceRefs.resultRef?.startsWith("results:") && !existsSync9(configured.args.dir)) {
        const firstCreatedDirectory = mkdirSync3(configured.args.dir, { recursive: true });
        if (firstCreatedDirectory === void 0) {
          throw new ExecutorArgumentError(
            "CSV-Ergebnisordner erschien waehrend des Preflights; fremdes Ziel wird nicht verwendet."
          );
        }
        createdExportDirectory = firstCreatedDirectory;
      }
      let result;
      try {
        result = await worker(operation, configured.args, timeoutMs, signal);
      } finally {
        if (createdExportDirectory && result?.ok !== true) {
          try {
            let candidate = configured.args.dir;
            while (typeof candidate === "string" && existsSync9(candidate) && readdirSync3(candidate).length === 0) {
              rmdirSync(candidate);
              if (candidate === createdExportDirectory) break;
              candidate = dirname10(candidate);
            }
          } catch {
          }
        }
      }
      return withResourceIdentity4(redactPaths, result, configured.resourceRefs);
    } catch (error) {
      return redactPaths(executionError(operation, error));
    }
  };
  const execute = (operation, args, timeoutMs, signal) => executeOperation(operation, args, timeoutMs, signal, false, false);
  return execute;
}
var MIN_WORKER_FALLBACK_TIMEOUT_MS, EXPERIMENTAL_PROFILE_BASE, EXPERIMENTAL_PROFILE_VERIFICATION;
var init_api_executor = __esm({
  "src/api-executor.ts"() {
    "use strict";
    init_api_contract();
    init_zod();
    init_capabilities();
    init_case_file();
    init_checker_executor();
    init_bulk_plan_executor();
    init_api_resource_bindings();
    init_case_create_executor();
    init_executor_errors();
    init_launch_executor();
    init_operation_catalog();
    init_receipt_interaction_policy();
    init_profile_operation_policy();
    init_product_profiles();
    init_page_objects_executor();
    init_ustva_executor();
    init_resources();
    init_workspace();
    init_workspace_executor();
    init_workspace_status();
    init_verify_executor();
    init_working_copy_executor();
    init_backup_executor();
    init_archive_executor();
    init_api_resource_bindings();
    init_profile_operation_policy();
    MIN_WORKER_FALLBACK_TIMEOUT_MS = 2e3;
    EXPERIMENTAL_PROFILE_BASE = new Set(EXPERIMENTAL_PROFILE_BASE_OPERATIONS);
    EXPERIMENTAL_PROFILE_VERIFICATION = new Set(
      EXPERIMENTAL_PROFILE_VERIFICATION_OPERATIONS
    );
  }
});

// node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride, defaultOptions, getDefaultOptions;
var init_Options = __esm({
  "node_modules/zod-to-json-schema/dist/esm/Options.js"() {
    ignoreOverride = /* @__PURE__ */ Symbol("Let zodToJsonSchema decide on which parser to use");
    defaultOptions = {
      name: void 0,
      $refStrategy: "root",
      basePath: ["#"],
      effectStrategy: "input",
      pipeStrategy: "all",
      dateStrategy: "format:date-time",
      mapStrategy: "entries",
      removeAdditionalStrategy: "passthrough",
      allowedAdditionalProperties: true,
      rejectedAdditionalProperties: false,
      definitionPath: "definitions",
      target: "jsonSchema7",
      strictUnions: false,
      definitions: {},
      errorMessages: false,
      markdownDescription: false,
      patternStrategy: "escape",
      applyRegexFlags: false,
      emailStrategy: "format:email",
      base64Strategy: "contentEncoding:base64",
      nameStrategy: "ref",
      openAiAnyTypeName: "OpenAiAnyType"
    };
    getDefaultOptions = (options) => typeof options === "string" ? {
      ...defaultOptions,
      name: options
    } : {
      ...defaultOptions,
      ...options
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/Refs.js
var getRefs;
var init_Refs = __esm({
  "node_modules/zod-to-json-schema/dist/esm/Refs.js"() {
    init_Options();
    getRefs = (options) => {
      const _options = getDefaultOptions(options);
      const currentPath = _options.name !== void 0 ? [..._options.basePath, _options.definitionPath, _options.name] : _options.basePath;
      return {
        ..._options,
        flags: { hasReferencedOpenAiAnyType: false },
        currentPath,
        propertyPath: void 0,
        seen: new Map(Object.entries(_options.definitions).map(([name, def]) => [
          def._def,
          {
            def: def._def,
            path: [..._options.basePath, _options.definitionPath, name],
            // Resolution of references will be forced even though seen, so it's ok that the schema is undefined here for now.
            jsonSchema: void 0
          }
        ]))
      };
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/errorMessages.js
function addErrorMessage(res, key, errorMessage, refs) {
  if (!refs?.errorMessages)
    return;
  if (errorMessage) {
    res.errorMessage = {
      ...res.errorMessage,
      [key]: errorMessage
    };
  }
}
function setResponseValueAndErrors(res, key, value, errorMessage, refs) {
  res[key] = value;
  addErrorMessage(res, key, errorMessage, refs);
}
var init_errorMessages = __esm({
  "node_modules/zod-to-json-schema/dist/esm/errorMessages.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/getRelativePath.js
var getRelativePath;
var init_getRelativePath = __esm({
  "node_modules/zod-to-json-schema/dist/esm/getRelativePath.js"() {
    getRelativePath = (pathA, pathB) => {
      let i = 0;
      for (; i < pathA.length && i < pathB.length; i++) {
        if (pathA[i] !== pathB[i])
          break;
      }
      return [(pathA.length - i).toString(), ...pathB.slice(i)].join("/");
    };
  }
});

// node_modules/zod/v3/index.js
var init_v3 = __esm({
  "node_modules/zod/v3/index.js"() {
    init_external();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/any.js
function parseAnyDef(refs) {
  if (refs.target !== "openAi") {
    return {};
  }
  const anyDefinitionPath = [
    ...refs.basePath,
    refs.definitionPath,
    refs.openAiAnyTypeName
  ];
  refs.flags.hasReferencedOpenAiAnyType = true;
  return {
    $ref: refs.$refStrategy === "relative" ? getRelativePath(anyDefinitionPath, refs.currentPath) : anyDefinitionPath.join("/")
  };
}
var init_any = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/any.js"() {
    init_getRelativePath();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/array.js
function parseArrayDef(def, refs) {
  const res = {
    type: "array"
  };
  if (def.type?._def && def.type?._def?.typeName !== ZodFirstPartyTypeKind.ZodAny) {
    res.items = parseDef(def.type._def, {
      ...refs,
      currentPath: [...refs.currentPath, "items"]
    });
  }
  if (def.minLength) {
    setResponseValueAndErrors(res, "minItems", def.minLength.value, def.minLength.message, refs);
  }
  if (def.maxLength) {
    setResponseValueAndErrors(res, "maxItems", def.maxLength.value, def.maxLength.message, refs);
  }
  if (def.exactLength) {
    setResponseValueAndErrors(res, "minItems", def.exactLength.value, def.exactLength.message, refs);
    setResponseValueAndErrors(res, "maxItems", def.exactLength.value, def.exactLength.message, refs);
  }
  return res;
}
var init_array = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/array.js"() {
    init_v3();
    init_errorMessages();
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
function parseBigintDef(def, refs) {
  const res = {
    type: "integer",
    format: "int64"
  };
  if (!def.checks)
    return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMinimum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMinimum = true;
          }
          setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
        }
        break;
      case "max":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMaximum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMaximum = true;
          }
          setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
        }
        break;
      case "multipleOf":
        setResponseValueAndErrors(res, "multipleOf", check.value, check.message, refs);
        break;
    }
  }
  return res;
}
var init_bigint = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js"() {
    init_errorMessages();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js
function parseBooleanDef() {
  return {
    type: "boolean"
  };
}
var init_boolean = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
function parseBrandedDef(_def, refs) {
  return parseDef(_def.type._def, refs);
}
var init_branded = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/branded.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var parseCatchDef;
var init_catch = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/catch.js"() {
    init_parseDef();
    parseCatchDef = (def, refs) => {
      return parseDef(def.innerType._def, refs);
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/date.js
function parseDateDef(def, refs, overrideDateStrategy) {
  const strategy = overrideDateStrategy ?? refs.dateStrategy;
  if (Array.isArray(strategy)) {
    return {
      anyOf: strategy.map((item, i) => parseDateDef(def, refs, item))
    };
  }
  switch (strategy) {
    case "string":
    case "format:date-time":
      return {
        type: "string",
        format: "date-time"
      };
    case "format:date":
      return {
        type: "string",
        format: "date"
      };
    case "integer":
      return integerDateParser(def, refs);
  }
}
var integerDateParser;
var init_date = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/date.js"() {
    init_errorMessages();
    integerDateParser = (def, refs) => {
      const res = {
        type: "integer",
        format: "unix-time"
      };
      if (refs.target === "openApi3") {
        return res;
      }
      for (const check of def.checks) {
        switch (check.kind) {
          case "min":
            setResponseValueAndErrors(
              res,
              "minimum",
              check.value,
              // This is in milliseconds
              check.message,
              refs
            );
            break;
          case "max":
            setResponseValueAndErrors(
              res,
              "maximum",
              check.value,
              // This is in milliseconds
              check.message,
              refs
            );
            break;
        }
      }
      return res;
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/default.js
function parseDefaultDef(_def, refs) {
  return {
    ...parseDef(_def.innerType._def, refs),
    default: _def.defaultValue()
  };
}
var init_default = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/default.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
function parseEffectsDef(_def, refs) {
  return refs.effectStrategy === "input" ? parseDef(_def.schema._def, refs) : parseAnyDef(refs);
}
var init_effects = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/effects.js"() {
    init_parseDef();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/enum.js
function parseEnumDef(def) {
  return {
    type: "string",
    enum: Array.from(def.values)
  };
}
var init_enum = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/enum.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
function parseIntersectionDef(def, refs) {
  const allOf = [
    parseDef(def.left._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "0"]
    }),
    parseDef(def.right._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "1"]
    })
  ].filter((x) => !!x);
  let unevaluatedProperties = refs.target === "jsonSchema2019-09" ? { unevaluatedProperties: false } : void 0;
  const mergedAllOf = [];
  allOf.forEach((schema) => {
    if (isJsonSchema7AllOfType(schema)) {
      mergedAllOf.push(...schema.allOf);
      if (schema.unevaluatedProperties === void 0) {
        unevaluatedProperties = void 0;
      }
    } else {
      let nestedSchema = schema;
      if ("additionalProperties" in schema && schema.additionalProperties === false) {
        const { additionalProperties, ...rest } = schema;
        nestedSchema = rest;
      } else {
        unevaluatedProperties = void 0;
      }
      mergedAllOf.push(nestedSchema);
    }
  });
  return mergedAllOf.length ? {
    allOf: mergedAllOf,
    ...unevaluatedProperties
  } : void 0;
}
var isJsonSchema7AllOfType;
var init_intersection = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js"() {
    init_parseDef();
    isJsonSchema7AllOfType = (type) => {
      if ("type" in type && type.type === "string")
        return false;
      return "allOf" in type;
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/literal.js
function parseLiteralDef(def, refs) {
  const parsedType = typeof def.value;
  if (parsedType !== "bigint" && parsedType !== "number" && parsedType !== "boolean" && parsedType !== "string") {
    return {
      type: Array.isArray(def.value) ? "array" : "object"
    };
  }
  if (refs.target === "openApi3") {
    return {
      type: parsedType === "bigint" ? "integer" : parsedType,
      enum: [def.value]
    };
  }
  return {
    type: parsedType === "bigint" ? "integer" : parsedType,
    const: def.value
  };
}
var init_literal = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/literal.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/string.js
function parseStringDef(def, refs) {
  const res = {
    type: "string"
  };
  if (def.checks) {
    for (const check of def.checks) {
      switch (check.kind) {
        case "min":
          setResponseValueAndErrors(res, "minLength", typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value, check.message, refs);
          break;
        case "max":
          setResponseValueAndErrors(res, "maxLength", typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value, check.message, refs);
          break;
        case "email":
          switch (refs.emailStrategy) {
            case "format:email":
              addFormat(res, "email", check.message, refs);
              break;
            case "format:idn-email":
              addFormat(res, "idn-email", check.message, refs);
              break;
            case "pattern:zod":
              addPattern(res, zodPatterns.email, check.message, refs);
              break;
          }
          break;
        case "url":
          addFormat(res, "uri", check.message, refs);
          break;
        case "uuid":
          addFormat(res, "uuid", check.message, refs);
          break;
        case "regex":
          addPattern(res, check.regex, check.message, refs);
          break;
        case "cuid":
          addPattern(res, zodPatterns.cuid, check.message, refs);
          break;
        case "cuid2":
          addPattern(res, zodPatterns.cuid2, check.message, refs);
          break;
        case "startsWith":
          addPattern(res, RegExp(`^${escapeLiteralCheckValue(check.value, refs)}`), check.message, refs);
          break;
        case "endsWith":
          addPattern(res, RegExp(`${escapeLiteralCheckValue(check.value, refs)}$`), check.message, refs);
          break;
        case "datetime":
          addFormat(res, "date-time", check.message, refs);
          break;
        case "date":
          addFormat(res, "date", check.message, refs);
          break;
        case "time":
          addFormat(res, "time", check.message, refs);
          break;
        case "duration":
          addFormat(res, "duration", check.message, refs);
          break;
        case "length":
          setResponseValueAndErrors(res, "minLength", typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value, check.message, refs);
          setResponseValueAndErrors(res, "maxLength", typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value, check.message, refs);
          break;
        case "includes": {
          addPattern(res, RegExp(escapeLiteralCheckValue(check.value, refs)), check.message, refs);
          break;
        }
        case "ip": {
          if (check.version !== "v6") {
            addFormat(res, "ipv4", check.message, refs);
          }
          if (check.version !== "v4") {
            addFormat(res, "ipv6", check.message, refs);
          }
          break;
        }
        case "base64url":
          addPattern(res, zodPatterns.base64url, check.message, refs);
          break;
        case "jwt":
          addPattern(res, zodPatterns.jwt, check.message, refs);
          break;
        case "cidr": {
          if (check.version !== "v6") {
            addPattern(res, zodPatterns.ipv4Cidr, check.message, refs);
          }
          if (check.version !== "v4") {
            addPattern(res, zodPatterns.ipv6Cidr, check.message, refs);
          }
          break;
        }
        case "emoji":
          addPattern(res, zodPatterns.emoji(), check.message, refs);
          break;
        case "ulid": {
          addPattern(res, zodPatterns.ulid, check.message, refs);
          break;
        }
        case "base64": {
          switch (refs.base64Strategy) {
            case "format:binary": {
              addFormat(res, "binary", check.message, refs);
              break;
            }
            case "contentEncoding:base64": {
              setResponseValueAndErrors(res, "contentEncoding", "base64", check.message, refs);
              break;
            }
            case "pattern:zod": {
              addPattern(res, zodPatterns.base64, check.message, refs);
              break;
            }
          }
          break;
        }
        case "nanoid": {
          addPattern(res, zodPatterns.nanoid, check.message, refs);
        }
        case "toLowerCase":
        case "toUpperCase":
        case "trim":
          break;
        default:
          /* @__PURE__ */ ((_) => {
          })(check);
      }
    }
  }
  return res;
}
function escapeLiteralCheckValue(literal, refs) {
  return refs.patternStrategy === "escape" ? escapeNonAlphaNumeric(literal) : literal;
}
function escapeNonAlphaNumeric(source) {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (!ALPHA_NUMERIC.has(source[i])) {
      result += "\\";
    }
    result += source[i];
  }
  return result;
}
function addFormat(schema, value, message, refs) {
  if (schema.format || schema.anyOf?.some((x) => x.format)) {
    if (!schema.anyOf) {
      schema.anyOf = [];
    }
    if (schema.format) {
      schema.anyOf.push({
        format: schema.format,
        ...schema.errorMessage && refs.errorMessages && {
          errorMessage: { format: schema.errorMessage.format }
        }
      });
      delete schema.format;
      if (schema.errorMessage) {
        delete schema.errorMessage.format;
        if (Object.keys(schema.errorMessage).length === 0) {
          delete schema.errorMessage;
        }
      }
    }
    schema.anyOf.push({
      format: value,
      ...message && refs.errorMessages && { errorMessage: { format: message } }
    });
  } else {
    setResponseValueAndErrors(schema, "format", value, message, refs);
  }
}
function addPattern(schema, regex, message, refs) {
  if (schema.pattern || schema.allOf?.some((x) => x.pattern)) {
    if (!schema.allOf) {
      schema.allOf = [];
    }
    if (schema.pattern) {
      schema.allOf.push({
        pattern: schema.pattern,
        ...schema.errorMessage && refs.errorMessages && {
          errorMessage: { pattern: schema.errorMessage.pattern }
        }
      });
      delete schema.pattern;
      if (schema.errorMessage) {
        delete schema.errorMessage.pattern;
        if (Object.keys(schema.errorMessage).length === 0) {
          delete schema.errorMessage;
        }
      }
    }
    schema.allOf.push({
      pattern: stringifyRegExpWithFlags(regex, refs),
      ...message && refs.errorMessages && { errorMessage: { pattern: message } }
    });
  } else {
    setResponseValueAndErrors(schema, "pattern", stringifyRegExpWithFlags(regex, refs), message, refs);
  }
}
function stringifyRegExpWithFlags(regex, refs) {
  if (!refs.applyRegexFlags || !regex.flags) {
    return regex.source;
  }
  const flags = {
    i: regex.flags.includes("i"),
    m: regex.flags.includes("m"),
    s: regex.flags.includes("s")
    // `.` matches newlines
  };
  const source = flags.i ? regex.source.toLowerCase() : regex.source;
  let pattern = "";
  let isEscaped = false;
  let inCharGroup = false;
  let inCharRange = false;
  for (let i = 0; i < source.length; i++) {
    if (isEscaped) {
      pattern += source[i];
      isEscaped = false;
      continue;
    }
    if (flags.i) {
      if (inCharGroup) {
        if (source[i].match(/[a-z]/)) {
          if (inCharRange) {
            pattern += source[i];
            pattern += `${source[i - 2]}-${source[i]}`.toUpperCase();
            inCharRange = false;
          } else if (source[i + 1] === "-" && source[i + 2]?.match(/[a-z]/)) {
            pattern += source[i];
            inCharRange = true;
          } else {
            pattern += `${source[i]}${source[i].toUpperCase()}`;
          }
          continue;
        }
      } else if (source[i].match(/[a-z]/)) {
        pattern += `[${source[i]}${source[i].toUpperCase()}]`;
        continue;
      }
    }
    if (flags.m) {
      if (source[i] === "^") {
        pattern += `(^|(?<=[\r
]))`;
        continue;
      } else if (source[i] === "$") {
        pattern += `($|(?=[\r
]))`;
        continue;
      }
    }
    if (flags.s && source[i] === ".") {
      pattern += inCharGroup ? `${source[i]}\r
` : `[${source[i]}\r
]`;
      continue;
    }
    pattern += source[i];
    if (source[i] === "\\") {
      isEscaped = true;
    } else if (inCharGroup && source[i] === "]") {
      inCharGroup = false;
    } else if (!inCharGroup && source[i] === "[") {
      inCharGroup = true;
    }
  }
  try {
    new RegExp(pattern);
  } catch {
    console.warn(`Could not convert regex pattern at ${refs.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`);
    return regex.source;
  }
  return pattern;
}
var emojiRegex2, zodPatterns, ALPHA_NUMERIC;
var init_string = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/string.js"() {
    init_errorMessages();
    emojiRegex2 = void 0;
    zodPatterns = {
      /**
       * `c` was changed to `[cC]` to replicate /i flag
       */
      cuid: /^[cC][^\s-]{8,}$/,
      cuid2: /^[0-9a-z]+$/,
      ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
      /**
       * `a-z` was added to replicate /i flag
       */
      email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
      /**
       * Constructed a valid Unicode RegExp
       *
       * Lazily instantiate since this type of regex isn't supported
       * in all envs (e.g. React Native).
       *
       * See:
       * https://github.com/colinhacks/zod/issues/2433
       * Fix in Zod:
       * https://github.com/colinhacks/zod/commit/9340fd51e48576a75adc919bff65dbc4a5d4c99b
       */
      emoji: () => {
        if (emojiRegex2 === void 0) {
          emojiRegex2 = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u");
        }
        return emojiRegex2;
      },
      /**
       * Unused
       */
      uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
      /**
       * Unused
       */
      ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
      ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
      /**
       * Unused
       */
      ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
      ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
      base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
      base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
      nanoid: /^[a-zA-Z0-9_-]{21}$/,
      jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
    };
    ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/record.js
function parseRecordDef(def, refs) {
  if (refs.target === "openAi") {
    console.warn("Warning: OpenAI may not support records in schemas! Try an array of key-value pairs instead.");
  }
  if (refs.target === "openApi3" && def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      type: "object",
      required: def.keyType._def.values,
      properties: def.keyType._def.values.reduce((acc, key) => ({
        ...acc,
        [key]: parseDef(def.valueType._def, {
          ...refs,
          currentPath: [...refs.currentPath, "properties", key]
        }) ?? parseAnyDef(refs)
      }), {}),
      additionalProperties: refs.rejectedAdditionalProperties
    };
  }
  const schema = {
    type: "object",
    additionalProperties: parseDef(def.valueType._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    }) ?? refs.allowedAdditionalProperties
  };
  if (refs.target === "openApi3") {
    return schema;
  }
  if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.checks?.length) {
    const { type, ...keyType } = parseStringDef(def.keyType._def, refs);
    return {
      ...schema,
      propertyNames: keyType
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      ...schema,
      propertyNames: {
        enum: def.keyType._def.values
      }
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodBranded && def.keyType._def.type._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.type._def.checks?.length) {
    const { type, ...keyType } = parseBrandedDef(def.keyType._def, refs);
    return {
      ...schema,
      propertyNames: keyType
    };
  }
  return schema;
}
var init_record = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/record.js"() {
    init_v3();
    init_parseDef();
    init_string();
    init_branded();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/map.js
function parseMapDef(def, refs) {
  if (refs.mapStrategy === "record") {
    return parseRecordDef(def, refs);
  }
  const keys = parseDef(def.keyType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "0"]
  }) || parseAnyDef(refs);
  const values = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "1"]
  }) || parseAnyDef(refs);
  return {
    type: "array",
    maxItems: 125,
    items: {
      type: "array",
      items: [keys, values],
      minItems: 2,
      maxItems: 2
    }
  };
}
var init_map = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/map.js"() {
    init_parseDef();
    init_record();
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js
function parseNativeEnumDef(def) {
  const object = def.values;
  const actualKeys = Object.keys(def.values).filter((key) => {
    return typeof object[object[key]] !== "number";
  });
  const actualValues = actualKeys.map((key) => object[key]);
  const parsedTypes = Array.from(new Set(actualValues.map((values) => typeof values)));
  return {
    type: parsedTypes.length === 1 ? parsedTypes[0] === "string" ? "string" : "number" : ["string", "number"],
    enum: actualValues
  };
}
var init_nativeEnum = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/never.js
function parseNeverDef(refs) {
  return refs.target === "openAi" ? void 0 : {
    not: parseAnyDef({
      ...refs,
      currentPath: [...refs.currentPath, "not"]
    })
  };
}
var init_never = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/never.js"() {
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/null.js
function parseNullDef(refs) {
  return refs.target === "openApi3" ? {
    enum: ["null"],
    nullable: true
  } : {
    type: "null"
  };
}
var init_null = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/null.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/union.js
function parseUnionDef(def, refs) {
  if (refs.target === "openApi3")
    return asAnyOf(def, refs);
  const options = def.options instanceof Map ? Array.from(def.options.values()) : def.options;
  if (options.every((x) => x._def.typeName in primitiveMappings && (!x._def.checks || !x._def.checks.length))) {
    const types = options.reduce((types2, x) => {
      const type = primitiveMappings[x._def.typeName];
      return type && !types2.includes(type) ? [...types2, type] : types2;
    }, []);
    return {
      type: types.length > 1 ? types : types[0]
    };
  } else if (options.every((x) => x._def.typeName === "ZodLiteral" && !x.description)) {
    const types = options.reduce((acc, x) => {
      const type = typeof x._def.value;
      switch (type) {
        case "string":
        case "number":
        case "boolean":
          return [...acc, type];
        case "bigint":
          return [...acc, "integer"];
        case "object":
          if (x._def.value === null)
            return [...acc, "null"];
        case "symbol":
        case "undefined":
        case "function":
        default:
          return acc;
      }
    }, []);
    if (types.length === options.length) {
      const uniqueTypes = types.filter((x, i, a) => a.indexOf(x) === i);
      return {
        type: uniqueTypes.length > 1 ? uniqueTypes : uniqueTypes[0],
        enum: options.reduce((acc, x) => {
          return acc.includes(x._def.value) ? acc : [...acc, x._def.value];
        }, [])
      };
    }
  } else if (options.every((x) => x._def.typeName === "ZodEnum")) {
    return {
      type: "string",
      enum: options.reduce((acc, x) => [
        ...acc,
        ...x._def.values.filter((x2) => !acc.includes(x2))
      ], [])
    };
  }
  return asAnyOf(def, refs);
}
var primitiveMappings, asAnyOf;
var init_union = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/union.js"() {
    init_parseDef();
    primitiveMappings = {
      ZodString: "string",
      ZodNumber: "number",
      ZodBigInt: "integer",
      ZodBoolean: "boolean",
      ZodNull: "null"
    };
    asAnyOf = (def, refs) => {
      const anyOf = (def.options instanceof Map ? Array.from(def.options.values()) : def.options).map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "anyOf", `${i}`]
      })).filter((x) => !!x && (!refs.strictUnions || typeof x === "object" && Object.keys(x).length > 0));
      return anyOf.length ? { anyOf } : void 0;
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
function parseNullableDef(def, refs) {
  if (["ZodString", "ZodNumber", "ZodBigInt", "ZodBoolean", "ZodNull"].includes(def.innerType._def.typeName) && (!def.innerType._def.checks || !def.innerType._def.checks.length)) {
    if (refs.target === "openApi3") {
      return {
        type: primitiveMappings[def.innerType._def.typeName],
        nullable: true
      };
    }
    return {
      type: [
        primitiveMappings[def.innerType._def.typeName],
        "null"
      ]
    };
  }
  if (refs.target === "openApi3") {
    const base2 = parseDef(def.innerType._def, {
      ...refs,
      currentPath: [...refs.currentPath]
    });
    if (base2 && "$ref" in base2)
      return { allOf: [base2], nullable: true };
    return base2 && { ...base2, nullable: true };
  }
  const base = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "0"]
  });
  return base && { anyOf: [base, { type: "null" }] };
}
var init_nullable = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js"() {
    init_parseDef();
    init_union();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/number.js
function parseNumberDef(def, refs) {
  const res = {
    type: "number"
  };
  if (!def.checks)
    return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "int":
        res.type = "integer";
        addErrorMessage(res, "type", check.message, refs);
        break;
      case "min":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMinimum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMinimum = true;
          }
          setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
        }
        break;
      case "max":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMaximum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMaximum = true;
          }
          setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
        }
        break;
      case "multipleOf":
        setResponseValueAndErrors(res, "multipleOf", check.value, check.message, refs);
        break;
    }
  }
  return res;
}
var init_number = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/number.js"() {
    init_errorMessages();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/object.js
function parseObjectDef(def, refs) {
  const forceOptionalIntoNullable = refs.target === "openAi";
  const result = {
    type: "object",
    properties: {}
  };
  const required = [];
  const shape = def.shape();
  for (const propName in shape) {
    let propDef = shape[propName];
    if (propDef === void 0 || propDef._def === void 0) {
      continue;
    }
    let propOptional = safeIsOptional(propDef);
    if (propOptional && forceOptionalIntoNullable) {
      if (propDef._def.typeName === "ZodOptional") {
        propDef = propDef._def.innerType;
      }
      if (!propDef.isNullable()) {
        propDef = propDef.nullable();
      }
      propOptional = false;
    }
    const parsedDef = parseDef(propDef._def, {
      ...refs,
      currentPath: [...refs.currentPath, "properties", propName],
      propertyPath: [...refs.currentPath, "properties", propName]
    });
    if (parsedDef === void 0) {
      continue;
    }
    result.properties[propName] = parsedDef;
    if (!propOptional) {
      required.push(propName);
    }
  }
  if (required.length) {
    result.required = required;
  }
  const additionalProperties = decideAdditionalProperties(def, refs);
  if (additionalProperties !== void 0) {
    result.additionalProperties = additionalProperties;
  }
  return result;
}
function decideAdditionalProperties(def, refs) {
  if (def.catchall._def.typeName !== "ZodNever") {
    return parseDef(def.catchall._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    });
  }
  switch (def.unknownKeys) {
    case "passthrough":
      return refs.allowedAdditionalProperties;
    case "strict":
      return refs.rejectedAdditionalProperties;
    case "strip":
      return refs.removeAdditionalStrategy === "strict" ? refs.allowedAdditionalProperties : refs.rejectedAdditionalProperties;
  }
}
function safeIsOptional(schema) {
  try {
    return schema.isOptional();
  } catch {
    return true;
  }
}
var init_object = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/object.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var parseOptionalDef;
var init_optional = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/optional.js"() {
    init_parseDef();
    init_any();
    parseOptionalDef = (def, refs) => {
      if (refs.currentPath.toString() === refs.propertyPath?.toString()) {
        return parseDef(def.innerType._def, refs);
      }
      const innerSchema = parseDef(def.innerType._def, {
        ...refs,
        currentPath: [...refs.currentPath, "anyOf", "1"]
      });
      return innerSchema ? {
        anyOf: [
          {
            not: parseAnyDef(refs)
          },
          innerSchema
        ]
      } : parseAnyDef(refs);
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js
var parsePipelineDef;
var init_pipeline = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js"() {
    init_parseDef();
    parsePipelineDef = (def, refs) => {
      if (refs.pipeStrategy === "input") {
        return parseDef(def.in._def, refs);
      } else if (refs.pipeStrategy === "output") {
        return parseDef(def.out._def, refs);
      }
      const a = parseDef(def.in._def, {
        ...refs,
        currentPath: [...refs.currentPath, "allOf", "0"]
      });
      const b = parseDef(def.out._def, {
        ...refs,
        currentPath: [...refs.currentPath, "allOf", a ? "1" : "0"]
      });
      return {
        allOf: [a, b].filter((x) => x !== void 0)
      };
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
function parsePromiseDef(def, refs) {
  return parseDef(def.type._def, refs);
}
var init_promise = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/promise.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/set.js
function parseSetDef(def, refs) {
  const items = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items"]
  });
  const schema = {
    type: "array",
    uniqueItems: true,
    items
  };
  if (def.minSize) {
    setResponseValueAndErrors(schema, "minItems", def.minSize.value, def.minSize.message, refs);
  }
  if (def.maxSize) {
    setResponseValueAndErrors(schema, "maxItems", def.maxSize.value, def.maxSize.message, refs);
  }
  return schema;
}
var init_set = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/set.js"() {
    init_errorMessages();
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
function parseTupleDef(def, refs) {
  if (def.rest) {
    return {
      type: "array",
      minItems: def.items.length,
      items: def.items.map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "items", `${i}`]
      })).reduce((acc, x) => x === void 0 ? acc : [...acc, x], []),
      additionalItems: parseDef(def.rest._def, {
        ...refs,
        currentPath: [...refs.currentPath, "additionalItems"]
      })
    };
  } else {
    return {
      type: "array",
      minItems: def.items.length,
      maxItems: def.items.length,
      items: def.items.map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "items", `${i}`]
      })).reduce((acc, x) => x === void 0 ? acc : [...acc, x], [])
    };
  }
}
var init_tuple = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js"() {
    init_parseDef();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
function parseUndefinedDef(refs) {
  return {
    not: parseAnyDef(refs)
  };
}
var init_undefined = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js"() {
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
function parseUnknownDef(refs) {
  return parseAnyDef(refs);
}
var init_unknown = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js"() {
    init_any();
  }
});

// node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var parseReadonlyDef;
var init_readonly = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js"() {
    init_parseDef();
    parseReadonlyDef = (def, refs) => {
      return parseDef(def.innerType._def, refs);
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/selectParser.js
var selectParser;
var init_selectParser = __esm({
  "node_modules/zod-to-json-schema/dist/esm/selectParser.js"() {
    init_v3();
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_branded();
    init_catch();
    init_date();
    init_default();
    init_effects();
    init_enum();
    init_intersection();
    init_literal();
    init_map();
    init_nativeEnum();
    init_never();
    init_null();
    init_nullable();
    init_number();
    init_object();
    init_optional();
    init_pipeline();
    init_promise();
    init_record();
    init_set();
    init_string();
    init_tuple();
    init_undefined();
    init_union();
    init_unknown();
    init_readonly();
    selectParser = (def, typeName, refs) => {
      switch (typeName) {
        case ZodFirstPartyTypeKind.ZodString:
          return parseStringDef(def, refs);
        case ZodFirstPartyTypeKind.ZodNumber:
          return parseNumberDef(def, refs);
        case ZodFirstPartyTypeKind.ZodObject:
          return parseObjectDef(def, refs);
        case ZodFirstPartyTypeKind.ZodBigInt:
          return parseBigintDef(def, refs);
        case ZodFirstPartyTypeKind.ZodBoolean:
          return parseBooleanDef();
        case ZodFirstPartyTypeKind.ZodDate:
          return parseDateDef(def, refs);
        case ZodFirstPartyTypeKind.ZodUndefined:
          return parseUndefinedDef(refs);
        case ZodFirstPartyTypeKind.ZodNull:
          return parseNullDef(refs);
        case ZodFirstPartyTypeKind.ZodArray:
          return parseArrayDef(def, refs);
        case ZodFirstPartyTypeKind.ZodUnion:
        case ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
          return parseUnionDef(def, refs);
        case ZodFirstPartyTypeKind.ZodIntersection:
          return parseIntersectionDef(def, refs);
        case ZodFirstPartyTypeKind.ZodTuple:
          return parseTupleDef(def, refs);
        case ZodFirstPartyTypeKind.ZodRecord:
          return parseRecordDef(def, refs);
        case ZodFirstPartyTypeKind.ZodLiteral:
          return parseLiteralDef(def, refs);
        case ZodFirstPartyTypeKind.ZodEnum:
          return parseEnumDef(def);
        case ZodFirstPartyTypeKind.ZodNativeEnum:
          return parseNativeEnumDef(def);
        case ZodFirstPartyTypeKind.ZodNullable:
          return parseNullableDef(def, refs);
        case ZodFirstPartyTypeKind.ZodOptional:
          return parseOptionalDef(def, refs);
        case ZodFirstPartyTypeKind.ZodMap:
          return parseMapDef(def, refs);
        case ZodFirstPartyTypeKind.ZodSet:
          return parseSetDef(def, refs);
        case ZodFirstPartyTypeKind.ZodLazy:
          return () => def.getter()._def;
        case ZodFirstPartyTypeKind.ZodPromise:
          return parsePromiseDef(def, refs);
        case ZodFirstPartyTypeKind.ZodNaN:
        case ZodFirstPartyTypeKind.ZodNever:
          return parseNeverDef(refs);
        case ZodFirstPartyTypeKind.ZodEffects:
          return parseEffectsDef(def, refs);
        case ZodFirstPartyTypeKind.ZodAny:
          return parseAnyDef(refs);
        case ZodFirstPartyTypeKind.ZodUnknown:
          return parseUnknownDef(refs);
        case ZodFirstPartyTypeKind.ZodDefault:
          return parseDefaultDef(def, refs);
        case ZodFirstPartyTypeKind.ZodBranded:
          return parseBrandedDef(def, refs);
        case ZodFirstPartyTypeKind.ZodReadonly:
          return parseReadonlyDef(def, refs);
        case ZodFirstPartyTypeKind.ZodCatch:
          return parseCatchDef(def, refs);
        case ZodFirstPartyTypeKind.ZodPipeline:
          return parsePipelineDef(def, refs);
        case ZodFirstPartyTypeKind.ZodFunction:
        case ZodFirstPartyTypeKind.ZodVoid:
        case ZodFirstPartyTypeKind.ZodSymbol:
          return void 0;
        default:
          return /* @__PURE__ */ ((_) => void 0)(typeName);
      }
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parseDef.js
function parseDef(def, refs, forceResolution = false) {
  const seenItem = refs.seen.get(def);
  if (refs.override) {
    const overrideResult = refs.override?.(def, refs, seenItem, forceResolution);
    if (overrideResult !== ignoreOverride) {
      return overrideResult;
    }
  }
  if (seenItem && !forceResolution) {
    const seenSchema = get$ref(seenItem, refs);
    if (seenSchema !== void 0) {
      return seenSchema;
    }
  }
  const newItem = { def, path: refs.currentPath, jsonSchema: void 0 };
  refs.seen.set(def, newItem);
  const jsonSchemaOrGetter = selectParser(def, def.typeName, refs);
  const jsonSchema = typeof jsonSchemaOrGetter === "function" ? parseDef(jsonSchemaOrGetter(), refs) : jsonSchemaOrGetter;
  if (jsonSchema) {
    addMeta(def, refs, jsonSchema);
  }
  if (refs.postProcess) {
    const postProcessResult = refs.postProcess(jsonSchema, def, refs);
    newItem.jsonSchema = jsonSchema;
    return postProcessResult;
  }
  newItem.jsonSchema = jsonSchema;
  return jsonSchema;
}
var get$ref, addMeta;
var init_parseDef = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parseDef.js"() {
    init_Options();
    init_selectParser();
    init_getRelativePath();
    init_any();
    get$ref = (item, refs) => {
      switch (refs.$refStrategy) {
        case "root":
          return { $ref: item.path.join("/") };
        case "relative":
          return { $ref: getRelativePath(refs.currentPath, item.path) };
        case "none":
        case "seen": {
          if (item.path.length < refs.currentPath.length && item.path.every((value, index) => refs.currentPath[index] === value)) {
            console.warn(`Recursive reference detected at ${refs.currentPath.join("/")}! Defaulting to any`);
            return parseAnyDef(refs);
          }
          return refs.$refStrategy === "seen" ? parseAnyDef(refs) : void 0;
        }
      }
    };
    addMeta = (def, refs, jsonSchema) => {
      if (def.description) {
        jsonSchema.description = def.description;
        if (refs.markdownDescription) {
          jsonSchema.markdownDescription = def.description;
        }
      }
      return jsonSchema;
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/parseTypes.js
var init_parseTypes = __esm({
  "node_modules/zod-to-json-schema/dist/esm/parseTypes.js"() {
  }
});

// node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js
var zodToJsonSchema;
var init_zodToJsonSchema = __esm({
  "node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js"() {
    init_parseDef();
    init_Refs();
    init_any();
    zodToJsonSchema = (schema, options) => {
      const refs = getRefs(options);
      let definitions = typeof options === "object" && options.definitions ? Object.entries(options.definitions).reduce((acc, [name2, schema2]) => ({
        ...acc,
        [name2]: parseDef(schema2._def, {
          ...refs,
          currentPath: [...refs.basePath, refs.definitionPath, name2]
        }, true) ?? parseAnyDef(refs)
      }), {}) : void 0;
      const name = typeof options === "string" ? options : options?.nameStrategy === "title" ? void 0 : options?.name;
      const main2 = parseDef(schema._def, name === void 0 ? refs : {
        ...refs,
        currentPath: [...refs.basePath, refs.definitionPath, name]
      }, false) ?? parseAnyDef(refs);
      const title = typeof options === "object" && options.name !== void 0 && options.nameStrategy === "title" ? options.name : void 0;
      if (title !== void 0) {
        main2.title = title;
      }
      if (refs.flags.hasReferencedOpenAiAnyType) {
        if (!definitions) {
          definitions = {};
        }
        if (!definitions[refs.openAiAnyTypeName]) {
          definitions[refs.openAiAnyTypeName] = {
            // Skipping "object" as no properties can be defined and additionalProperties must be "false"
            type: ["string", "number", "integer", "boolean", "array", "null"],
            items: {
              $ref: refs.$refStrategy === "relative" ? "1" : [
                ...refs.basePath,
                refs.definitionPath,
                refs.openAiAnyTypeName
              ].join("/")
            }
          };
        }
      }
      const combined = name === void 0 ? definitions ? {
        ...main2,
        [refs.definitionPath]: definitions
      } : main2 : {
        $ref: [
          ...refs.$refStrategy === "relative" ? [] : refs.basePath,
          refs.definitionPath,
          name
        ].join("/"),
        [refs.definitionPath]: {
          ...definitions,
          [name]: main2
        }
      };
      if (refs.target === "jsonSchema7") {
        combined.$schema = "http://json-schema.org/draft-07/schema#";
      } else if (refs.target === "jsonSchema2019-09" || refs.target === "openAi") {
        combined.$schema = "https://json-schema.org/draft/2019-09/schema#";
      }
      if (refs.target === "openAi" && ("anyOf" in combined || "oneOf" in combined || "allOf" in combined || "type" in combined && Array.isArray(combined.type))) {
        console.warn("Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property.");
      }
      return combined;
    };
  }
});

// node_modules/zod-to-json-schema/dist/esm/index.js
var init_esm = __esm({
  "node_modules/zod-to-json-schema/dist/esm/index.js"() {
    init_Options();
    init_Refs();
    init_errorMessages();
    init_getRelativePath();
    init_parseDef();
    init_parseTypes();
    init_any();
    init_array();
    init_bigint();
    init_boolean();
    init_branded();
    init_catch();
    init_date();
    init_default();
    init_effects();
    init_enum();
    init_intersection();
    init_literal();
    init_map();
    init_nativeEnum();
    init_never();
    init_null();
    init_nullable();
    init_number();
    init_object();
    init_optional();
    init_pipeline();
    init_promise();
    init_readonly();
    init_record();
    init_set();
    init_string();
    init_tuple();
    init_undefined();
    init_union();
    init_unknown();
    init_selectParser();
    init_zodToJsonSchema();
    init_zodToJsonSchema();
  }
});

// src/result-schema-types.ts
var OPTIONAL_NON_NEGATIVE_NUMBER, OPTIONAL_FINITE_NUMBER, OPTIONAL_STRING, OPTIONAL_SHA256, OPTIONAL_BOOLEAN, OPTIONAL_STRING_OR_BOOLEAN, OPTIONAL_TRANSMISSION_STATE, OPTIONAL_ARRAY, OPTIONAL_STRING_ARRAY, OPTIONAL_OBJECT, OPTIONAL_MUTATION_VALUE, RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS, GUARDED_MUTATION_FIELDS, TEXT_VALUE_MUTATION_FIELDS, TOGGLE_MUTATION_FIELDS, USTVA_MUTATION_FIELDS, CLICK_RESULT_FIELDS, CASE_LIST_ENTRY, OPTIONAL_CASE_LIST;
var init_result_schema_types = __esm({
  "src/result-schema-types.ts"() {
    "use strict";
    init_zod();
    OPTIONAL_NON_NEGATIVE_NUMBER = external_exports.number().finite().nonnegative().nullable().optional().describe("Optionaler nichtnegativer Wert");
    OPTIONAL_FINITE_NUMBER = external_exports.number().finite().nullable().optional().describe("Optionaler endlicher Wert inklusive negativer UIA-Sentinelwerte");
    OPTIONAL_STRING = external_exports.string().nullable().optional().describe("Optionaler Text");
    OPTIONAL_SHA256 = external_exports.string().regex(/^[A-Fa-f0-9]{64}$/).nullable().optional().describe("Optionaler SHA-256 der gebundenen Ressource");
    OPTIONAL_BOOLEAN = external_exports.boolean().nullable().optional().describe("Optionales Flag");
    OPTIONAL_STRING_OR_BOOLEAN = external_exports.union([external_exports.string(), external_exports.boolean()]).nullable().optional().describe("Optionaler Text oder historisches Bestaetigungsflag");
    OPTIONAL_TRANSMISSION_STATE = external_exports.union([external_exports.boolean(), external_exports.literal("unknown")]).nullable().optional().describe("Sicherer ELSTER-Uebermittlungsstatus: ja, nein oder unbekannt");
    OPTIONAL_ARRAY = external_exports.array(external_exports.unknown()).nullable().optional().describe("Optionale Ergebnisliste");
    OPTIONAL_STRING_ARRAY = external_exports.array(external_exports.string()).nullable().optional().describe("Optionale Textliste");
    OPTIONAL_OBJECT = external_exports.record(external_exports.unknown()).nullable().optional().describe("Optionales Teilresultat");
    OPTIONAL_MUTATION_VALUE = external_exports.union([external_exports.string(), external_exports.number().finite(), external_exports.boolean()]).nullable().optional().describe("Optionaler gelesener oder geschriebener Skalarwert");
    RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS = {
      reason: external_exports.string().nullable().optional().describe("Grund"),
      retryable: external_exports.boolean().nullable().optional().describe("Retry"),
      interactionRequirement: external_exports.literal("foreground-required").nullable().optional().describe("Interaktion"),
      mutationStarted: external_exports.boolean().nullable().optional().describe("Mutation"),
      resultingState: external_exports.string().nullable().optional().describe("Zustand"),
      cleanupRequired: external_exports.boolean().nullable().optional().describe("Cleanup"),
      physicalInputUsed: external_exports.boolean().nullable().optional().describe("Eingabe"),
      foregroundLeaseUsed: external_exports.boolean().nullable().optional().describe("Lease")
    };
    GUARDED_MUTATION_FIELDS = {
      verified: OPTIONAL_BOOLEAN,
      inputGuard: OPTIONAL_OBJECT,
      windowGuard: OPTIONAL_OBJECT,
      rollback: OPTIONAL_OBJECT
    };
    TEXT_VALUE_MUTATION_FIELDS = {
      before: OPTIONAL_STRING,
      after: OPTIONAL_STRING,
      expectedAfter: OPTIONAL_STRING,
      page: OPTIONAL_STRING,
      pageBefore: OPTIONAL_STRING,
      pageAfter: OPTIONAL_STRING,
      method: OPTIONAL_STRING,
      ...GUARDED_MUTATION_FIELDS
    };
    TOGGLE_MUTATION_FIELDS = {
      before: OPTIONAL_BOOLEAN,
      wanted: OPTIONAL_BOOLEAN,
      after: OPTIONAL_BOOLEAN,
      expectedAfter: OPTIONAL_BOOLEAN,
      page: OPTIONAL_STRING,
      pageBefore: OPTIONAL_STRING,
      pageAfter: OPTIONAL_STRING,
      method: OPTIONAL_STRING,
      checkbox: OPTIONAL_OBJECT,
      ungespeichertVorher: OPTIONAL_BOOLEAN,
      ungespeichertNachher: OPTIONAL_BOOLEAN,
      ...GUARDED_MUTATION_FIELDS
    };
    USTVA_MUTATION_FIELDS = {
      ustva: OPTIONAL_OBJECT,
      effects: OPTIONAL_OBJECT
    };
    CLICK_RESULT_FIELDS = {
      clicked: OPTIONAL_STRING,
      pattern: OPTIONAL_STRING,
      method: OPTIONAL_STRING,
      kandidaten: OPTIONAL_NON_NEGATIVE_NUMBER,
      ueberschriftVorher: OPTIONAL_STRING,
      ueberschriftNachher: OPTIONAL_STRING,
      navigiert: OPTIONAL_BOOLEAN,
      verified: OPTIONAL_BOOLEAN,
      ungespeichertVorher: OPTIONAL_BOOLEAN,
      ungespeichertNachher: OPTIONAL_BOOLEAN,
      dialoge: OPTIONAL_ARRAY,
      node: OPTIONAL_OBJECT
    };
    CASE_LIST_ENTRY = external_exports.object({
      name: external_exports.string().min(1).describe("Dateiname des Steuerfalls"),
      path: external_exports.string().nullable().optional().describe("Lokaler oder redigierter Ressourcenpfad des Steuerfalls"),
      kb: external_exports.number().finite().nonnegative().nullable().optional().describe("Dateigroesse in gerundeten KiB"),
      modified: external_exports.string().nullable().optional().describe("Lokaler Aenderungszeitpunkt"),
      module: external_exports.string().nullable().optional().describe("SSE-Modulkennung aus der Dateiendung"),
      fileType: external_exports.union([external_exports.string(), external_exports.number().finite()]).nullable().optional().describe("AKAD-Dateityp"),
      year: external_exports.union([external_exports.string(), external_exports.number().finite()]).nullable().optional().describe("Steuerjahr aus dem AKAD-Kopf"),
      steuernummer: external_exports.union([external_exports.string(), external_exports.number().finite()]).nullable().optional().describe("Steuernummer aus dem AKAD-Kopf"),
      savedBy: external_exports.union([external_exports.string(), external_exports.number().finite()]).nullable().optional().describe("Speichernde SSE-Version"),
      elsterTransferTime: external_exports.string().nullable().optional().describe("Getrimmter ELSTER-Uebermittlungszeitpunkt oder Platzhalter"),
      transmitted: external_exports.union([external_exports.boolean(), external_exports.literal("unknown")]).nullable().optional().describe("Sicherer ELSTER-Uebermittlungsstatus"),
      transmittedReason: external_exports.string().nullable().optional().describe("Begruendung des ELSTER-Uebermittlungsstatus"),
      encryptedBytes: external_exports.number().finite().nonnegative().nullable().optional().describe("Im begrenzten AKAD-Kopf sichtbare verschluesselte Bytes"),
      meta: external_exports.unknown().nullable().optional().describe("Ausfuehrliche Parsermetadaten oder null")
    }).passthrough().describe("Stabiler Eintrag der Fallliste");
    OPTIONAL_CASE_LIST = external_exports.array(CASE_LIST_ENTRY).nullable().optional().describe("Optionale typisierte Fallliste");
  }
});

// src/result-mutation-fields.ts
var OPTIONAL_SEARCH_BINDING, OPTIONAL_SEARCH_INPUT_GUARD, OPTIONAL_SEARCH_WINDOW_GUARD, OPTIONAL_SEARCH_ROLLBACK, MUTATION_OPERATION_RESULT_FIELDS;
var init_result_mutation_fields = __esm({
  "src/result-mutation-fields.ts"() {
    "use strict";
    init_zod();
    init_result_schema_types();
    OPTIONAL_SEARCH_BINDING = external_exports.object({
      rid: external_exports.string().describe("Frische Runtime-ID des strukturell gebundenen globalen Suchfelds")
    }).passthrough().nullable().optional().describe("Bindung des globalen steuerneutralen Suchfelds");
    OPTIONAL_SEARCH_INPUT_GUARD = external_exports.object({
      aktiv: external_exports.boolean().describe("Ob der sichtbare Desktop gegen fremde Eingabe gebunden wurde"),
      baseline: external_exports.number().finite().nonnegative().nullable().describe("Windows-Eingabeepoch unmittelbar vor dem Schreiben"),
      beobachtet: external_exports.number().finite().nonnegative().nullable().describe("Windows-Eingabeepoch nach dem Schreiben"),
      eingriffErkannt: external_exports.boolean().describe("Ob eine fremde Eingabe waehrend der Mutation erkannt wurde")
    }).passthrough().nullable().optional().describe("Windows-Eingabeepoch vor und nach der Suchfeldmutation");
    OPTIONAL_SEARCH_WINDOW_GUARD = external_exports.object({
      vorher: external_exports.string().regex(/^[A-Fa-f0-9]{64}$/).describe("SHA-256 des gebundenen Interaktionsfenstersatzes vor dem Schreiben"),
      nachher: external_exports.string().regex(/^[A-Fa-f0-9]{64}$/).describe("SHA-256 des gebundenen Interaktionsfenstersatzes nach dem Schreiben"),
      geaendert: external_exports.boolean().describe("Ob sich der gebundene Interaktionsfenstersatz geaendert hat")
    }).passthrough().nullable().optional().describe("Gebundene Interaktionsfenster vor und nach der Suchfeldmutation");
    OPTIONAL_SEARCH_ROLLBACK = external_exports.object({
      versucht: external_exports.boolean().nullable().optional().describe("Ob der eigene Suchwert zurueckgesetzt wurde"),
      erfolgreich: external_exports.boolean().nullable().optional().describe("Ob der Ausgangswert nach dem Ruecksetzen wieder sichtbar war"),
      ist: OPTIONAL_MUTATION_VALUE,
      erwartet: OPTIONAL_STRING,
      grund: OPTIONAL_STRING
    }).passthrough().nullable().optional().describe("Fail-closed Ruecksetzstatus des globalen Suchfelds");
    MUTATION_OPERATION_RESULT_FIELDS = {
      fill_fields: {
        schemaVersion: OPTIONAL_NON_NEGATIVE_NUMBER,
        planKind: OPTIONAL_STRING,
        completed: OPTIONAL_ARRAY,
        failedAction: OPTIONAL_OBJECT,
        failedIndex: OPTIONAL_NON_NEGATIVE_NUMBER,
        skipped: OPTIONAL_ARRAY,
        rollback: OPTIONAL_OBJECT,
        cleanupRequired: OPTIONAL_BOOLEAN,
        finalReadback: OPTIONAL_OBJECT,
        finalReadbackVerified: OPTIONAL_BOOLEAN,
        resultingState: OPTIONAL_STRING,
        performance: OPTIONAL_OBJECT,
        verified: OPTIONAL_BOOLEAN
      },
      click_point: {
        clicked: OPTIONAL_STRING,
        at: OPTIONAL_STRING,
        double: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        windowClosed: OPTIONAL_BOOLEAN,
        seiteGewechselt: OPTIONAL_BOOLEAN,
        ueberschriftVorher: OPTIONAL_STRING,
        ueberschriftNachher: OPTIONAL_STRING,
        uiFingerprintVorher: OPTIONAL_STRING,
        uiFingerprintNachher: OPTIONAL_STRING,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        node: OPTIONAL_OBJECT,
        clickBinding: OPTIONAL_OBJECT,
        note: OPTIONAL_STRING
      },
      combo_select: {
        ...TEXT_VALUE_MUTATION_FIELDS,
        selected: OPTIONAL_STRING,
        combo: OPTIONAL_OBJECT
      },
      file_dialog_select: {
        selected: OPTIONAL_STRING,
        verified: OPTIONAL_BOOLEAN,
        mode: OPTIONAL_STRING,
        actual: OPTIONAL_STRING,
        expected: OPTIONAL_STRING,
        expectedPath: OPTIONAL_STRING,
        fieldReadback: OPTIONAL_STRING,
        sha256: OPTIONAL_SHA256,
        dialogTitle: OPTIONAL_STRING,
        dialogClosed: OPTIONAL_BOOLEAN,
        dialog: OPTIONAL_OBJECT,
        nodes: OPTIONAL_ARRAY
      },
      menu_click: {
        ausgeloest: OPTIONAL_STRING,
        angefordert: OPTIONAL_STRING,
        method: OPTIONAL_STRING,
        fenster: OPTIONAL_NON_NEGATIVE_NUMBER,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN
      },
      receipt_manager_action: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        actionId: OPTIONAL_STRING,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        controlAutomationId: OPTIONAL_STRING,
        controlName: OPTIONAL_STRING,
        stateBefore: OPTIONAL_STRING,
        stateAfter: OPTIONAL_STRING,
        stateFingerprintBefore: OPTIONAL_SHA256,
        stateFingerprintAfter: OPTIONAL_SHA256,
        windowSetFingerprintBefore: OPTIONAL_SHA256,
        windowSetFingerprintAfter: OPTIONAL_SHA256,
        windowSetUnchanged: OPTIONAL_BOOLEAN,
        sameMain: OPTIONAL_BOOLEAN,
        sameTool: OPTIONAL_BOOLEAN,
        dialogsAfter: OPTIONAL_NON_NEGATIVE_NUMBER,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        clickBinding: OPTIONAL_OBJECT
      },
      receipt_manager_read: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        managerHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        row: OPTIONAL_OBJECT,
        fields: OPTIONAL_ARRAY,
        values: OPTIONAL_OBJECT,
        valuesComplete: OPTIONAL_BOOLEAN,
        listFingerprint: OPTIONAL_SHA256,
        listFingerprintBefore: OPTIONAL_SHA256,
        detailFingerprint: OPTIONAL_SHA256,
        semanticListUnchanged: OPTIONAL_BOOLEAN,
        targetRowRebound: OPTIONAL_BOOLEAN,
        rowAfter: OPTIONAL_OBJECT,
        targetSemanticRebound: OPTIONAL_BOOLEAN,
        semanticRowAfter: OPTIONAL_OBJECT,
        dialogFreeAfter: OPTIONAL_BOOLEAN,
        semanticReadback: OPTIONAL_OBJECT,
        windowSetUnchanged: OPTIONAL_BOOLEAN,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        clickBinding: OPTIONAL_OBJECT
      },
      receipt_manager_update: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        managerHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        rowBefore: OPTIONAL_OBJECT,
        rowAfter: OPTIONAL_OBJECT,
        valuesBefore: OPTIONAL_OBJECT,
        valuesAfter: OPTIONAL_OBJECT,
        requestedValues: OPTIONAL_OBJECT,
        changedFields: OPTIONAL_STRING_ARRAY,
        draftBefore: OPTIONAL_BOOLEAN,
        draftAfter: OPTIONAL_BOOLEAN,
        listFingerprintBefore: OPTIONAL_SHA256,
        listFingerprintAfter: OPTIONAL_SHA256,
        detailFingerprintBefore: OPTIONAL_SHA256,
        detailFingerprintAfter: OPTIONAL_SHA256,
        countUnchanged: OPTIONAL_BOOLEAN,
        otherRowsUnchanged: OPTIONAL_BOOLEAN,
        windowSetUnchanged: OPTIONAL_BOOLEAN,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        rollback: OPTIONAL_OBJECT,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN
      },
      receipt_manager_classify: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        rowBefore: OPTIONAL_OBJECT,
        rowAfter: OPTIONAL_OBJECT,
        requestedValues: OPTIONAL_OBJECT,
        valuesBefore: OPTIONAL_OBJECT,
        valuesAfter: OPTIONAL_OBJECT,
        changedKinds: OPTIONAL_STRING_ARRAY,
        listFingerprintBefore: OPTIONAL_SHA256,
        listFingerprintAfter: OPTIONAL_SHA256,
        detailFingerprintBefore: OPTIONAL_SHA256,
        detailFingerprintAfter: OPTIONAL_SHA256,
        rollback: OPTIONAL_OBJECT,
        cleanupRequired: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN
      },
      receipt_manager_link: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        managerHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        receipt: OPTIONAL_OBJECT,
        items: OPTIONAL_ARRAY,
        expectedTargetPage: OPTIONAL_STRING,
        expectedLinkTarget: OPTIONAL_STRING,
        linkedBefore: OPTIONAL_BOOLEAN,
        linkedAfter: OPTIONAL_BOOLEAN,
        footerCountBefore: OPTIONAL_NON_NEGATIVE_NUMBER,
        footerCountAfter: OPTIONAL_NON_NEGATIVE_NUMBER,
        noChanges: OPTIONAL_BOOLEAN,
        changedCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        applied: OPTIONAL_BOOLEAN,
        persistenceVerified: OPTIONAL_BOOLEAN,
        cleanupRequired: OPTIONAL_BOOLEAN,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        dirtyStateUnchangedBeforeApply: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN
      },
      receipt_manager_bulk_upsert: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        schemaVersion: OPTIONAL_NON_NEGATIVE_NUMBER,
        planKind: OPTIONAL_STRING,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        managerHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        requestedCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        completedCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        completed: OPTIONAL_ARRAY,
        failedAction: OPTIONAL_OBJECT,
        failedIndex: OPTIONAL_NON_NEGATIVE_NUMBER,
        skipped: OPTIONAL_ARRAY,
        items: OPTIONAL_ARRAY,
        failure: OPTIONAL_OBJECT,
        rollback: OPTIONAL_OBJECT,
        cleanupRequired: OPTIONAL_BOOLEAN,
        finalReadback: OPTIONAL_OBJECT,
        finalReadbackVerified: OPTIONAL_BOOLEAN,
        resultingState: OPTIONAL_STRING,
        performance: OPTIONAL_OBJECT,
        verified: OPTIONAL_BOOLEAN
      },
      receipt_manager_delete: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        deletedRow: OPTIONAL_OBJECT,
        countBefore: OPTIONAL_NON_NEGATIVE_NUMBER,
        countAfter: OPTIONAL_NON_NEGATIVE_NUMBER,
        listFingerprintBefore: OPTIONAL_SHA256,
        listFingerprintAfter: OPTIONAL_SHA256,
        confirmationFingerprint: OPTIONAL_SHA256,
        confirmationMethod: OPTIONAL_STRING,
        dialogClosed: OPTIONAL_BOOLEAN,
        remainingRowsUnchanged: OPTIONAL_BOOLEAN,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        clickBinding: OPTIONAL_OBJECT
      },
      save: {
        saved: OPTIONAL_BOOLEAN,
        noChanges: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        path: OPTIONAL_STRING,
        hashBefore: OPTIONAL_SHA256,
        hashAfter: OPTIONAL_SHA256,
        mtimeBeforeUtc: OPTIONAL_STRING,
        mtimeAfterUtc: OPTIONAL_STRING,
        headerStable: OPTIONAL_BOOLEAN,
        header: OPTIONAL_OBJECT,
        headerBefore: OPTIONAL_OBJECT,
        headerAfter: OPTIONAL_OBJECT,
        identityBefore: OPTIONAL_OBJECT,
        identityAfter: OPTIONAL_OBJECT,
        transmitted: OPTIONAL_TRANSMISSION_STATE,
        transmittedBefore: OPTIONAL_TRANSMISSION_STATE,
        transmittedAfter: OPTIONAL_TRANSMISSION_STATE,
        transmittedReasonBefore: OPTIONAL_STRING,
        transmittedReasonAfter: OPTIONAL_STRING,
        binding: OPTIONAL_OBJECT,
        correction: OPTIONAL_OBJECT,
        saveEnabledAfter: OPTIONAL_BOOLEAN,
        searchClosedBeforeSave: OPTIONAL_BOOLEAN,
        fileSavedByChanged: OPTIONAL_BOOLEAN,
        offeneBedingungen: OPTIONAL_STRING_ARRAY,
        openWindows: OPTIONAL_ARRAY,
        warning: OPTIONAL_STRING,
        note: OPTIONAL_STRING
      },
      case_create: {
        created: OPTIONAL_BOOLEAN,
        caseRef: OPTIONAL_STRING,
        sha256: OPTIONAL_SHA256,
        caseHashSource: OPTIONAL_STRING,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mode: OPTIONAL_STRING,
        taxYear: OPTIONAL_NON_NEGATIVE_NUMBER,
        heading: OPTIONAL_STRING,
        steps: OPTIONAL_STRING_ARRAY,
        failedStep: OPTIONAL_STRING,
        effects: OPTIONAL_OBJECT,
        note: OPTIONAL_STRING,
        cleanup: OPTIONAL_OBJECT,
        cleanupError: OPTIONAL_STRING,
        processStillRunning: OPTIONAL_BOOLEAN
      },
      save_as: {
        savedAs: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        sourcePath: OPTIONAL_STRING,
        targetPath: OPTIONAL_STRING,
        attachedPath: OPTIONAL_STRING,
        sourceHash: OPTIONAL_SHA256,
        sourceHashBefore: OPTIONAL_SHA256,
        sourceHashAfter: OPTIONAL_SHA256,
        targetHash: OPTIONAL_SHA256,
        headerMatches: OPTIONAL_BOOLEAN,
        transmitted: OPTIONAL_TRANSMISSION_STATE,
        actual: OPTIONAL_STRING,
        expected: OPTIONAL_STRING,
        sourceBinding: OPTIONAL_OBJECT,
        targetBinding: OPTIONAL_OBJECT,
        binding: OPTIONAL_OBJECT,
        header: OPTIONAL_OBJECT,
        dialog: OPTIONAL_OBJECT,
        dialogs: OPTIONAL_ARRAY,
        nodes: OPTIONAL_ARRAY
      },
      table_add: {
        verified: OPTIONAL_BOOLEAN,
        mutationStarted: OPTIONAL_BOOLEAN,
        page: OPTIONAL_STRING,
        expectedPage: OPTIONAL_STRING,
        sumLabel: OPTIONAL_STRING,
        sumBefore: OPTIONAL_STRING,
        sumAfter: OPTIONAL_STRING,
        zeileY: OPTIONAL_NON_NEGATIVE_NUMBER,
        zellen: OPTIONAL_ARRAY,
        geaenderteSpalten: OPTIONAL_ARRAY,
        checkerMessagesBefore: OPTIONAL_STRING_ARRAY,
        checkerMessagesAfter: OPTIONAL_STRING_ARRAY,
        newCheckerMessages: OPTIONAL_STRING_ARRAY,
        tableBinding: OPTIONAL_OBJECT,
        inputGuard: OPTIONAL_OBJECT,
        rollback: OPTIONAL_OBJECT,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN
      },
      table_update: {
        verified: OPTIONAL_BOOLEAN,
        page: OPTIONAL_STRING,
        expectedPage: OPTIONAL_STRING,
        ziel: OPTIONAL_STRING,
        summeVorher: OPTIONAL_STRING,
        summeNachher: OPTIONAL_STRING,
        zellen: OPTIONAL_ARRAY,
        geaenderteSpalten: OPTIONAL_ARRAY,
        checkerMessagesBefore: OPTIONAL_STRING_ARRAY,
        checkerMessagesAfter: OPTIONAL_STRING_ARRAY,
        newCheckerMessages: OPTIONAL_STRING_ARRAY,
        tableBinding: OPTIONAL_OBJECT,
        inputGuard: OPTIONAL_OBJECT,
        windowGuard: OPTIONAL_OBJECT,
        rollback: OPTIONAL_OBJECT,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        versteckterDesktop: OPTIONAL_BOOLEAN
      },
      table_delete: {
        verified: OPTIONAL_BOOLEAN,
        geloescht: OPTIONAL_BOOLEAN,
        page: OPTIONAL_STRING,
        expectedPage: OPTIONAL_STRING,
        target: OPTIONAL_STRING,
        before: OPTIONAL_STRING,
        after: OPTIONAL_STRING,
        expectedBefore: OPTIONAL_STRING,
        expectedAfter: OPTIONAL_STRING,
        sumLabel: OPTIONAL_STRING,
        nochVorhanden: OPTIONAL_BOOLEAN,
        rolledBack: OPTIONAL_BOOLEAN,
        rollbackAttempted: OPTIONAL_BOOLEAN,
        rollbackInterference: OPTIONAL_BOOLEAN,
        rollbackValue: OPTIONAL_MUTATION_VALUE,
        selectionCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        selectionNames: OPTIONAL_STRING_ARRAY,
        selectionYs: OPTIONAL_ARRAY,
        tableBinding: OPTIONAL_OBJECT,
        mutationState: OPTIONAL_OBJECT,
        inputGuard: OPTIONAL_OBJECT,
        windowGuard: OPTIONAL_OBJECT,
        rollback: OPTIONAL_OBJECT,
        warning: OPTIONAL_STRING
      },
      set_value: {
        before: OPTIONAL_STRING,
        requested: OPTIONAL_STRING,
        after: OPTIONAL_STRING,
        expectedAfter: OPTIONAL_STRING,
        verified: OPTIONAL_BOOLEAN,
        page: OPTIONAL_STRING,
        pageBefore: OPTIONAL_STRING,
        pageAfter: OPTIONAL_STRING,
        binding: OPTIONAL_SEARCH_BINDING,
        inputGuard: OPTIONAL_SEARCH_INPUT_GUARD,
        windowGuard: OPTIONAL_SEARCH_WINDOW_GUARD,
        rollback: OPTIONAL_SEARCH_ROLLBACK
      },
      toggle: TOGGLE_MUTATION_FIELDS,
      tracked_set_value: {
        verified: OPTIONAL_BOOLEAN,
        pageId: OPTIONAL_STRING,
        fieldId: OPTIONAL_STRING,
        valueKind: OPTIONAL_STRING,
        seite: OPTIONAL_STRING,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        feld: OPTIONAL_OBJECT,
        bindung: OPTIONAL_STRING,
        summen: OPTIONAL_ARRAY,
        ergebnisDiff: OPTIONAL_ARRAY,
        ergebnisZeilenVorher: OPTIONAL_NON_NEGATIVE_NUMBER,
        ergebnisZeilenNachher: OPTIONAL_NON_NEGATIVE_NUMBER,
        ergebnisVerfolgt: OPTIONAL_BOOLEAN,
        ergebnisVollstaendig: OPTIONAL_BOOLEAN,
        ergebnisFensterGeschlossen: OPTIONAL_BOOLEAN,
        ergebnisFensterVerschoben: OPTIONAL_OBJECT,
        ungespeichert: OPTIONAL_BOOLEAN,
        commit: OPTIONAL_STRING,
        commitDetails: OPTIONAL_OBJECT,
        focuslessPolicy: OPTIONAL_STRING,
        inputGuard: OPTIONAL_OBJECT,
        fensterGuard: OPTIONAL_OBJECT,
        rollback: OPTIONAL_OBJECT,
        zeitmessung: OPTIONAL_OBJECT,
        epochVorher: OPTIONAL_STRING,
        epochNachher: OPTIONAL_STRING
      },
      ustva_open_section: { ...CLICK_RESULT_FIELDS, ...USTVA_MUTATION_FIELDS },
      ustva_select_period: { ...TEXT_VALUE_MUTATION_FIELDS, ...USTVA_MUTATION_FIELDS },
      ustva_set_flag: { ...TOGGLE_MUTATION_FIELDS, ...USTVA_MUTATION_FIELDS },
      ustva_change_value: {
        verified: OPTIONAL_BOOLEAN,
        pageId: OPTIONAL_STRING,
        fieldId: OPTIONAL_STRING,
        valueKind: OPTIONAL_STRING,
        seite: OPTIONAL_STRING,
        feld: OPTIONAL_OBJECT,
        bindung: OPTIONAL_STRING,
        summen: OPTIONAL_ARRAY,
        rollback: OPTIONAL_OBJECT,
        ...USTVA_MUTATION_FIELDS
      },
      vast_mapping_select: {
        changed: OPTIONAL_BOOLEAN,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        certificate: OPTIONAL_STRING,
        occurrence: OPTIONAL_NON_NEGATIVE_NUMBER,
        before: OPTIONAL_STRING,
        after: OPTIONAL_STRING,
        expectedAfter: OPTIONAL_STRING,
        actualAfter: OPTIONAL_STRING,
        changes: OPTIONAL_ARRAY,
        mappingFingerprintBefore: OPTIONAL_SHA256,
        mappingFingerprintAfter: OPTIONAL_SHA256,
        expectedMappingFingerprint: OPTIONAL_SHA256,
        actualMappingFingerprint: OPTIONAL_SHA256,
        note: OPTIONAL_STRING
      },
      vast_apply: {
        applied: OPTIONAL_BOOLEAN,
        saved: OPTIONAL_BOOLEAN,
        dialogClosed: OPTIONAL_BOOLEAN,
        dialogHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        caseBindingBefore: OPTIONAL_STRING,
        caseBindingAfter: OPTIONAL_STRING,
        caseBoundAfter: OPTIONAL_BOOLEAN,
        diskHashBefore: OPTIONAL_SHA256,
        diskHashAfter: OPTIONAL_SHA256,
        diskHashUnchanged: OPTIONAL_BOOLEAN,
        mappingFingerprint: OPTIONAL_SHA256,
        expectedMappingFingerprint: OPTIONAL_SHA256,
        actualMappingFingerprint: OPTIONAL_SHA256,
        appliedPlan: OPTIONAL_ARRAY,
        mismatches: OPTIONAL_ARRAY,
        unresolved: OPTIONAL_ARRAY,
        riskyDuplicateTargets: OPTIONAL_ARRAY,
        dirtyBefore: OPTIONAL_BOOLEAN,
        dirtyAfter: OPTIONAL_BOOLEAN,
        followUpRequired: OPTIONAL_BOOLEAN,
        newDialogs: OPTIONAL_ARRAY,
        note: OPTIONAL_STRING
      }
    };
  }
});

// src/result-utility-fields.ts
var UTILITY_OPERATION_RESULT_FIELDS;
var init_result_utility_fields = __esm({
  "src/result-utility-fields.ts"() {
    "use strict";
    init_result_schema_types();
    UTILITY_OPERATION_RESULT_FIELDS = {
      accessibility_probe: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        node: OPTIONAL_OBJECT,
        uia: OPTIONAL_OBJECT,
        rawDescendants: OPTIONAL_ARRAY,
        rawTruncated: OPTIONAL_BOOLEAN,
        msaaOverlaps: OPTIONAL_ARRAY,
        textCandidates: OPTIONAL_ARRAY,
        fazit: OPTIONAL_STRING
      },
      center_cases: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        canaryMs: OPTIONAL_NON_NEGATIVE_NUMBER,
        modus: OPTIONAL_STRING,
        verzeichnis: OPTIONAL_STRING,
        suche: OPTIONAL_STRING,
        sortierung: OPTIONAL_STRING,
        ansicht: OPTIONAL_STRING,
        faelle: OPTIONAL_ARRAY,
        dateisystemFaelle: OPTIONAL_ARRAY,
        nurImCenter: OPTIONAL_ARRAY,
        nurImDateisystem: OPTIONAL_ARRAY,
        dateisystemVerglichen: OPTIONAL_BOOLEAN,
        konsistent: OPTIONAL_BOOLEAN,
        snapshot: OPTIONAL_OBJECT,
        hinweis: OPTIONAL_STRING
      },
      center_refresh: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        modus: OPTIONAL_STRING,
        verzeichnis: OPTIONAL_STRING,
        vorher: OPTIONAL_ARRAY,
        nachher: OPTIONAL_ARRAY,
        entfernt: OPTIONAL_ARRAY,
        hinzugekommen: OPTIONAL_ARRAY,
        sucheUnveraendert: OPTIONAL_BOOLEAN,
        sortierungUnveraendert: OPTIONAL_BOOLEAN,
        hinweis: OPTIONAL_STRING
      },
      check: {
        beanstandungsfrei: OPTIONAL_BOOLEAN,
        seite: OPTIONAL_STRING,
        prueferMeldungen: OPTIONAL_ARRAY,
        baumFehler: OPTIONAL_ARRAY,
        leerePflichtfelder: OPTIONAL_ARRAY,
        ergebnisAnzeige: OPTIONAL_STRING,
        steuerpruefer: OPTIONAL_OBJECT,
        urteil: OPTIONAL_STRING
      },
      checker_close: {
        closed: OPTIONAL_BOOLEAN,
        alreadyClosed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        heading: OPTIONAL_STRING,
        headingBefore: OPTIONAL_STRING,
        headingAfter: OPTIONAL_STRING,
        dirtyBefore: OPTIONAL_BOOLEAN,
        dirtyAfter: OPTIONAL_BOOLEAN,
        closeButtonRemaining: OPTIONAL_NON_NEGATIVE_NUMBER,
        ungespeichert: OPTIONAL_BOOLEAN,
        note: OPTIONAL_STRING
      },
      checker_detail: {
        meldung: OPTIONAL_STRING,
        bildBase64: OPTIONAL_STRING,
        leseweg: OPTIONAL_STRING,
        strukturiertOk: OPTIONAL_BOOLEAN,
        ocrVerwendet: OPTIONAL_BOOLEAN,
        ocrOk: OPTIONAL_BOOLEAN,
        strukturQuellen: OPTIONAL_ARRAY,
        sprache: OPTIONAL_STRING,
        zeilen: OPTIONAL_NON_NEGATIVE_NUMBER,
        text: OPTIONAL_STRING,
        ocrFehler: OPTIONAL_STRING,
        inAnsichtGerollt: OPTIONAL_BOOLEAN,
        ungespeichert: OPTIONAL_BOOLEAN
      },
      checker_reset: {
        geschlossen: OPTIONAL_ARRAY,
        anzahlGeschlossen: OPTIONAL_NON_NEGATIVE_NUMBER,
        konsistent: OPTIONAL_BOOLEAN,
        fragenWarnungenAngekuendigt: OPTIONAL_NON_NEGATIVE_NUMBER,
        tippsAngekuendigt: OPTIONAL_NON_NEGATIVE_NUMBER,
        fragenWarnungen: OPTIONAL_ARRAY,
        tippsZusatzinfos: OPTIONAL_ARRAY,
        sonstige: OPTIONAL_ARRAY,
        aufgeklappt: OPTIONAL_ARRAY,
        technischeFokusKarten: OPTIONAL_ARRAY,
        nichtGeschlossen: OPTIONAL_ARRAY,
        navigationSchritte: OPTIONAL_NON_NEGATIVE_NUMBER,
        fokusVerwendet: OPTIONAL_BOOLEAN,
        ohneOffeneKarten: OPTIONAL_BOOLEAN,
        ungespeichert: OPTIONAL_BOOLEAN,
        hinweis: OPTIONAL_STRING
      },
      combo_options: {
        current: OPTIONAL_STRING,
        combo: OPTIONAL_OBJECT,
        options: OPTIONAL_ARRAY,
        collapsedAfterRead: OPTIONAL_BOOLEAN
      },
      dismiss: {
        geschlossen: OPTIONAL_NON_NEGATIVE_NUMBER,
        systemOverlaysIgnoriert: OPTIONAL_NON_NEGATIVE_NUMBER,
        stehenGelassen: OPTIONAL_ARRAY,
        verbleibend: OPTIONAL_NON_NEGATIVE_NUMBER,
        note: OPTIONAL_STRING
      },
      export_csv: {
        ausgeloest: OPTIONAL_STRING,
        invokeReportedError: OPTIONAL_STRING,
        dialog: OPTIONAL_OBJECT,
        offeneDialoge: OPTIONAL_NON_NEGATIVE_NUMBER,
        dateienVorher: OPTIONAL_NON_NEGATIVE_NUMBER,
        hinweis: OPTIONAL_STRING
      },
      find: {
        count: OPTIONAL_NON_NEGATIVE_NUMBER,
        hits: OPTIONAL_ARRAY,
        stats: OPTIONAL_OBJECT,
        incomplete: OPTIONAL_BOOLEAN,
        note: OPTIONAL_STRING
      },
      get_value: {
        node: OPTIONAL_OBJECT,
        value: OPTIONAL_STRING,
        readOnly: OPTIONAL_BOOLEAN,
        aufgeloestUeber: OPTIONAL_STRING
      },
      help: {
        seite: OPTIONAL_STRING,
        abschnitte: OPTIONAL_OBJECT,
        hinweis: OPTIONAL_STRING
      },
      menu: {
        menues: OPTIONAL_ARRAY,
        menue: OPTIONAL_STRING,
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        eintraege: OPTIONAL_ARRAY,
        hinweis: OPTIONAL_STRING
      },
      menu_close: {
        collapsed: OPTIONAL_ARRAY,
        popupCountBefore: OPTIONAL_NON_NEGATIVE_NUMBER,
        popupCountAfter: OPTIONAL_NON_NEGATIVE_NUMBER,
        verified: OPTIONAL_BOOLEAN,
        warning: OPTIONAL_STRING
      },
      page_objects: {
        catalog: OPTIONAL_OBJECT,
        pageId: OPTIONAL_STRING,
        page: OPTIONAL_OBJECT
      },
      positions: {
        positionen: OPTIONAL_ARRAY,
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        hinweis: OPTIONAL_STRING
      },
      scroll: {
        mode: OPTIONAL_STRING,
        scrolledTo: OPTIONAL_STRING,
        count: OPTIONAL_NON_NEGATIVE_NUMBER,
        scrollables: OPTIONAL_ARRAY,
        target: OPTIONAL_STRING,
        vPercent: OPTIONAL_FINITE_NUMBER
      },
      scroll_page: {
        scrollbar: OPTIONAL_BOOLEAN,
        position: OPTIONAL_FINITE_NUMBER,
        sichtbarerAnteil: OPTIONAL_FINITE_NUMBER,
        vorher: OPTIONAL_FINITE_NUMBER,
        nachher: OPTIONAL_FINITE_NUMBER,
        bereich: OPTIONAL_STRING,
        bewegt: OPTIONAL_BOOLEAN,
        hinweis: OPTIONAL_STRING
      },
      subpages: {
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        unterseiten: OPTIONAL_ARRAY,
        hinweis: OPTIONAL_STRING
      },
      tree_scroll: {
        gerollt: OPTIONAL_STRING,
        schritte: OPTIONAL_NON_NEGATIVE_NUMBER,
        ersterKnoten: OPTIONAL_STRING,
        letzterKnoten: OPTIONAL_STRING,
        sichtbareKnoten: OPTIONAL_ARRAY
      },
      tree_top: {
        gerollt: OPTIONAL_STRING,
        schritte: OPTIONAL_NON_NEGATIVE_NUMBER,
        ersterKnoten: OPTIONAL_STRING,
        sichtbareKnoten: OPTIONAL_ARRAY
      },
      vast_dialog_read: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        title: OPTIONAL_STRING,
        dialogFingerprint: OPTIONAL_SHA256,
        mappingFingerprint: OPTIONAL_SHA256,
        certificateCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        unresolvedCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        rows: OPTIONAL_ARRAY,
        duplicateTargets: OPTIONAL_ARRAY,
        riskyDuplicateTargets: OPTIONAL_ARRAY,
        safeToApply: OPTIONAL_BOOLEAN,
        ocr: OPTIONAL_OBJECT,
        note: OPTIONAL_STRING
      },
      vast_mapping_options: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mappingFingerprint: OPTIONAL_SHA256,
        expectedMappingFingerprint: OPTIONAL_SHA256,
        actualMappingFingerprint: OPTIONAL_SHA256,
        certificate: OPTIONAL_STRING,
        occurrence: OPTIONAL_NON_NEGATIVE_NUMBER,
        current: OPTIONAL_STRING,
        uiaOptions: OPTIONAL_ARRAY,
        newOcrLines: OPTIONAL_ARRAY,
        opened: OPTIONAL_BOOLEAN,
        popupConfirmed: OPTIONAL_BOOLEAN,
        closed: OPTIONAL_BOOLEAN,
        restored: OPTIONAL_BOOLEAN,
        processingError: OPTIONAL_STRING,
        note: OPTIONAL_STRING
      },
      vast_row_details: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mappingFingerprint: OPTIONAL_SHA256,
        expectedMappingFingerprint: OPTIONAL_SHA256,
        actualMappingFingerprint: OPTIONAL_SHA256,
        certificate: OPTIONAL_STRING,
        occurrence: OPTIONAL_NON_NEGATIVE_NUMBER,
        initialExpanded: OPTIONAL_BOOLEAN,
        expandedByTool: OPTIONAL_BOOLEAN,
        restored: OPTIONAL_BOOLEAN,
        expectedExpanded: OPTIONAL_BOOLEAN,
        actualExpanded: OPTIONAL_BOOLEAN,
        comparisons: OPTIONAL_ARRAY,
        structuredLines: OPTIONAL_ARRAY,
        detailLines: OPTIONAL_ARRAY,
        ocr: OPTIONAL_OBJECT,
        interactionMethod: OPTIONAL_STRING,
        processingError: OPTIONAL_STRING,
        note: OPTIONAL_STRING
      },
      vast_row_set_expanded: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        certificate: OPTIONAL_STRING,
        occurrence: OPTIONAL_NON_NEGATIVE_NUMBER,
        before: OPTIONAL_BOOLEAN,
        after: OPTIONAL_BOOLEAN,
        requested: OPTIONAL_BOOLEAN,
        clicked: OPTIONAL_BOOLEAN,
        selectedTargetBefore: OPTIONAL_STRING,
        selectedTargetAfter: OPTIONAL_STRING,
        beforeViewFingerprint: OPTIONAL_SHA256,
        afterViewFingerprint: OPTIONAL_SHA256,
        expectedMappingFingerprint: OPTIONAL_SHA256,
        actualMappingFingerprint: OPTIONAL_SHA256,
        note: OPTIONAL_STRING
      },
      window_close: {
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        titleFingerprint: OPTIONAL_SHA256,
        windowId: OPTIONAL_STRING,
        windowRole: OPTIONAL_STRING,
        closed: OPTIONAL_BOOLEAN,
        onlyTargetRemoved: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        newWindows: OPTIONAL_ARRAY,
        missingOrChangedPeers: OPTIONAL_ARRAY,
        newDialogs: OPTIONAL_ARRAY
      },
      window_restore: {
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        titleFingerprint: OPTIONAL_SHA256,
        restored: OPTIONAL_BOOLEAN,
        alreadyRestored: OPTIONAL_BOOLEAN,
        minimizedBefore: OPTIONAL_BOOLEAN,
        minimizedAfter: OPTIONAL_BOOLEAN,
        targetUnchanged: OPTIONAL_BOOLEAN,
        peerWindowsUnchanged: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        method: OPTIONAL_STRING,
        peerWindowCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        peerWindowCountBefore: OPTIONAL_NON_NEGATIVE_NUMBER,
        peerWindowCountAfter: OPTIONAL_NON_NEGATIVE_NUMBER,
        peerFingerprintBefore: OPTIONAL_SHA256,
        peerFingerprintAfter: OPTIONAL_SHA256
      }
    };
  }
});

// src/result-contract.ts
function createOperationResultOutputSchema(operation) {
  const operationFields = OPERATION_RESULT_FIELDS[operation] ?? {};
  return external_exports.object({
    ok: external_exports.boolean().describe("Operation erfolgreich"),
    kind: external_exports.string().min(1).nullable().optional().describe("Fehlerart"),
    error: external_exports.string().min(1).nullable().optional().describe("Fehlermeldung"),
    ms: external_exports.number().finite().nonnegative().nullable().optional().describe("Worker-Laufzeit in ms"),
    // Der Worker kann diese Telemetrie bei jeder Operation anhaengen, die den
    // universellen Foreground-Lease tatsaechlich erwirbt. Sie gehoert deshalb
    // zum gemeinsamen Ergebnisrand und nicht zu einzelnen Klickoperationen.
    focusTelemetry: OPTIONAL_OBJECT,
    ...operationFields
  }).passthrough().describe(`Result_${operation} v${SSE_API_RESULT_SCHEMA_VERSION}`);
}
function createOperationResultSchema(operation) {
  return SSE_API_RESULT_OUTPUT_SCHEMAS[operation].superRefine((result, context) => {
    if (result.ok === false) {
      if (typeof result.kind !== "string" || !result.kind) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["kind"], message: "Fehlerergebnis braucht kind." });
      }
      if (typeof result.error !== "string" || !result.error) {
        context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["error"], message: "Fehlerergebnis braucht error." });
      }
    }
    if (result.ok === false && result.kind === "busy" && result.reason === "session-controller-busy") {
      const exactControllerFields = {
        retryable: true,
        waited: false,
        mutationStarted: false,
        resultingState: "unchanged",
        cleanupRequired: false,
        physicalInputUsed: false,
        foregroundLeaseUsed: false
      };
      for (const [field, expected] of Object.entries(exactControllerFields)) {
        if (result[field] !== expected) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: [field],
            message: `session-controller-busy braucht ${field}=${String(expected)}.`
          });
        }
      }
    }
    if (result.ok === false && result.kind === "worker-isolation-lost" && typeof result.reason === "string" && result.reason.startsWith("controller-lock-")) {
      const exactIsolationFields = {
        retryable: false,
        resultingState: "unknown",
        cleanupRequired: true
      };
      if (["controller-lock-abandoned", "controller-lock-unavailable", "controller-lock-reentered"].includes(result.reason)) {
        Object.assign(exactIsolationFields, {
          mutationStarted: false,
          physicalInputUsed: false,
          foregroundLeaseUsed: false
        });
      }
      for (const [field, expected] of Object.entries(exactIsolationFields)) {
        if (result[field] !== expected) {
          context.addIssue({
            code: external_exports.ZodIssueCode.custom,
            path: [field],
            message: `${String(result.reason)} braucht ${field}=${String(expected)}.`
          });
        }
      }
    }
  });
}
function parseApiOperationResult(operation, value) {
  return SSE_API_RESULT_SCHEMAS[operation].parse(value);
}
var SSE_API_RESULT_SCHEMA_VERSION, API_OPERATION_NAME_SCHEMA, OPTIONAL_SUPPORTED_CASE_YEARS, OPTIONAL_CASE_IDENTITY, OPTIONAL_USTVA_PERIOD, OPTIONAL_USTVA_FLAGS, OPTIONAL_USTVA_TRANSMISSION, OPTIONAL_USTVA_READ_EFFECTS, CORE_OPERATION_RESULT_FIELDS, RESULT_FIELD_TABLES, duplicateOperations, OPERATION_RESULT_FIELDS, SSE_API_RESULT_OUTPUT_SCHEMAS, SSE_API_RESULT_SCHEMAS;
var init_result_contract = __esm({
  "src/result-contract.ts"() {
    "use strict";
    init_zod();
    init_api_contract();
    init_result_mutation_fields();
    init_result_utility_fields();
    init_operation_live_evidence();
    init_result_schema_types();
    SSE_API_RESULT_SCHEMA_VERSION = 1;
    API_OPERATION_NAME_SCHEMA = external_exports.enum(SSE_API_OPERATIONS);
    OPTIONAL_SUPPORTED_CASE_YEARS = external_exports.record(
      external_exports.string().min(1),
      external_exports.array(external_exports.number().int().nonnegative()).min(1)
    ).nullable().optional().describe("Freigegebene Falljahre je profiliertem Startmodus");
    OPTIONAL_CASE_IDENTITY = external_exports.object({
      path: external_exports.string().min(1).describe("Redigierte Ressourcenidentitaet des gestarteten Falls"),
      documentType: external_exports.string().min(1).describe("Profilierter SSE-Dokumenttyp"),
      taxYear: external_exports.number().int().nonnegative().describe("Tatsaechliches Falljahr"),
      mode: external_exports.string().min(1).describe("Verwendeter profilierter Startmodus"),
      supported: external_exports.boolean().describe("Ergebnis der Profilpruefung")
    }).passthrough().nullable().optional().describe("Profilgebundene Identitaet der gestarteten Falldatei");
    OPTIONAL_USTVA_PERIOD = external_exports.object({
      frequency: external_exports.string().nullable().describe("Normalisierte Meldefrequenz"),
      frequencyDisplay: external_exports.string().nullable().describe("Von SSE angezeigte Meldefrequenz"),
      selector: external_exports.string().nullable().describe("Aktive Zeitraumdimension month oder quarter"),
      key: external_exports.string().nullable().describe("Stabiler semantischer Periodenschluessel"),
      display: external_exports.string().nullable().describe("Von SSE angezeigter Monat oder Quartal")
    }).passthrough().nullable().optional().describe("Semantisch normalisierter UStVA-Zeitraum");
    OPTIONAL_USTVA_FLAGS = external_exports.record(external_exports.string().min(1), external_exports.boolean().nullable()).nullable().optional().describe("Semantische UStVA-Kennzeichen");
    OPTIONAL_USTVA_TRANSMISSION = external_exports.object({
      blockedByApi: external_exports.boolean().describe("Ob die API jede Uebermittlung blockiert"),
      uiGuardObserved: external_exports.boolean().nullable().describe("In der SSE-Oberflaeche beobachteter ELSTER-Guard"),
      existingSubmissionStatus: external_exports.string().min(1).describe("Status einer vorhandenen Uebermittlung in dieser Lesung")
    }).passthrough().nullable().optional().describe("Lokaler UStVA-Uebermittlungs-Guard");
    OPTIONAL_USTVA_READ_EFFECTS = external_exports.object({
      savePerformed: external_exports.boolean().describe("Ob die Lesung gespeichert hat"),
      submissionPerformed: external_exports.boolean().describe("Ob die Lesung uebermittelt hat")
    }).passthrough().nullable().optional().describe("Nachweis, dass die Lesung weder speichert noch uebermittelt");
    CORE_OPERATION_RESULT_FIELDS = {
      capabilities: {
        transport: OPTIONAL_OBJECT,
        safety: OPTIONAL_OBJECT,
        liveEvidence: external_exports.object({
          schemaVersion: external_exports.number().int().nonnegative().describe("Version des Live-Evidenzvertrags; der Produzent liefert exakt die gemeinsame Release-Konstante"),
          basis: external_exports.string().min(1).describe("Art des zugrunde liegenden Live-Nachweises; der Produzent liefert exakt die gemeinsame Release-Konstante"),
          scope: external_exports.string().min(1).describe("Aggregationsgrenze des Release-Snapshots; der Produzent liefert exakt die gemeinsame Release-Konstante"),
          profileSpecific: external_exports.boolean().describe("Ob die Matrix einen einzelnen Jahresprofilnachweis darstellt"),
          affectsAvailability: external_exports.boolean().describe("Ob die Evidenz die serverseitige Operationsfreigabe beeinflusst"),
          functionalCount: external_exports.number().int().nonnegative().describe("Anzahl mindestens einmal live erfolgreicher Operationen"),
          errorPathOnlyCount: external_exports.number().int().nonnegative().describe("Anzahl nur mit echtem Fehlerergebnis live belegter Operationen"),
          untestedCount: external_exports.number().int().nonnegative().describe("Anzahl noch nie live erfolgreicher Operationen"),
          untestedOperations: external_exports.array(external_exports.string().min(1)).describe("Noch nie live erfolgreich belegte Operationsnamen, aggregiert ueber alle Jahresprofile"),
          operationStatus: external_exports.record(API_OPERATION_NAME_SCHEMA, external_exports.enum(SSE_LIVE_EVIDENCE_STATUSES)).describe("Releasegebundener Live-Status je API-Operation, aggregiert ueber alle Jahresprofile; kein Nachweis fuer das aktuell gebundene profile.id")
        }).passthrough().optional().describe("Informative und nicht freigabewirksame Live-Evidenzmatrix"),
        profile: OPTIONAL_OBJECT,
        operationPolicy: OPTIONAL_OBJECT,
        buildDriftPolicy: OPTIONAL_STRING
      },
      product_info: {
        profileId: OPTIONAL_STRING,
        profileStatus: OPTIONAL_STRING,
        operationAccess: OPTIONAL_STRING,
        product: OPTIONAL_STRING,
        taxYear: OPTIONAL_NON_NEGATIVE_NUMBER,
        supportedCaseYears: OPTIONAL_SUPPORTED_CASE_YEARS,
        buildDrift: OPTIONAL_OBJECT
      },
      health: { running: OPTIONAL_BOOLEAN, buildDrift: OPTIONAL_OBJECT, windows: OPTIONAL_ARRAY },
      windows: { windows: OPTIONAL_ARRAY },
      instances: {
        instances: OPTIONAL_ARRAY,
        count: OPTIONAL_NON_NEGATIVE_NUMBER,
        ambiguous: OPTIONAL_BOOLEAN,
        advice: OPTIONAL_STRING
      },
      list_cases: {
        dir: OPTIONAL_STRING,
        cases: OPTIONAL_CASE_LIST,
        count: OPTIONAL_NON_NEGATIVE_NUMBER,
        parserError: OPTIONAL_STRING
      },
      case_hash: {
        path: OPTIONAL_STRING,
        exists: OPTIONAL_BOOLEAN,
        size: OPTIONAL_NON_NEGATIVE_NUMBER,
        mtimeUtc: OPTIONAL_STRING,
        sha256: OPTIONAL_SHA256,
        header: OPTIONAL_OBJECT,
        transmitted: OPTIONAL_TRANSMISSION_STATE,
        transmittedReason: OPTIONAL_STRING
      },
      workspace_status: {
        profileId: OPTIONAL_STRING,
        configurationFingerprint: OPTIONAL_STRING,
        workspaceReady: OPTIONAL_BOOLEAN,
        resultAreaReady: OPTIONAL_BOOLEAN,
        caseDirectoryConfigured: OPTIONAL_BOOLEAN,
        caseDirectoryReady: OPTIONAL_BOOLEAN,
        documentAreaReady: OPTIONAL_BOOLEAN,
        backupAreaReady: OPTIONAL_BOOLEAN,
        sseExecutableConfigured: OPTIONAL_BOOLEAN
      },
      workspace_file_list: { files: OPTIONAL_ARRAY, truncated: OPTIONAL_BOOLEAN },
      workspace_file_read_text: { text: OPTIONAL_STRING, sha256: OPTIONAL_STRING },
      workspace_file_write_text: { ref: OPTIONAL_STRING, sha256: OPTIONAL_STRING, bytes: OPTIONAL_NON_NEGATIVE_NUMBER },
      page: { ueberschrift: OPTIONAL_STRING, hinweis: OPTIONAL_STRING },
      known_page_state: {
        pageId: OPTIONAL_STRING,
        expectedHeading: OPTIONAL_STRING,
        onExpectedPage: OPTIONAL_BOOLEAN,
        heading: OPTIONAL_STRING,
        dirty: OPTIONAL_BOOLEAN,
        fields: OPTIONAL_ARRAY,
        // Inhaltsfingerprint der gelesenen Seite, kein Zaehler: Er wechselt genau
        // dann, wenn sich Ueberschrift, Feldwerte oder Aenderungszustand bewegen.
        epoch: OPTIONAL_STRING,
        privateValuesPersisted: OPTIONAL_BOOLEAN
      },
      read_page: { heading: OPTIONAL_STRING, bounds: OPTIONAL_OBJECT, lines: OPTIONAL_ARRAY, stats: OPTIONAL_OBJECT },
      read_full: {
        ueberschrift: OPTIONAL_STRING,
        gerollt: OPTIONAL_BOOLEAN,
        stufen: OPTIONAL_NON_NEGATIVE_NUMBER,
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        zeilen: OPTIONAL_ARRAY
      },
      read_table: {
        headers: OPTIONAL_ARRAY,
        rows: OPTIONAL_ARRAY,
        rowCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        ausgeschlosseneFenster: OPTIONAL_ARRAY,
        stats: OPTIONAL_OBJECT,
        incomplete: OPTIONAL_BOOLEAN
      },
      collect: {
        vollstaendig: OPTIONAL_BOOLEAN,
        stopKind: OPTIONAL_STRING,
        stopReason: OPTIONAL_STRING,
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        ueberschriften: OPTIONAL_ARRAY,
        seiten: OPTIONAL_ARRAY,
        currentHeadingAfter: OPTIONAL_STRING,
        advancedAfterLastCaptured: OPTIONAL_BOOLEAN
      },
      verify: {
        vergleichOk: OPTIONAL_BOOLEAN,
        sourceHash: OPTIONAL_SHA256,
        sourceHashBefore: OPTIONAL_SHA256,
        sourceHashAfter: OPTIONAL_SHA256,
        sourceVollstaendig: OPTIONAL_BOOLEAN,
        sourceStopKind: OPTIONAL_STRING,
        sourceStopReason: OPTIONAL_STRING,
        geprueft: OPTIONAL_NON_NEGATIVE_NUMBER,
        abweichungen: OPTIONAL_NON_NEGATIVE_NUMBER,
        ergebnis: OPTIONAL_ARRAY,
        zusammenfassung: OPTIONAL_STRING
      },
      // 'summe' ist der gelesene Wert der gebundenen Kontrollsumme. Ohne ihn
      // koennte ein Aufrufer die Pflichtangaben expectedBefore/expectedAfter der
      // Tabellenmutationen nicht ermitteln; er bleibt null, wenn kein sumLabel
      // angegeben wurde.
      table_read: {
        zeilen: OPTIONAL_ARRAY,
        vollstaendig: OPTIONAL_BOOLEAN,
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        summe: OPTIONAL_STRING
      },
      result_details: { zeilen: OPTIONAL_ARRAY, vollstaendig: OPTIONAL_BOOLEAN, anzahl: OPTIONAL_NON_NEGATIVE_NUMBER },
      snapshot: { nodes: OPTIONAL_ARRAY, count: OPTIONAL_NON_NEGATIVE_NUMBER, stats: OPTIONAL_OBJECT, toolWindow: OPTIONAL_STRING },
      snapshot_compare: {
        equivalent: OPTIONAL_BOOLEAN,
        runtimeIdChurnCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        missingCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        extraCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        metadataMismatchCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        valueMismatchCount: OPTIONAL_NON_NEGATIVE_NUMBER
      },
      receipt_manager_list: {
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        managerHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        state: OPTIONAL_STRING,
        stateFingerprint: OPTIONAL_SHA256,
        count: OPTIONAL_NON_NEGATIVE_NUMBER,
        countSource: OPTIONAL_STRING,
        headers: OPTIONAL_STRING_ARRAY,
        rows: OPTIONAL_ARRAY,
        draftCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        listFingerprint: OPTIONAL_SHA256,
        rowsComplete: OPTIONAL_BOOLEAN,
        matchedCount: OPTIONAL_NON_NEGATIVE_NUMBER,
        matches: OPTIONAL_ARRAY,
        matchesComplete: OPTIONAL_BOOLEAN,
        ungespeichert: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        hinweis: OPTIONAL_STRING
      },
      receipt_manager_classification_options: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        kind: OPTIONAL_STRING,
        row: OPTIONAL_OBJECT,
        options: OPTIONAL_ARRAY,
        selected: OPTIONAL_STRING_ARRAY,
        optionsFingerprint: OPTIONAL_SHA256,
        dialogFingerprint: OPTIONAL_SHA256,
        dialogClosed: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN
      },
      receipt_manager_import: {
        ...RECEIPT_FOREGROUND_BLOCK_RESULT_FIELDS,
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        hwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        mainHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        managerHwnd: OPTIONAL_NON_NEGATIVE_NUMBER,
        selected: OPTIONAL_STRING,
        sha256: OPTIONAL_SHA256,
        countBefore: OPTIONAL_NON_NEGATIVE_NUMBER,
        countAfter: OPTIONAL_NON_NEGATIVE_NUMBER,
        listFingerprintBefore: OPTIONAL_SHA256,
        listFingerprintAfter: OPTIONAL_SHA256,
        importedRow: OPTIONAL_OBJECT,
        detailFingerprint: OPTIONAL_SHA256,
        fields: OPTIONAL_ARRAY,
        previewFingerprintBefore: OPTIONAL_SHA256,
        previewFingerprintAfter: OPTIONAL_SHA256,
        previewChanged: OPTIONAL_BOOLEAN,
        sourceHashStable: OPTIONAL_BOOLEAN,
        existingRowsUnchanged: OPTIONAL_BOOLEAN,
        dialogClosed: OPTIONAL_BOOLEAN,
        windowSetUnchanged: OPTIONAL_BOOLEAN,
        cleanupRequired: OPTIONAL_BOOLEAN,
        ungespeichertVorher: OPTIONAL_BOOLEAN,
        ungespeichertNachher: OPTIONAL_BOOLEAN,
        dirtyStateUnchanged: OPTIONAL_BOOLEAN,
        physicalInputUsed: OPTIONAL_BOOLEAN,
        foregroundLeaseUsed: OPTIONAL_BOOLEAN,
        verified: OPTIONAL_BOOLEAN,
        createClickBinding: OPTIONAL_OBJECT,
        attachClickBinding: OPTIONAL_OBJECT
      },
      checker_results: {
        aktiv: OPTIONAL_BOOLEAN,
        konsistent: OPTIONAL_BOOLEAN,
        gesamt: OPTIONAL_NON_NEGATIVE_NUMBER,
        fragenWarnungen: OPTIONAL_ARRAY,
        tippsZusatzinfos: OPTIONAL_ARRAY,
        sonstige: OPTIONAL_ARRAY,
        aufgeklappt: OPTIONAL_ARRAY
      },
      checker_run: { gesamt: OPTIONAL_NON_NEGATIVE_NUMBER, konsistent: OPTIONAL_BOOLEAN },
      click: CLICK_RESULT_FIELDS,
      checker_open: {
        meldung: OPTIONAL_STRING,
        text: OPTIONAL_STRING,
        ocrOk: OPTIONAL_BOOLEAN,
        kontrollbildEnthalten: OPTIONAL_BOOLEAN,
        schemaVersion: OPTIONAL_NON_NEGATIVE_NUMBER,
        planKind: OPTIONAL_STRING,
        resultingState: OPTIONAL_STRING,
        cleanupRequired: OPTIONAL_BOOLEAN,
        performance: OPTIONAL_OBJECT
      },
      warning_popup_read: { active: OPTIONAL_BOOLEAN, title: OPTIONAL_STRING, text: OPTIONAL_STRING },
      screenshot: {
        shot: external_exports.object({
          path: external_exports.string().describe("Maschinenlokale Ergebnisreferenz oder interner Pfad"),
          w: external_exports.number().finite().nonnegative().describe("Bildbreite"),
          h: external_exports.number().finite().nonnegative().describe("Bildhoehe")
        }).passthrough().nullable().optional().describe("Metadaten des erzeugten Kontrollbilds")
      },
      goto: { erreicht: OPTIONAL_BOOLEAN, pageId: OPTIONAL_STRING, ueberschrift: OPTIONAL_STRING, weg: OPTIONAL_ARRAY },
      launch: {
        pid: OPTIONAL_NON_NEGATIVE_NUMBER,
        instance: OPTIONAL_OBJECT,
        ready: OPTIONAL_BOOLEAN,
        case: OPTIONAL_CASE_IDENTITY
      },
      close: { stillRunning: OPTIONAL_BOOLEAN, killed: OPTIONAL_BOOLEAN },
      desktop_start: { pid: OPTIONAL_NON_NEGATIVE_NUMBER, desktop: OPTIONAL_STRING },
      desktop_status: {
        aktiv: OPTIONAL_BOOLEAN,
        desktop: OPTIONAL_STRING,
        sseLaeuft: OPTIONAL_BOOLEAN,
        markeVeraltet: OPTIONAL_BOOLEAN
      },
      desktop_stop: {
        hartBeendet: OPTIONAL_BOOLEAN,
        desktopMarkeEntfernt: OPTIONAL_BOOLEAN,
        hauptfensterVorher: OPTIONAL_NON_NEGATIVE_NUMBER
      },
      dialog_list: { dialogs: OPTIONAL_ARRAY, windows: OPTIONAL_ARRAY, count: OPTIONAL_NON_NEGATIVE_NUMBER },
      dialog_answer: {
        closed: OPTIONAL_BOOLEAN,
        answered: OPTIONAL_STRING_OR_BOOLEAN,
        recoveryDiscarded: OPTIONAL_BOOLEAN,
        caseHashUnchanged: OPTIONAL_BOOLEAN,
        caseBindingModeAfter: OPTIONAL_STRING,
        startedWithoutCaseFile: OPTIONAL_BOOLEAN
      },
      ui_state: { running: OPTIONAL_BOOLEAN, heading: OPTIONAL_STRING, blockiert: OPTIONAL_BOOLEAN },
      ustva_read: {
        page: OPTIONAL_STRING,
        periods: OPTIONAL_ARRAY,
        pageKind: OPTIONAL_STRING,
        taxYear: OPTIONAL_NON_NEGATIVE_NUMBER,
        period: OPTIONAL_USTVA_PERIOD,
        flags: OPTIONAL_USTVA_FLAGS,
        amounts: OPTIONAL_OBJECT,
        sections: OPTIONAL_STRING_ARRAY,
        transmission: OPTIONAL_USTVA_TRANSMISSION,
        effects: OPTIONAL_USTVA_READ_EFFECTS
      },
      scenario_run: { steps: OPTIONAL_ARRAY, resultRef: OPTIONAL_STRING, sha256: OPTIONAL_STRING },
      make_working_copy: {
        copied: OPTIONAL_BOOLEAN,
        source: OPTIONAL_STRING,
        target: OPTIONAL_STRING,
        sourceHash: OPTIONAL_SHA256,
        targetHash: OPTIONAL_SHA256,
        verified: OPTIONAL_BOOLEAN,
        header: OPTIONAL_OBJECT,
        transmitted: OPTIONAL_TRANSMISSION_STATE,
        sourceBefore: OPTIONAL_SHA256,
        sourceAfter: OPTIONAL_SHA256,
        targetStillOwned: OPTIONAL_BOOLEAN,
        rolledBack: OPTIONAL_BOOLEAN
      },
      backup_cases: {
        dest: OPTIONAL_STRING,
        anzahl: OPTIONAL_NON_NEGATIVE_NUMBER,
        files: OPTIONAL_ARRAY,
        hashes: OPTIONAL_ARRAY,
        manifest: OPTIONAL_STRING,
        verified: OPTIONAL_BOOLEAN,
        copiedBeforeFailure: OPTIONAL_NON_NEGATIVE_NUMBER,
        rolledBack: OPTIONAL_BOOLEAN,
        retainedTargets: OPTIONAL_STRING_ARRAY,
        backupStillExists: OPTIONAL_BOOLEAN
      },
      archive_cases: {
        archived: OPTIONAL_NON_NEGATIVE_NUMBER,
        dest: OPTIONAL_STRING,
        files: OPTIONAL_ARRAY,
        remaining: OPTIONAL_ARRAY,
        manifest: OPTIONAL_STRING,
        verified: OPTIONAL_BOOLEAN,
        recoverable: OPTIONAL_BOOLEAN,
        movedBeforeFailure: OPTIONAL_NON_NEGATIVE_NUMBER,
        rolledBack: OPTIONAL_BOOLEAN,
        rollbackFiles: OPTIONAL_ARRAY,
        recoveryFiles: OPTIONAL_STRING_ARRAY,
        retainedTargets: OPTIONAL_STRING_ARRAY,
        archiveStillExists: OPTIONAL_BOOLEAN
      }
    };
    RESULT_FIELD_TABLES = [
      CORE_OPERATION_RESULT_FIELDS,
      MUTATION_OPERATION_RESULT_FIELDS,
      UTILITY_OPERATION_RESULT_FIELDS
    ];
    duplicateOperations = RESULT_FIELD_TABLES.flatMap((table) => Object.keys(table)).filter((operation, index, operations) => operations.indexOf(operation) !== index);
    if (duplicateOperations.length > 0) {
      throw new Error(`Doppelte Operations-Ergebnisvertraege: ${[...new Set(duplicateOperations)].join(", ")}`);
    }
    OPERATION_RESULT_FIELDS = Object.freeze(Object.assign({}, ...RESULT_FIELD_TABLES));
    SSE_API_RESULT_OUTPUT_SCHEMAS = Object.freeze(Object.fromEntries(
      SSE_API_OPERATIONS.map((operation) => [operation, createOperationResultOutputSchema(operation)])
    ));
    SSE_API_RESULT_SCHEMAS = Object.freeze(Object.fromEntries(
      SSE_API_OPERATIONS.map((operation) => [operation, createOperationResultSchema(operation)])
    ));
  }
});

// src/api-discovery.ts
function createArgumentSchemas() {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [
      operation,
      zodToJsonSchema(SSE_API_OPERATION_SCHEMAS[operation], {
        target: "jsonSchema7",
        $refStrategy: "none",
        effectStrategy: "input"
      })
    ])
  ));
}
function createOperationTraits() {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [operation, Object.freeze(operationAnnotations(operation))])
  ));
}
function createResultSchemas() {
  return Object.freeze(Object.fromEntries(
    SSE_API_OPERATIONS.map((operation) => [
      operation,
      zodToJsonSchema(SSE_API_RESULT_OUTPUT_SCHEMAS[operation], {
        target: "jsonSchema7",
        $refStrategy: "none",
        effectStrategy: "input"
      })
    ])
  ));
}
function apiOperationDiscovery(operation) {
  return Object.freeze({
    schemaVersion: SSE_API_DISCOVERY.schemaVersion,
    apiVersion: SSE_API_DISCOVERY.apiVersion,
    operation,
    argumentSchema: SSE_API_DISCOVERY.argumentSchemas[operation],
    resultSchemaVersion: SSE_API_DISCOVERY.resultSchemaVersion,
    resultSchema: SSE_API_DISCOVERY.resultSchemas[operation],
    operationTraits: SSE_API_DISCOVERY.operationTraits[operation],
    planning: SSE_API_DISCOVERY.planning,
    limits: SSE_API_DISCOVERY.limits,
    safety: SSE_API_DISCOVERY.safety,
    liveEvidence: SSE_API_DISCOVERY.liveEvidence
  });
}
var SSE_API_DISCOVERY;
var init_api_discovery = __esm({
  "src/api-discovery.ts"() {
    "use strict";
    init_esm();
    init_api_contract();
    init_capabilities();
    init_operation_catalog();
    init_operation_traits();
    init_result_contract();
    SSE_API_DISCOVERY = Object.freeze({
      schemaVersion: 1,
      apiVersion: SSE_API_VERSION,
      operations: SSE_API_OPERATIONS,
      argumentSchemas: createArgumentSchemas(),
      resultSchemaVersion: SSE_API_RESULT_SCHEMA_VERSION,
      resultSchemas: createResultSchemas(),
      operationTraits: createOperationTraits(),
      planning: Object.freeze({
        fallbackStages: SSE_CAPABILITIES.fallbackStages,
        selectors: SSE_CAPABILITIES.selectors,
        click: SSE_CAPABILITIES.click,
        dialogs: SSE_CAPABILITIES.dialogs,
        concurrency: SSE_CAPABILITIES.concurrency,
        batching: SSE_CAPABILITIES.batching
      }),
      limits: SSE_CAPABILITIES.limits,
      safety: SSE_CAPABILITIES.safety,
      liveEvidence: SSE_CAPABILITIES.liveEvidence
    });
  }
});

// src/api-openapi.ts
function resultProperty(operation, property) {
  const schema = SSE_API_DISCOVERY.resultSchemas[operation];
  const value = schema.properties?.[property];
  if (!value) throw new Error(`Result_${operation}.${property} fehlt fuer die OpenAPI-Komprimierung.`);
  return structuredClone(value);
}
function compactResultSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const typed = structuredClone(schema);
  if (!typed.properties) return schema;
  const operationProperties = Object.entries(typed.properties).filter(([property]) => !RESULT_TRANSPORT_PROPERTIES.has(property));
  return {
    allOf: [{ $ref: "#/components/schemas/OperationResultEnvelope" }],
    properties: Object.fromEntries(operationProperties.map(([property, value]) => [
      property,
      structuredClone(resultValueReferences.get(JSON.stringify(value)) ?? value)
    ])),
    description: typed.description
  };
}
var schemaName, resultSchemaName, argumentComponents, resultValueComponents, resultValueReferences, RESULT_TRANSPORT_PROPERTIES, resultEnvelopeComponent, resultComponents, operationPaths, SSE_OPENAPI_DOCUMENT;
var init_api_openapi = __esm({
  "src/api-openapi.ts"() {
    "use strict";
    init_api_contract();
    init_api_discovery();
    init_version();
    schemaName = (operation) => `Args_${operation}`;
    resultSchemaName = (operation) => `Result_${operation}`;
    argumentComponents = Object.freeze(Object.fromEntries(
      SSE_API_OPERATIONS.map((operation) => [schemaName(operation), SSE_API_DISCOVERY.argumentSchemas[operation]])
    ));
    resultValueComponents = Object.freeze({
      ResultOk: resultProperty("health", "ok"),
      ResultKind: resultProperty("health", "kind"),
      ResultError: resultProperty("health", "error"),
      ResultWorkerMs: resultProperty("health", "ms"),
      OptionalText: resultProperty("page", "ueberschrift"),
      OptionalFlag: resultProperty("health", "running"),
      OptionalObject: resultProperty("capabilities", "transport"),
      OptionalArray: resultProperty("health", "windows"),
      OptionalNonNegativeNumber: resultProperty("list_cases", "count"),
      OptionalSha256: resultProperty("case_hash", "sha256"),
      OptionalStringList: resultProperty("backup_cases", "retainedTargets"),
      OptionalTransmissionState: resultProperty("case_hash", "transmitted")
    });
    resultValueReferences = new Map(Object.entries(resultValueComponents).map(([name, schema]) => [JSON.stringify(schema), { $ref: `#/components/schemas/${name}` }]));
    RESULT_TRANSPORT_PROPERTIES = /* @__PURE__ */ new Set(["ok", "kind", "error", "ms"]);
    resultEnvelopeComponent = Object.freeze({
      type: "object",
      properties: {
        ok: { $ref: "#/components/schemas/ResultOk" },
        kind: { $ref: "#/components/schemas/ResultKind" },
        error: { $ref: "#/components/schemas/ResultError" },
        ms: { $ref: "#/components/schemas/ResultWorkerMs" }
      },
      required: ["ok"],
      additionalProperties: true,
      description: "Gemeinsamer Transportumschlag jedes Operationsergebnisses"
    });
    resultComponents = Object.freeze(Object.fromEntries(
      SSE_API_OPERATIONS.map((operation) => [
        resultSchemaName(operation),
        compactResultSchema(SSE_API_DISCOVERY.resultSchemas[operation])
      ])
    ));
    operationPaths = Object.freeze(Object.fromEntries(
      SSE_API_OPERATIONS.map((operation) => {
        const traits = SSE_API_DISCOVERY.operationTraits[operation];
        return [
          `/${SSE_API_VERSION}/operations/${operation}`,
          {
            get: {
              operationId: `describe_${operation}`,
              summary: `Schema und Sicherheitsmerkmale fuer ${operation}`,
              tags: ["discovery"],
              responses: {
                "200": { $ref: "#/components/responses/OperationDiscovery" },
                "403": { $ref: "#/components/responses/ApiError" },
                "404": { $ref: "#/components/responses/ApiError" }
              }
            },
            post: {
              operationId: operation,
              summary: `Lokale SteuerSparErklaerung-Operation ${operation}`,
              tags: [traits.readOnlyHint ? "read-only" : "stateful"],
              "x-sse-read-only": traits.readOnlyHint,
              "x-sse-destructive": traits.destructiveHint,
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        args: { $ref: `#/components/schemas/${schemaName(operation)}` },
                        timeoutMs: {
                          type: "integer",
                          minimum: 200,
                          maximum: MAX_OPERATION_TIMEOUT_MS
                        }
                      },
                      additionalProperties: false
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Strukturiertes lokales Operationsergebnis",
                  content: {
                    "application/json": {
                      schema: {
                        allOf: [
                          { $ref: "#/components/schemas/OperationEnvelope" },
                          {
                            type: "object",
                            properties: {
                              operation: { const: operation },
                              result: { $ref: `#/components/schemas/${resultSchemaName(operation)}` }
                            }
                          }
                        ]
                      }
                    }
                  }
                },
                "400": { $ref: "#/components/responses/ApiError" },
                "403": { $ref: "#/components/responses/ApiError" },
                "404": { $ref: "#/components/responses/ApiError" },
                "405": { $ref: "#/components/responses/ApiError" },
                "413": { $ref: "#/components/responses/ApiError" },
                "415": { $ref: "#/components/responses/ApiError" },
                "502": { $ref: "#/components/responses/ApiError" }
              }
            }
          }
        ];
      })
    ));
    SSE_OPENAPI_DOCUMENT = Object.freeze({
      openapi: "3.1.0",
      info: {
        title: "Unoffizielle lokale SteuerSparErklaerung API",
        version: SSE_API_VERSION,
        description: "Loopback-only Windows-UI-Automation. ELSTER, Versand und Steueruebermittlung sind dauerhaft gesperrt. Es gibt keine Anmeldung: Jeder lokale Prozess darf die API aufrufen, ein Browser nicht. Anfragen mit 'Origin' oder 'Sec-Fetch-Site' sowie einer 'Host'-Kopfzeile ausserhalb von Loopback werden mit 403 abgelehnt."
      },
      servers: [{ url: "/", description: "Aktueller lokaler API-Server" }],
      paths: Object.freeze({
        "/healthz": {
          get: {
            operationId: "healthz",
            summary: "Lokale API-Erreichbarkeit und Version",
            tags: ["diagnostics"],
            responses: {
              "200": {
                description: "API-Prozess ist erreichbar",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["ok", "apiVersion", "packageName", "packageVersion", "processId", "instanceId", "configurationFingerprint", "inFlight", "prewarm"],
                      properties: {
                        ok: { const: true },
                        apiVersion: { const: SSE_API_VERSION },
                        packageName: { const: SSE_API_PACKAGE_NAME },
                        packageVersion: { const: SSE_PACKAGE_VERSION },
                        processId: { type: "integer", minimum: 1, maximum: 4294967295 },
                        instanceId: { type: "string", format: "uuid" },
                        configurationFingerprint: { type: "string", pattern: "^[0-9a-f]{64}$" },
                        prewarm: {
                          description: "Bereitschaft des vorgewaermten Arbeiters. Fehlt er, ist der naechste Aufruf nur langsamer, nie falsch.",
                          oneOf: [
                            { type: "null" },
                            {
                              type: "object",
                              required: ["ready", "failure"],
                              properties: {
                                ready: { type: "boolean" },
                                failure: { oneOf: [{ type: "null" }, { type: "string" }] }
                              },
                              additionalProperties: false
                            }
                          ]
                        },
                        inFlight: {
                          description: "Laufende Operation oder null. Diese Route startet keinen Arbeitsprozess und antwortet deshalb auch waehrend einer langen Operation.",
                          oneOf: [
                            { type: "null" },
                            {
                              type: "object",
                              required: ["operation", "requestId", "startedAt", "elapsedMs"],
                              properties: {
                                operation: { type: "string" },
                                requestId: { type: "string" },
                                startedAt: { type: "integer" },
                                elapsedMs: { type: "integer" }
                              },
                              additionalProperties: false
                            }
                          ]
                        }
                      },
                      additionalProperties: false
                    }
                  }
                }
              }
            }
          }
        },
        [`/${SSE_API_VERSION}/operations`]: {
          get: {
            operationId: "list_operations",
            summary: "Vollstaendiger API-Katalog mit Schemas und Sicherheitsmerkmalen",
            tags: ["discovery"],
            responses: {
              "200": {
                description: "Gesamter authentifizierter API-Katalog",
                content: { "application/json": { schema: { type: "object" } } }
              },
              "403": { $ref: "#/components/responses/ApiError" }
            }
          }
        },
        [`/${SSE_API_VERSION}/openapi.json`]: {
          get: {
            operationId: "get_openapi",
            summary: "Diese generierte OpenAPI-3.1-Beschreibung",
            tags: ["discovery"],
            responses: {
              "200": {
                description: "OpenAPI-3.1-Dokument",
                content: { "application/json": { schema: { type: "object" } } }
              },
              "403": { $ref: "#/components/responses/ApiError" }
            }
          }
        },
        ...operationPaths
      }),
      components: {
        schemas: {
          ...argumentComponents,
          ...resultValueComponents,
          OperationResultEnvelope: resultEnvelopeComponent,
          ...resultComponents,
          OperationEnvelope: {
            type: "object",
            required: ["apiVersion", "requestId", "operation", "durationMs", "result"],
            properties: {
              apiVersion: { const: SSE_API_VERSION },
              requestId: { type: "string", format: "uuid" },
              operation: { type: "string", enum: SSE_API_OPERATIONS },
              durationMs: { type: "integer", minimum: 0 },
              result: {
                type: "object",
                required: ["ok"],
                properties: { ok: { type: "boolean" } },
                additionalProperties: true
              }
            },
            additionalProperties: false
          },
          ApiErrorEnvelope: {
            type: "object",
            required: ["apiVersion", "requestId", "error"],
            properties: {
              apiVersion: { const: SSE_API_VERSION },
              requestId: { type: "string", format: "uuid" },
              error: {
                type: "object",
                required: ["code", "message"],
                properties: { code: { type: "string" }, message: { type: "string" } },
                additionalProperties: false
              }
            },
            additionalProperties: false
          },
          OperationDiscoveryDocument: {
            type: "object",
            required: [
              "schemaVersion",
              "apiVersion",
              "operation",
              "argumentSchema",
              "resultSchemaVersion",
              "resultSchema",
              "operationTraits",
              "planning",
              "limits",
              "safety"
            ],
            properties: {
              schemaVersion: { const: 1 },
              apiVersion: { const: SSE_API_VERSION },
              operation: { type: "string", enum: SSE_API_OPERATIONS },
              argumentSchema: { type: "object" },
              resultSchemaVersion: { const: SSE_API_DISCOVERY.resultSchemaVersion },
              resultSchema: { type: "object" },
              operationTraits: { type: "object" },
              planning: { $ref: "#/components/schemas/PlanningContract" },
              limits: { type: "object" },
              safety: { type: "object" }
            },
            additionalProperties: false
          },
          PlanningContract: {
            type: "object",
            required: ["fallbackStages", "selectors", "click", "dialogs"],
            properties: {
              fallbackStages: {
                type: "array",
                minItems: 4,
                items: {
                  type: "object",
                  required: ["intent", "operations", "rule"],
                  properties: {
                    intent: { type: "string", minLength: 1 },
                    operations: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", enum: SSE_API_OPERATIONS }
                    },
                    rule: { type: "string", minLength: 1 }
                  },
                  additionalProperties: false
                }
              },
              selectors: {
                type: "object",
                required: ["preferred", "containsRequiresUniqueMatch", "expectedPageRecommended"],
                properties: {
                  preferred: { type: "array", items: { type: "string", enum: ["aid", "rid", "name"] } },
                  containsRequiresUniqueMatch: { type: "boolean" },
                  expectedPageRecommended: { type: "boolean" }
                },
                additionalProperties: false
              },
              click: {
                type: "object",
                required: ["patterns", "genericToggleBlocked", "blockedLegacyPatterns", "safePatterns", "observedMethods"],
                properties: {
                  patterns: { type: "array", items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.patterns } },
                  genericToggleBlocked: { const: true },
                  blockedLegacyPatterns: {
                    type: "array",
                    items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.blockedLegacyPatterns }
                  },
                  safePatterns: { type: "array", items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.safePatterns } },
                  observedMethods: {
                    type: "array",
                    items: { type: "string", enum: SSE_API_DISCOVERY.planning.click.observedMethods }
                  }
                },
                additionalProperties: false
              },
              dialogs: {
                type: "object",
                required: ["allowedButtons", "unsupportedButtonsAreReportedButBlocked", "requiresWindowAndFingerprint", "warningAlsoRequiresBodyFingerprint"],
                properties: {
                  allowedButtons: {
                    type: "array",
                    items: { type: "string", enum: SSE_API_DISCOVERY.planning.dialogs.allowedButtons }
                  },
                  unsupportedButtonsAreReportedButBlocked: { const: true },
                  requiresWindowAndFingerprint: { const: true },
                  warningAlsoRequiresBodyFingerprint: { const: true }
                },
                additionalProperties: false
              }
            },
            additionalProperties: false
          }
        },
        responses: {
          OperationDiscovery: {
            description: "Kleine Einzel-Discovery fuer genau diese Operation",
            content: { "application/json": { schema: { $ref: "#/components/schemas/OperationDiscoveryDocument" } } }
          },
          ApiError: {
            description: "Strukturierter API-Fehler ohne Argument- oder Ergebnisprotokollierung",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } }
          }
        }
      }
    });
  }
});

// src/api-supervisor-contract.ts
var SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT, SSE_EXPECTED_API_BASE_URL, SSE_API_INSTANCE_HEADER;
var init_api_supervisor_contract = __esm({
  "src/api-supervisor-contract.ts"() {
    "use strict";
    SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT = "SSE_INTERNAL_EXPECTED_API_CONFIGURATION_FINGERPRINT";
    SSE_EXPECTED_API_BASE_URL = "SSE_INTERNAL_EXPECTED_API_BASE_URL";
    SSE_API_INSTANCE_HEADER = "x-sse-api-instance-id";
  }
});

// src/api-server.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import {
  createServer
} from "node:http";
function sendJsonPayload(response, status, payload, byteLength, headers = {}) {
  if (response.writableEnded || response.destroyed) return "unavailable";
  if (byteLength > MAX_API_RESPONSE_BYTES) return "too-large";
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": byteLength,
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    ...headers
  });
  response.end(payload);
  return "sent";
}
function sendJsonBytes(response, status, bytes, headers = {}) {
  return sendJsonPayload(response, status, bytes, bytes.length, headers);
}
function sendJson(response, status, body, headers = {}) {
  const json = JSON.stringify(body);
  return sendJsonPayload(response, status, json, Buffer.byteLength(json), headers);
}
function serializeStaticApiDocument(name, body) {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  if (bytes.length > MAX_API_RESPONSE_BYTES) {
    throw new Error(`${name} ist groesser als das API-Antwortlimit.`);
  }
  return bytes;
}
function apiError(requestId, code, message) {
  return { apiVersion: SSE_API_VERSION, requestId, error: { code, message } };
}
function foreignClientReason(request) {
  let hostHeaders = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "host") hostHeaders += 1;
  }
  if (hostHeaders > 1) return "Anfragen mit mehreren 'Host'-Kopfzeilen sind mehrdeutig.";
  const host = typeof request.headers.host === "string" ? request.headers.host.trim().toLowerCase() : "";
  const hostname = /^(\[[^\]]+\]|[^:]+)(?::\d{1,5})?$/u.exec(host)?.[1];
  if (!hostname || !LOOPBACK_HOSTNAMES.has(hostname)) {
    return "Die lokale SSE-API antwortet nur auf Loopback-Namen in der 'Host'-Kopfzeile.";
  }
  if (request.headers.origin !== void 0) {
    return "Anfragen mit 'Origin' kommen aus einem Browser und duerfen die Steuersoftware nicht steuern.";
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (typeof fetchSite === "string" && fetchSite !== "none") {
    return "Anfragen mit 'Sec-Fetch-Site' kommen aus einem Browser und duerfen die Steuersoftware nicht steuern.";
  }
  return null;
}
function hasJsonContentType(request) {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" && contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
async function readJson(request) {
  const advertisedLength = request.headers["content-length"];
  if (typeof advertisedLength === "string" && /^\d+$/.test(advertisedLength) && Number(advertisedLength) > MAX_API_BODY_BYTES) {
    throw new ApiRequestError(`Anfrage ist groesser als ${MAX_API_BODY_BYTES} Bytes.`, 413, "payload-too-large");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_API_BODY_BYTES) {
      throw new ApiRequestError(`Anfrage ist groesser als ${MAX_API_BODY_BYTES} Bytes.`, 413, "payload-too-large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    throw new ApiRequestError("Anfragekoerper darf bei POST nicht leer sein.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiRequestError("Anfragekoerper muss gueltiges UTF-8 enthalten.");
  }
  return JSON.parse(text);
}
function parseOperationRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError("Anfragekoerper muss ein JSON-Objekt sein.");
  }
  const body = value;
  const unknownFields = Object.keys(body).filter((key) => key !== "args" && key !== "timeoutMs");
  if (unknownFields.length) {
    throw new ApiRequestError(`Unbekanntes Anfragefeld: '${unknownFields.sort()[0]}'.`);
  }
  const args = body.args ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ApiRequestError("'args' muss ein JSON-Objekt sein.");
  }
  const timeoutMs = body.timeoutMs;
  if (timeoutMs !== void 0 && (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 200 || Number(timeoutMs) > MAX_OPERATION_TIMEOUT_MS)) {
    throw new ApiRequestError(`'timeoutMs' muss zwischen 200 und ${MAX_OPERATION_TIMEOUT_MS} liegen.`);
  }
  return {
    args,
    ...timeoutMs === void 0 ? {} : { timeoutMs }
  };
}
function createSseApiServer(options) {
  const { execute } = options;
  const instanceId = options.instanceId ?? randomUUID3();
  const log = options.log ?? (() => void 0);
  let inFlight = null;
  const inFlightSnapshot = (now = Date.now()) => inFlight ? { ...inFlight, elapsedMs: now - inFlight.startedAt } : null;
  const safeLog = (record) => {
    try {
      log(record);
    } catch {
    }
  };
  const server = createServer(async (request, response) => {
    const requestId = randomUUID3();
    const started = Date.now();
    const foreignClient = foreignClientReason(request);
    if (foreignClient) {
      sendJson(response, 403, apiError(requestId, "forbidden", foreignClient));
      return;
    }
    let url;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendJson(response, 400, apiError(requestId, "bad-request", "Ungueltiger Anfragepfad."));
      return;
    }
    if (url.search) {
      sendJson(response, 400, apiError(requestId, "bad-request", "Query-Parameter sind fuer die lokale SSE-API nicht erlaubt."));
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      const prewarm = options.prewarmStatus?.() ?? null;
      sendJson(response, 200, {
        ok: true,
        apiVersion: SSE_API_VERSION,
        packageName: SSE_API_PACKAGE_NAME,
        packageVersion: SSE_PACKAGE_VERSION,
        processId: process.pid,
        instanceId,
        configurationFingerprint: options.configurationFingerprint ?? "0".repeat(64),
        inFlight: inFlightSnapshot(),
        prewarm
      });
      return;
    }
    if (request.method === "GET" && url.pathname === `/${SSE_API_VERSION}/operations`) {
      sendJsonBytes(response, 200, SSE_API_DISCOVERY_BYTES);
      return;
    }
    if (request.method === "GET" && url.pathname === `/${SSE_API_VERSION}/openapi.json`) {
      sendJsonBytes(response, 200, SSE_OPENAPI_BYTES);
      return;
    }
    const match = new RegExp(`^/${SSE_API_VERSION}/operations/([a-z_]+)$`).exec(url.pathname);
    if (!match) {
      sendJson(response, 404, apiError(requestId, "not-found", "API-Endpunkt nicht gefunden."));
      return;
    }
    const operationName = match[1];
    if (!isSseApiOperation(operationName)) {
      sendJson(response, 404, apiError(requestId, "operation-not-allowed", "Operation ist nicht freigegeben."));
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, apiOperationDiscovery(operationName));
      return;
    }
    if (request.method !== "POST") {
      sendJson(
        response,
        405,
        apiError(requestId, "method-not-allowed", "Fuer diese Route sind nur GET und POST erlaubt."),
        { allow: "GET, POST" }
      );
      return;
    }
    const expectedInstance = request.headers[SSE_API_INSTANCE_HEADER];
    if (expectedInstance !== void 0 && (typeof expectedInstance !== "string" || expectedInstance !== instanceId)) {
      sendJson(
        response,
        409,
        apiError(requestId, "api-instance-mismatch", "SSE-API-Instanz stimmt nicht mit der Health-Bindung ueberein.")
      );
      return;
    }
    if (!hasJsonContentType(request)) {
      sendJson(
        response,
        415,
        apiError(requestId, "unsupported-media-type", "POST-Anfragen muessen Content-Type application/json verwenden.")
      );
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortOnClosedResponse = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once("aborted", abort);
    response.once("close", abortOnClosedResponse);
    try {
      let decoded;
      try {
        decoded = await readJson(request);
      } catch (error) {
        if (error instanceof SyntaxError) throw new ApiRequestError("Anfragekoerper ist kein gueltiges JSON.");
        throw error;
      }
      const body = parseOperationRequest(decoded);
      let args;
      try {
        args = parseApiOperationArgs(operationName, body.args ?? {});
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ApiRequestError(formatOperationArgumentError(error, operationName), 400, "bad-args");
        }
        throw error;
      }
      const running = inFlightSnapshot();
      if (running) {
        sendJson(response, 409, {
          ...apiError(
            requestId,
            "busy",
            `Es laeuft bereits die Operation '${running.operation}' seit ${running.elapsedMs} ms. Es wird immer nur eine Operation gleichzeitig ausgefuehrt. Warte auf ihr Ergebnis, statt parallel erneut aufzurufen; /healthz meldet den Fortschritt jederzeit.`
          ),
          inFlight: running
        });
        return;
      }
      inFlight = { operation: operationName, requestId, startedAt: Date.now() };
      let rawResult;
      try {
        rawResult = await execute(operationName, args, body.timeoutMs, controller.signal);
      } finally {
        inFlight = null;
      }
      let result;
      try {
        result = parseApiOperationResult(operationName, rawResult);
      } catch (error) {
        if (error instanceof ZodError) {
          const issueSummary = error.issues.slice(0, 4).map((issue) => {
            const path = issue.path.length ? issue.path.map(String).join(".") : "$";
            const received = "received" in issue ? `/${String(issue.received)}` : "";
            return `${path}:${issue.code}${received}`;
          }).join(", ");
          throw new ApiRequestError(
            `SSE-Arbeitsprozess lieferte kein gueltiges Result_${operationName}-Ergebnis${issueSummary ? ` (${issueSummary})` : ""}.`,
            502,
            "invalid-operation-result"
          );
        }
        throw error;
      }
      const envelope = {
        apiVersion: SSE_API_VERSION,
        requestId,
        operation: operationName,
        durationMs: Date.now() - started,
        result
      };
      const operationLog = {
        event: "operation",
        requestId,
        operation: operationName,
        durationMs: envelope.durationMs,
        ok: result.ok,
        ...result.kind ? { kind: result.kind } : {}
      };
      const sendOutcome = sendJson(response, 200, envelope);
      safeLog({ ...operationLog, delivered: sendOutcome === "sent" });
      if (sendOutcome === "unavailable") return;
      if (sendOutcome === "too-large") {
        safeLog({
          event: "operation-error",
          requestId,
          operation: operationName,
          durationMs: envelope.durationMs,
          code: "response-too-large"
        });
        sendJson(
          response,
          502,
          apiError(
            requestId,
            "response-too-large",
            `SSE-API-Ergebnis ist groesser als ${MAX_API_RESPONSE_BYTES} Bytes und wurde nicht uebertragen.`
          )
        );
        return;
      }
    } catch (error) {
      const requestError = error instanceof ApiRequestError ? error : void 0;
      const status = requestError?.status ?? 502;
      const code = requestError?.code ?? "worker-failed";
      safeLog({
        event: "operation-error",
        requestId,
        operation: operationName,
        durationMs: Date.now() - started,
        code,
        errorName: error instanceof Error ? error.name : "Error"
      });
      sendJson(
        response,
        status,
        apiError(requestId, code, requestError?.message ?? "SSE-Arbeitsprozess ist fehlgeschlagen.")
      );
    } finally {
      request.off("aborted", abort);
      response.off("close", abortOnClosedResponse);
    }
  });
  server.headersTimeout = 1e4;
  server.requestTimeout = 3e4;
  server.keepAliveTimeout = 5e3;
  server.maxHeadersCount = 64;
  return server;
}
async function listenSseApiServer(server, host, port) {
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("SSE-API darf nur an einen Loopback-Host gebunden werden.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSE-API-Port muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }
  await new Promise((resolve16, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve16();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
var SSE_API_DISCOVERY_BYTES, SSE_OPENAPI_BYTES, ApiRequestError;
var init_api_server = __esm({
  "src/api-server.ts"() {
    "use strict";
    init_zod();
    init_api_contract();
    init_api_discovery();
    init_api_openapi();
    init_operation_catalog();
    init_result_contract();
    init_version();
    init_api_supervisor_contract();
    SSE_API_DISCOVERY_BYTES = serializeStaticApiDocument("API-Discovery", SSE_API_DISCOVERY);
    SSE_OPENAPI_BYTES = serializeStaticApiDocument("OpenAPI-Dokument", SSE_OPENAPI_DOCUMENT);
    ApiRequestError = class extends Error {
      constructor(message, status = 400, code = "bad-request") {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ApiRequestError";
      }
      status;
      code;
    };
  }
});

// src/windows-runtime.ts
import { existsSync as existsSync10 } from "node:fs";
import { basename as basename6, join as join10, resolve as resolve15 } from "node:path";
function resolveWindowsPowerShell(env = process.env) {
  if (process.platform !== "win32") {
    throw new Error("SteuerSparErklaerung-Automation wird nur unter Windows unterstuetzt.");
  }
  const configured = env.SSE_POWERSHELL_EXE?.trim();
  const systemRoot = env.SystemRoot?.trim() || env.WINDIR?.trim();
  const candidates = [
    configured,
    systemRoot ? join10(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : void 0
  ].filter((entry) => Boolean(entry));
  for (const candidate of candidates) {
    const absolute = resolve15(candidate);
    if (basename6(absolute).toLowerCase() === "powershell.exe" && existsSync10(absolute)) return absolute;
  }
  throw new Error(
    "Windows PowerShell (powershell.exe) wurde im Windows-Systemordner nicht gefunden. Es wird keine globale PowerShell-7-Installation benoetigt."
  );
}
var init_windows_runtime = __esm({
  "src/windows-runtime.ts"() {
    "use strict";
  }
});

// src/desktop-marker.ts
import { join as join11 } from "node:path";
function desktopMarkerPath(env = process.env) {
  return join11(env.TEMP ?? env.TMP ?? ".", "sse-mcp-desktop.txt");
}
function invalidMarker() {
  throw new DesktopMarkerError(
    "Desktop-Marker ist ungueltig; sichtbarer Desktop wird nicht ersatzweise verwendet.",
    "desktop-marker-invalid"
  );
}
function hasExactProperties(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.slice().sort().every((name, index) => name === actual[index]);
}
function validName(value) {
  return typeof value === "string" && VALID_DESKTOP_NAME.test(value);
}
function validPid(value) {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 4294967295;
}
function parseDesktopMarker(text) {
  const raw = text.trim();
  if (!raw) return invalidMarker();
  if (!raw.startsWith("{")) {
    if (!validName(raw)) return invalidMarker();
    return { schemaVersion: 0, owner: "sse", name: raw, pid: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidMarker();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidMarker();
  const marker = parsed;
  if (hasExactProperties(marker, ["name", "pid"])) {
    if (!validName(marker.name) || !validPid(marker.pid)) return invalidMarker();
    return { schemaVersion: 0, owner: "sse", name: marker.name, pid: marker.pid };
  }
  if (!hasExactProperties(marker, ["name", "owner", "pid", "schemaVersion"]) || marker.schemaVersion !== 1) {
    return invalidMarker();
  }
  if (marker.owner !== "sse" && marker.owner !== "center-test" || !validName(marker.name) || !validPid(marker.pid)) {
    return invalidMarker();
  }
  return {
    schemaVersion: 1,
    owner: marker.owner,
    name: marker.name,
    pid: marker.pid
  };
}
function resolveDesktopMarkerForOperation(markerPath, operation, allowCenterTest) {
  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(readFileBounded(markerPath, MAX_DESKTOP_MARKER_BYTES));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof DesktopMarkerError) throw error;
    return invalidMarker();
  }
  const marker = parseDesktopMarker(raw);
  if (marker.owner === "sse" && CENTER_TEST_OPERATION_SET.has(operation)) {
    throw new DesktopMarkerError(
      "SSE-Desktop-Marker besitzt keinen Steuertipps-Center; Center-Operation wurde nicht dorthin geroutet.",
      "desktop-marker-owner"
    );
  }
  if (marker.owner === "center-test" && (!allowCenterTest || !CENTER_TEST_OPERATION_SET.has(operation))) {
    throw new DesktopMarkerError(
      "Desktop-Marker gehoert dem isolierten Center-Test; Operation wurde nicht dorthin geroutet.",
      "desktop-marker-owner"
    );
  }
  return marker;
}
var MAX_DESKTOP_MARKER_BYTES, DESKTOP_MARKER_PATH, VALID_DESKTOP_NAME, CENTER_TEST_OPERATIONS, CENTER_TEST_OPERATION_SET, DesktopMarkerError;
var init_desktop_marker = __esm({
  "src/desktop-marker.ts"() {
    "use strict";
    init_bounded_files();
    MAX_DESKTOP_MARKER_BYTES = 4 * 1024;
    DESKTOP_MARKER_PATH = desktopMarkerPath();
    VALID_DESKTOP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
    CENTER_TEST_OPERATIONS = Object.freeze(["center_cases", "center_refresh"]);
    CENTER_TEST_OPERATION_SET = new Set(CENTER_TEST_OPERATIONS);
    DesktopMarkerError = class extends Error {
      constructor(message, kind) {
        super(message);
        this.kind = kind;
        this.name = "DesktopMarkerError";
      }
      kind;
    };
  }
});

// src/worker-prewarm.ts
import { spawn } from "node:child_process";
import { constants as osConstants, setPriority } from "node:os";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { dirname as dirname11, join as join12 } from "node:path";
function setSparePriority(child, priority) {
  if (child.pid === void 0) return;
  try {
    setPriority(child.pid, priority);
  } catch {
  }
}
function positiveDurationFromEnvironment(name, fallback) {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}
function boundedPoolSizeFromEnvironment() {
  const configured = Number(process.env.SSE_WORKER_PREWARM_POOL_SIZE);
  if (!Number.isInteger(configured)) return 2;
  return Math.max(1, Math.min(4, configured));
}
function lastPrewarmFailure() {
  return failureReason;
}
function isWarmSpareReady() {
  return spares.some((candidate) => candidate.ready && !candidate.discarded);
}
function environmentFingerprint() {
  return Object.keys(process.env).filter((name) => name.startsWith("SSE_")).sort().map((name) => `${name}=${process.env[name] ?? ""}`).join("\0");
}
function discard(candidate, reason) {
  if (candidate.discarded) return;
  candidate.discarded = true;
  candidate.release();
  if (candidate.startupPending) {
    candidate.startupPending = false;
    starting--;
  }
  const index = spares.indexOf(candidate);
  if (index >= 0) spares.splice(index, 1);
  failureReason = reason;
  try {
    candidate.child.stdin.end();
  } catch {
  }
  try {
    candidate.child.kill();
  } catch {
  }
}
function startWarmSpare() {
  let child;
  try {
    child = spawn(
      resolveWindowsPowerShell(),
      ["-ExecutionPolicy", "Bypass", "-NoLogo", "-NoProfile", "-NonInteractive", "-File", WORKER_SCRIPT, "-Prewarm"],
      { windowsHide: true }
    );
  } catch (error) {
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    failureReason = `Reservearbeiter liess sich nicht starten: ${String(error)}`;
    return false;
  }
  setSparePriority(child, osConstants.priority.PRIORITY_BELOW_NORMAL);
  const candidate = {
    child,
    environmentFingerprint: environmentFingerprint(),
    residualStdout: [],
    ready: false,
    discarded: false,
    startupPending: true,
    release: () => void 0
  };
  starting++;
  let handshake = "";
  let handshakeDone = false;
  let stderrText = "";
  let startupTimer = null;
  const clearStartupTimer = () => {
    if (startupTimer === null) return;
    clearTimeout(startupTimer);
    startupTimer = null;
  };
  const onStdout = (chunk) => {
    if (handshakeDone) {
      candidate.residualStdout.push(chunk);
      return;
    }
    handshake += chunk.toString("utf8");
    const newline = handshake.indexOf("\n");
    if (newline < 0) {
      if (handshake.length > MAX_HANDSHAKE_BYTES) {
        handshakeDone = true;
        blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
        discard(candidate, "Reservearbeiter meldete keine gueltige Bereitschaftszeile.");
      }
      return;
    }
    const line = handshake.slice(0, newline).trim();
    const rest = handshake.slice(newline + 1);
    handshakeDone = true;
    clearStartupTimer();
    if (rest) candidate.residualStdout.push(Buffer.from(rest, "utf8"));
    if (candidate.startupPending) {
      candidate.startupPending = false;
      starting--;
    }
    let announcement;
    try {
      announcement = JSON.parse(line);
    } catch {
      announcement = null;
    }
    const ready = Boolean(announcement) && typeof announcement === "object" && announcement.prewarm === "ready";
    if (!ready) {
      blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
      discard(candidate, `Reservearbeiter meldete statt Bereitschaft: ${line.slice(0, 400)}`);
      return;
    }
    candidate.ready = true;
    failureReason = null;
  };
  const onStderr = (chunk) => {
    if (stderrText.length < MAX_HANDSHAKE_BYTES) stderrText += chunk.toString("utf8");
  };
  const onExit = () => {
    clearStartupTimer();
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    const diagnostic = stderrText.trim().slice(0, 400);
    discard(
      candidate,
      `Reservearbeiter endete vor seinem Auftrag.${diagnostic ? ` stderr: ${diagnostic}` : ""}`
    );
  };
  const onError = (error) => {
    clearStartupTimer();
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    discard(candidate, `Reservearbeiter meldete einen Prozessfehler: ${error.message}`);
  };
  candidate.release = () => {
    clearStartupTimer();
    child.stdout.off("data", onStdout);
    child.stderr.off("data", onStderr);
    child.off("close", onExit);
    child.off("error", onError);
  };
  startupTimer = setTimeout(() => {
    if (handshakeDone || candidate.discarded) return;
    handshakeDone = true;
    blockedUntil = Date.now() + PREWARM_RETRY_DELAY_MS;
    const diagnostic = stderrText.trim().slice(0, 400);
    discard(
      candidate,
      `Reservearbeiter meldete sich nicht innerhalb von ${PREWARM_STARTUP_TIMEOUT_MS} ms bereit.` + (diagnostic ? ` stderr: ${diagnostic}` : "")
    );
  }, PREWARM_STARTUP_TIMEOUT_MS);
  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.once("close", onExit);
  child.once("error", onError);
  child.unref();
  spares.push(candidate);
  return true;
}
function ensureWarmSpare() {
  if (!enabled || PREWARM_DISABLED || shuttingDown) return;
  if (Date.now() < blockedUntil) return;
  while (spares.length < PREWARM_POOL_SIZE) {
    if (!startWarmSpare()) break;
  }
}
function takeWarmSpare() {
  let candidate;
  for (const pooled of [...spares]) {
    if (!pooled.ready || pooled.discarded) continue;
    if (pooled.environmentFingerprint !== environmentFingerprint()) {
      discard(pooled, "Reservearbeiter wurde mit einer anderen SSE-Umgebung vorgewaermt.");
      continue;
    }
    candidate = pooled;
    break;
  }
  if (!candidate) return null;
  const index = spares.indexOf(candidate);
  if (index >= 0) spares.splice(index, 1);
  candidate.release();
  candidate.child.ref();
  setSparePriority(candidate.child, osConstants.priority.PRIORITY_NORMAL);
  return { child: candidate.child, residualStdout: candidate.residualStdout };
}
function enableWorkerPrewarm() {
  enabled = true;
  shuttingDown = false;
  ensureWarmSpare();
}
function shutdownWarmSpare() {
  shuttingDown = true;
  enabled = false;
  for (const candidate of [...spares]) discard(candidate, "API wurde beendet.");
}
var HERE, WORKER_SCRIPT, MAX_HANDSHAKE_BYTES, PREWARM_STARTUP_TIMEOUT_MS, PREWARM_RETRY_DELAY_MS, PREWARM_POOL_SIZE, PREWARM_DISABLED, enabled, spares, starting, blockedUntil, shuttingDown, failureReason;
var init_worker_prewarm = __esm({
  "src/worker-prewarm.ts"() {
    "use strict";
    init_windows_runtime();
    HERE = dirname11(fileURLToPath2(import.meta.url));
    WORKER_SCRIPT = join12(HERE, "..", "powershell", "sse-worker.ps1");
    MAX_HANDSHAKE_BYTES = 4096;
    PREWARM_STARTUP_TIMEOUT_MS = positiveDurationFromEnvironment(
      "SSE_WORKER_PREWARM_STARTUP_TIMEOUT_MS",
      15e3
    );
    PREWARM_RETRY_DELAY_MS = positiveDurationFromEnvironment(
      "SSE_WORKER_PREWARM_RETRY_DELAY_MS",
      3e4
    );
    PREWARM_POOL_SIZE = boundedPoolSizeFromEnvironment();
    PREWARM_DISABLED = process.env.SSE_WORKER_PREWARM === "0";
    enabled = false;
    spares = [];
    starting = 0;
    blockedUntil = 0;
    shuttingDown = false;
    failureReason = null;
  }
});

// src/worker.ts
import { spawn as spawn2 } from "node:child_process";
import { createHash as createHash12, randomUUID as randomUUID4 } from "node:crypto";
import { closeSync as closeSync3, openSync as openSync3, unlinkSync as unlinkSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { dirname as dirname12, join as join13 } from "node:path";
function createWorkerArgumentsFile(args) {
  let bytes;
  try {
    bytes = Buffer.from(JSON.stringify(args), "utf8");
  } catch (error) {
    throw new WorkerError(`Worker-Argumente liessen sich nicht serialisieren: ${String(error)}`, "bad-args");
  }
  if (bytes.length > MAX_WORKER_ARGUMENT_BYTES) {
    throw new WorkerError(
      `Worker-Argumente sind groesser als ${MAX_WORKER_ARGUMENT_BYTES} Bytes.`,
      "payload-too-large"
    );
  }
  const path = join13(tmpdir(), `sse-args-${randomUUID4().replaceAll("-", "")}.json`);
  const descriptor = openSync3(path, "wx", 384);
  let failure;
  try {
    writeFileSync3(descriptor, bytes);
  } catch (error) {
    failure = error;
  } finally {
    try {
      closeSync3(descriptor);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== void 0) {
    const cleanupError = removeWorkerArgumentsFile(path);
    const detail = cleanupError ? ` ${cleanupError.message}` : "";
    throw new WorkerError(`Interne Worker-Argumentdatei liess sich nicht schreiben.${detail}`, "worker-transport");
  }
  return path;
}
function removeWorkerArgumentsFile(path) {
  try {
    unlinkSync3(path);
    return null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return new WorkerError(
      "Interne Worker-Argumentdatei konnte nicht entfernt werden; lokalen Temp-Ordner kontrollieren.",
      "worker-transport-cleanup"
    );
  }
}
function summarizeWorkerDiagnostic(value) {
  if (value.length <= MAX_WORKER_DIAGNOSTIC_CHARACTERS) return value;
  const bytes = Buffer.from(value, "utf8");
  const digest = createHash12("sha256").update(bytes).digest("hex");
  return `${value.slice(0, MAX_WORKER_DIAGNOSTIC_CHARACTERS)}
[Diagnose gekuerzt: ${bytes.length} UTF-8-Bytes, sha256=${digest}]`;
}
function parseWorkerResult(text, operation) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WorkerError(
      `Antwort von '${operation}' war kein JSON. Anfang: ${text.slice(0, 400)}`,
      "parse"
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.ok !== "boolean") {
    throw new WorkerError(
      `Antwort von '${operation}' war kein Ergebnisobjekt mit booleschem ok-Status.`,
      "parse"
    );
  }
  return parsed;
}
function startNextWorkerCall() {
  if (workerRunning) return;
  const next = workerQueue.shift();
  if (!next) return;
  if (next.signal && next.abortWhileQueued) {
    next.signal.removeEventListener("abort", next.abortWhileQueued);
  }
  workerRunning = true;
  void runQueuedWorkerCall(next);
}
async function runQueuedWorkerCall(call) {
  try {
    if (workerRuntimeFailure) {
      throw new WorkerError(workerRuntimeFailure.message, workerRuntimeFailure.kind);
    }
    const result = await callWorkerUnsynchronised(
      call.op,
      call.args,
      call.timeoutMs,
      call.signal
    );
    call.resolve(result);
  } catch (error) {
    call.reject(error);
  } finally {
    workerRunning = false;
    startNextWorkerCall();
    if (!workerRuntimeFailure) ensureWarmSpare();
  }
}
function callWorker(op, args = {}, timeoutMs = DEFAULT_TIMEOUT_MS, signal) {
  if (workerRuntimeFailure) {
    return Promise.reject(new WorkerError(workerRuntimeFailure.message, workerRuntimeFailure.kind));
  }
  if (signal?.aborted) {
    return Promise.reject(
      new WorkerError("API-Client hat den Aufruf vor dem Einreihen abgebrochen; kein Worker wurde gestartet.", "aborted")
    );
  }
  const queueDepth = workerQueue.length + (workerRunning ? 1 : 0);
  if (queueDepth >= MAX_WORKER_QUEUE_DEPTH) {
    return Promise.reject(
      new WorkerError(
        `SSE-Arbeitsqueue ist mit ${MAX_WORKER_QUEUE_DEPTH} Auftraegen ausgelastet; Zustand spaeter lesen statt blind wiederholen.`,
        "busy"
      )
    );
  }
  return new Promise((resolve16, reject) => {
    const queued = { op, args, timeoutMs, resolve: resolve16, reject };
    if (signal) queued.signal = signal;
    const abortWhileQueued = () => {
      const index = workerQueue.indexOf(queued);
      if (index < 0) return;
      workerQueue.splice(index, 1);
      signal?.removeEventListener("abort", abortWhileQueued);
      reject(new WorkerError("API-Client hat den wartenden Auftrag abgebrochen; kein Worker wurde gestartet.", "aborted"));
    };
    if (signal) {
      queued.abortWhileQueued = abortWhileQueued;
      signal.addEventListener("abort", abortWhileQueued, { once: true });
    }
    workerQueue.push(queued);
    if (signal?.aborted) {
      abortWhileQueued();
      return;
    }
    startNextWorkerCall();
  });
}
async function callWorkerUnsynchronised(op, args = {}, timeoutMs = DEFAULT_TIMEOUT_MS, signal) {
  const marker = op === "desktop_start" || op === "desktop_status" ? null : resolveDesktopMarkerForOperation(
    DESKTOP_MARKER_PATH,
    op,
    process.env.SSE_CENTER_LIVE_TEST === "1"
  );
  const desk = marker?.name ?? null;
  const markerAllowsWarmSpare = marker?.owner === "sse" && !workerOperationNeedsMarkedDesktop(op);
  const argsFile = createWorkerArgumentsFile(args);
  const argv = desk ? [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    DESKTOP_LAUNCHER,
    "-Op",
    op,
    "-ArgsFile",
    argsFile,
    "-Desktop",
    desk,
    "-TimeoutSec",
    String(Math.max(30, Math.floor(timeoutMs / 1e3) - 5))
  ] : ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", WORKER, "-Op", op, "-ArgsFile", argsFile];
  const spare = !desk || markerAllowsWarmSpare ? takeWarmSpare() : null;
  if (!workerRuntimeFailure) ensureWarmSpare();
  return new Promise((resolve16, reject) => {
    let child;
    if (spare) {
      child = spare.child;
      try {
        child.stdin.end(`${JSON.stringify({ op, argsFile })}
`, "utf8");
      } catch (error) {
        const handoverError = new WorkerError(
          `Auftrag liess sich nicht an den Reservearbeiter uebergeben: ${String(error)}`,
          "spawn"
        );
        try {
          child.kill();
        } catch {
        }
        const cleanupError = removeWorkerArgumentsFile(argsFile);
        reject(cleanupError ? new WorkerError(`${handoverError.message} ${cleanupError.message}`, handoverError.kind) : handoverError);
        return;
      }
    } else {
      try {
        child = spawn2(
          resolveWindowsPowerShell(),
          ["-ExecutionPolicy", "Bypass", ...argv],
          { windowsHide: true }
        );
      } catch (error) {
        const spawnError = new WorkerError(`PowerShell liess sich nicht starten: ${String(error)}`, "spawn");
        const cleanupError = removeWorkerArgumentsFile(argsFile);
        reject(cleanupError ? new WorkerError(`${spawnError.message} ${cleanupError.message}`, spawnError.kind) : spawnError);
        return;
      }
    }
    const outChunks = spare ? [...spare.residualStdout] : [];
    const errChunks = [];
    let outBytes = outChunks.reduce((total, chunk) => total + chunk.length, 0);
    let errBytes = 0;
    let settled = false;
    let timeoutError = null;
    let argumentCleanupError = null;
    let graceTimer;
    let hardTimer;
    const cleanup = () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      signal?.removeEventListener("abort", onAbort);
      argumentCleanupError ??= removeWorkerArgumentsFile(argsFile);
    };
    const withCleanupResult = (error) => argumentCleanupError ? new WorkerError(`${error.message} ${argumentCleanupError.message}`, error.kind) : error;
    const rejectTermination = () => {
      if (settled || !timeoutError) return;
      workerRuntimeFailure ??= new WorkerError(
        "SSE-Workerprozessbaum konnte nicht nachweislich beendet werden. API neu starten und vor weiteren Aenderungen laufende SSE-/PowerShell-Prozesse sowie den sichtbaren Fallzustand kontrollieren.",
        "worker-isolation-lost"
      );
      settled = true;
      cleanup();
      const terminationError = workerRuntimeFailure ? new WorkerError(`${timeoutError.message} ${workerRuntimeFailure.message}`, timeoutError.kind) : timeoutError;
      reject(withCleanupResult(terminationError));
    };
    const killTree = () => {
      if (settled) return;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn2(TASKKILL, ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
        killer.once("error", () => void 0);
        killer.once("close", () => {
          if (!settled && !hardTimer) hardTimer = setTimeout(rejectTermination, 2e3);
        });
      }
      if (!hardTimer) hardTimer = setTimeout(rejectTermination, 5e3);
    };
    const beginTermination = (error) => {
      if (settled || timeoutError) return;
      timeoutError = error;
      child.kill();
      graceTimer = setTimeout(killTree, 5e3);
    };
    const onAbort = () => {
      beginTermination(
        new WorkerError(
          `API-Client hat '${op}' abgebrochen. Der Zustand ist unbekannt; vor jeder Wiederholung zuerst gezielt lesen.`,
          "aborted"
        )
      );
    };
    const timer = setTimeout(() => {
      beginTermination(
        new WorkerError(
          `Zeitueberschreitung nach ${timeoutMs} ms bei '${op}'. Der Zustand ist unbekannt; vor jeder Wiederholung zuerst gezielt lesen und danach sse_health pruefen.`,
          "timeout"
        )
      );
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const collect = (chunk, chunks, currentBytes, limit, streamName) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextBytes = currentBytes + buffer.length;
      if (nextBytes > limit) {
        beginTermination(
          new WorkerError(
            `Arbeitsprozess '${op}' ueberschritt das ${streamName}-Limit von ${limit} Bytes.`,
            "output-too-large"
          )
        );
        return nextBytes;
      }
      chunks.push(buffer);
      return nextBytes;
    };
    child.stdout.on("data", (chunk) => {
      outBytes = collect(chunk, outChunks, outBytes, MAX_WORKER_STDOUT_BYTES, "Ausgabe");
    });
    child.stderr.on("data", (chunk) => {
      errBytes = collect(chunk, errChunks, errBytes, MAX_WORKER_STDERR_BYTES, "Fehlerausgabe");
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(withCleanupResult(new WorkerError(`PowerShell liess sich nicht starten: ${e.message}`, "spawn")));
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timeoutError) {
        reject(withCleanupResult(timeoutError));
        return;
      }
      if (argumentCleanupError) {
        reject(argumentCleanupError);
        return;
      }
      let text;
      let err;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        text = decoder.decode(Buffer.concat(outChunks, outBytes)).trim();
        err = decoder.decode(Buffer.concat(errChunks, errBytes)).trim();
      } catch {
        reject(new WorkerError(`Antwort von '${op}' war kein gueltiges UTF-8.`, "parse"));
        return;
      }
      if (!text) {
        const stderr = summarizeWorkerDiagnostic(err);
        reject(
          new WorkerError(
            `Arbeitsprozess '${op}' lieferte keine Ausgabe.` + (stderr ? ` stderr: ${stderr}` : ""),
            "empty"
          )
        );
        return;
      }
      try {
        resolve16(parseWorkerResult(text, op));
      } catch (error) {
        const stderr = summarizeWorkerDiagnostic(err);
        const message = error instanceof Error ? error.message : String(error);
        reject(
          new WorkerError(
            message + (stderr ? ` | stderr: ${stderr}` : ""),
            "parse"
          )
        );
      }
    });
  });
}
var HERE2, WORKER, DESKTOP_LAUNCHER, TASKKILL, DEFAULT_TIMEOUT_MS, MAX_WORKER_STDOUT_BYTES, MAX_WORKER_STDERR_BYTES, MAX_WORKER_DIAGNOSTIC_CHARACTERS, MAX_WORKER_ARGUMENT_BYTES, WorkerError, workerRuntimeFailure, workerQueue, workerRunning;
var init_worker = __esm({
  "src/worker.ts"() {
    "use strict";
    init_windows_runtime();
    init_api_contract();
    init_desktop_marker();
    init_worker_prewarm();
    init_worker_operation_policy();
    HERE2 = dirname12(fileURLToPath3(import.meta.url));
    WORKER = join13(HERE2, "..", "powershell", "sse-worker.ps1");
    DESKTOP_LAUNCHER = join13(HERE2, "..", "powershell", "run-on-desktop.ps1");
    TASKKILL = join13(
      process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
      "System32",
      "taskkill.exe"
    );
    DEFAULT_TIMEOUT_MS = 9e4;
    MAX_WORKER_STDOUT_BYTES = 32 * 1024 * 1024;
    MAX_WORKER_STDERR_BYTES = 1024 * 1024;
    MAX_WORKER_DIAGNOSTIC_CHARACTERS = 4096;
    MAX_WORKER_ARGUMENT_BYTES = MAX_API_BODY_BYTES;
    WorkerError = class extends Error {
      constructor(message, kind = "worker") {
        super(message);
        this.kind = kind;
        this.name = "WorkerError";
      }
      kind;
    };
    workerRuntimeFailure = null;
    workerQueue = [];
    workerRunning = false;
  }
});

// src/abort.ts
async function withCombinedAbortSignal(signals, action) {
  const controller = new AbortController();
  const active = [...new Set(signals.filter((signal) => Boolean(signal)))];
  const listeners = /* @__PURE__ */ new Map();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const abort = () => controller.abort(signal.reason);
    listeners.set(signal, abort);
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    return await action(controller.signal);
  } finally {
    for (const [signal, abort] of listeners) signal.removeEventListener("abort", abort);
  }
}
var init_abort = __esm({
  "src/abort.ts"() {
    "use strict";
  }
});

// src/jsonl-logger.ts
import {
  appendFileSync,
  existsSync as existsSync11,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync4,
  renameSync as renameSync2,
  statSync as statSync5,
  unlinkSync as unlinkSync4
} from "node:fs";
import { dirname as dirname13 } from "node:path";
function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} muss eine positive Ganzzahl sein.`);
  }
}
function assertRegularFile(path) {
  if (!existsSync11(path)) return;
  const info = lstatSync2(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Logpfad ist keine regulaere Datei: ${path}`);
  }
}
function createRotatingJsonlLogger(options) {
  requirePositiveInteger(options.maxBytes, "maxBytes");
  const maxLineBytes = options.maxLineBytes ?? Math.min(DEFAULT_MAX_LINE_BYTES, options.maxBytes);
  requirePositiveInteger(maxLineBytes, "maxLineBytes");
  if (maxLineBytes > options.maxBytes) {
    throw new Error("maxLineBytes darf maxBytes nicht ueberschreiten.");
  }
  const previousPath = `${options.logPath}.1`;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const writeDiagnostic = options.writeDiagnostic ?? ((line) => process.stderr.write(line));
  let fileLoggingAvailable = true;
  let logBytes = 0;
  let fileFailureReported = false;
  const timestamp = () => {
    try {
      return now().toISOString();
    } catch {
      return "1970-01-01T00:00:00.000Z";
    }
  };
  const diagnosticLine = (record) => `${JSON.stringify({ at: timestamp(), ...record })}
`;
  const safeDiagnostic = (line) => {
    try {
      writeDiagnostic(line);
    } catch {
    }
  };
  const reportFileFailure = (error) => {
    fileLoggingAvailable = false;
    if (fileFailureReported) return;
    fileFailureReported = true;
    safeDiagnostic(diagnosticLine({
      event: "file-log-disabled",
      errorName: error instanceof Error ? error.name : "Error"
    }));
  };
  const rotate = () => {
    assertRegularFile(options.logPath);
    assertRegularFile(previousPath);
    if (existsSync11(previousPath)) unlinkSync4(previousPath);
    if (existsSync11(options.logPath)) renameSync2(options.logPath, previousPath);
    logBytes = 0;
  };
  try {
    mkdirSync4(dirname13(options.logPath), { recursive: true });
    assertRegularFile(previousPath);
    if (existsSync11(previousPath) && statSync5(previousPath).size > options.maxBytes) {
      unlinkSync4(previousPath);
    }
    assertRegularFile(options.logPath);
    logBytes = existsSync11(options.logPath) ? statSync5(options.logPath).size : 0;
    if (logBytes > options.maxBytes) {
      const oversizedBytes = logBytes;
      unlinkSync4(options.logPath);
      logBytes = 0;
      safeDiagnostic(diagnosticLine({ event: "file-log-reset", reason: "oversized", originalBytes: oversizedBytes }));
    }
  } catch (error) {
    reportFileFailure(error);
  }
  const log = (record) => {
    let line;
    try {
      line = diagnosticLine(record);
    } catch (error) {
      line = diagnosticLine({
        event: "log-serialization-failed",
        errorName: error instanceof Error ? error.name : "Error"
      });
    }
    let lineBytes = Buffer.byteLength(line);
    if (lineBytes > maxLineBytes) {
      line = diagnosticLine({ event: "log-record-too-large", originalBytes: lineBytes });
      lineBytes = Buffer.byteLength(line);
    }
    if (fileLoggingAvailable) {
      try {
        if (logBytes + lineBytes > options.maxBytes) rotate();
        appendFileSync(options.logPath, line, "utf8");
        logBytes += lineBytes;
      } catch (error) {
        reportFileFailure(error);
      }
    }
    safeDiagnostic(line);
  };
  return {
    log,
    isFileLoggingAvailable: () => fileLoggingAvailable
  };
}
var DEFAULT_MAX_LINE_BYTES;
var init_jsonl_logger = __esm({
  "src/jsonl-logger.ts"() {
    "use strict";
    DEFAULT_MAX_LINE_BYTES = 64 * 1024;
  }
});

// src/api-runtime.ts
var api_runtime_exports = {};
__export(api_runtime_exports, {
  MAX_SCREENSHOT_IMAGE_BYTES: () => MAX_SCREENSHOT_IMAGE_BYTES,
  attachScreenshotImage: () => attachScreenshotImage,
  installApiShutdown: () => installApiShutdown,
  runApiRuntime: () => runApiRuntime
});
import { setMaxListeners } from "node:events";
import { realpathSync as realpathSync4 } from "node:fs";
import { dirname as dirname14, isAbsolute as isAbsolute7, join as join14, relative as relative5 } from "node:path";
function installApiShutdown(server, shutdown, log, options = {}) {
  const forceAfterMs = options.forceAfterMs ?? 1e4;
  if (!Number.isFinite(forceAfterMs) || forceAfterMs < 1) {
    throw new Error("forceAfterMs muss eine positive Zahl sein.");
  }
  setMaxListeners(0, shutdown.signal);
  const safeLog = (record) => {
    try {
      log(record);
    } catch {
    }
  };
  let closing = false;
  let completed = false;
  let forceTimer;
  let resolveClosed;
  const closed = new Promise((resolvePromise) => {
    resolveClosed = resolvePromise;
  });
  const disposeSignals = () => {
    process.off("SIGINT", requestShutdown);
    process.off("SIGTERM", requestShutdown);
  };
  const finish = (error) => {
    if (completed) return;
    completed = true;
    if (forceTimer) clearTimeout(forceTimer);
    disposeSignals();
    safeLog({
      event: "shutdown-complete",
      ...error ? { errorName: error.name, message: error.message } : {}
    });
    resolveClosed();
  };
  const requestShutdown = () => {
    if (closing) return;
    closing = true;
    process.exitCode = 0;
    disposeSignals();
    safeLog({ event: "shutdown-requested" });
    shutdown.abort(new Error("SSE-API wird kontrolliert beendet."));
    server.close((error) => finish(error));
    server.closeIdleConnections();
    forceTimer = setTimeout(() => {
      if (completed) return;
      safeLog({ event: "shutdown-forced", afterMs: forceAfterMs });
      server.closeAllConnections();
    }, forceAfterMs);
    forceTimer.unref();
  };
  if (options.registerProcessSignals !== false) {
    process.once("SIGINT", requestShutdown);
    process.once("SIGTERM", requestShutdown);
  }
  return {
    requestShutdown,
    closed,
    dispose: () => {
      disposeSignals();
      if (forceTimer) clearTimeout(forceTimer);
    }
  };
}
function attachScreenshotImage(resultDir, operation, args, result) {
  if (operation !== "screenshot" || args.includeImage !== true || result.ok === false) return result;
  const shot = result.shot;
  const path = typeof shot?.path === "string" ? shot.path : "";
  if (!path) return result;
  try {
    const safeRoot = realpathSync4(resultDir);
    const imagePath = realpathSync4(path);
    const fromRoot = relative5(safeRoot, imagePath);
    if (fromRoot.startsWith("..") || isAbsolute7(fromRoot)) {
      return {
        ...result,
        imageReadError: "Kontrollbild liegt ausserhalb des konfigurierten Ergebnisbereichs; Bildinhalt wurde nicht gelesen."
      };
    }
    const bytes = readFileBounded(imagePath, MAX_SCREENSHOT_IMAGE_BYTES);
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      return {
        ...result,
        imageReadError: "Kontrollbild besitzt keine gueltige PNG-Signatur; Bildinhalt wurde nicht angehaengt."
      };
    }
    return { ...result, imageBase64: bytes.toString("base64") };
  } catch {
    return {
      ...result,
      imageReadError: "Kontrollbild konnte nach erfolgreichem Worker-Aufruf nicht gelesen werden; Ergebnis bleibt erhalten."
    };
  }
}
async function runApiRuntime(configPath, overrides = {}) {
  const runtimeEnvironment = configPath ? environmentForExplicitApiConfig(configPath) : { ...process.env };
  if (overrides.caseDir) runtimeEnvironment.SSE_CASE_DIR = overrides.caseDir;
  const config = loadApiServerConfig(runtimeEnvironment);
  const expectedConfigurationFingerprint = process.env[SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT];
  const expectedBaseUrl = process.env[SSE_EXPECTED_API_BASE_URL];
  delete process.env[SSE_EXPECTED_API_CONFIGURATION_FINGERPRINT];
  delete process.env[SSE_EXPECTED_API_BASE_URL];
  const configIdentity = configurationFingerprint(config);
  const configuredHost = config.host === "::1" ? "[::1]" : config.host;
  const configuredBaseUrl = `http://${configuredHost}:${config.port}`;
  if (expectedConfigurationFingerprint !== void 0 && (!/^[0-9a-f]{64}$/u.test(expectedConfigurationFingerprint) || expectedConfigurationFingerprint !== configIdentity)) {
    throw new Error("Supervisor-Startvertrag stimmt nicht mit der gelesenen API-Konfiguration ueberein.");
  }
  if (expectedBaseUrl !== void 0 && expectedBaseUrl !== configuredBaseUrl) {
    throw new Error("Supervisor-Startvertrag stimmt nicht mit dem gelesenen API-Endpunkt ueberein.");
  }
  const explicitConfigEnvironment = configPath ? runtimeEnvironment : void 0;
  if (explicitConfigEnvironment) {
    for (const key of SSE_API_CONFIG_ENVIRONMENT_KEYS) delete process.env[key];
    process.env.SSE_API_CONFIG = config.configPath;
  }
  process.env.SSE_PROFILE_ID = config.profileId;
  if (config.caseDir) process.env.SSE_CASE_DIR = config.caseDir;
  if (config.sseExecutable) process.env.SSE_EXECUTABLE = config.sseExecutable;
  if (config.operateExperimental === true) process.env.SSE_OPERATE_EXPERIMENTAL = "1";
  const shutdown = new AbortController();
  const execute = createApiExecutor(config, async (operation, args, timeoutMs, signal) => {
    const result = await withCombinedAbortSignal([signal, shutdown.signal], (combinedSignal) => callWorker(operation, args, timeoutMs, combinedSignal));
    return attachScreenshotImage(config.resultDir, operation, args, result);
  });
  const logDir = join14(dirname14(config.configPath), "logs");
  const logPath = join14(logDir, "api.jsonl");
  const maxLogBytes = 5 * 1024 * 1024;
  const { log } = createRotatingJsonlLogger({ logPath, maxBytes: maxLogBytes });
  const server = createSseApiServer({
    execute,
    log,
    configurationFingerprint: configIdentity,
    prewarmStatus: () => ({ ready: isWarmSpareReady(), failure: lastPrewarmFailure() })
  });
  installApiShutdown(server, shutdown, log);
  await listenSseApiServer(server, config.host, config.port);
  shutdown.signal.addEventListener("abort", shutdownWarmSpare, { once: true });
  enableWorkerPrewarm();
  log({ event: "ready", host: config.host, port: config.port });
  return { baseUrl: configuredBaseUrl, configPath: config.configPath };
}
var MAX_SCREENSHOT_IMAGE_BYTES, PNG_SIGNATURE;
var init_api_runtime = __esm({
  "src/api-runtime.ts"() {
    "use strict";
    init_api_config();
    init_api_executor();
    init_api_server();
    init_worker();
    init_worker_prewarm();
    init_workspace_status();
    init_api_supervisor_contract();
    init_abort();
    init_bounded_files();
    init_jsonl_logger();
    MAX_SCREENSHOT_IMAGE_BYTES = 20 * 1024 * 1024;
    PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

// src/api-main-arguments.ts
import { isAbsolute, resolve } from "node:path";
var API_MAIN_USAGE = [
  "Aufruf: steuer-spar-erklaerung-api [--config <ordner>\\config.json] [--case-dir <Fallordner>]",
  "",
  "--config nennt den absoluten Pfad der Konfigurationsdatei und legt damit fest,",
  "  wo Arbeitsbereich und Protokoll entstehen. Die Datei muss nicht existieren:",
  "  jedes Feld hat einen Standardwert, und der erste Start legt die Ordner an.",
  "  Ohne --config liegt alles unter %LOCALAPPDATA%\\SteuerSparErklaerungApi.",
  "--case-dir bindet nur den laufenden Prozess an einen bestaetigten absoluten Fallordner.",
  "",
  "Die API kennt keine Anmeldung. Sie lauscht nur auf Loopback und weist Aufrufe",
  "aus einem Browser ueber 'Origin', 'Sec-Fetch-Site' und 'Host' mit 403 ab."
].join("\n");
function parseApiMainArguments(argv) {
  if (argv.length === 0) return { help: false };
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return { help: true };
  let configPath;
  let caseDir;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!["--config", "--case-dir"].includes(option ?? "") || !value || value.startsWith("--")) {
      throw new Error(`Ungueltige API-Startargumente. ${API_MAIN_USAGE}`);
    }
    if (option === "--config") {
      if (configPath) throw new Error(`--config darf nur einmal angegeben werden. ${API_MAIN_USAGE}`);
      if (!isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
        throw new Error(`Ungueltige API-Startargumente: --config muss ein absoluter Pfad ohne Steuerzeichen sein. ${API_MAIN_USAGE}`);
      }
      configPath = resolve(value);
    } else {
      if (caseDir) throw new Error(`--case-dir darf nur einmal angegeben werden. ${API_MAIN_USAGE}`);
      if (!isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
        throw new Error(`--case-dir muss ein absoluter Pfad ohne Steuerzeichen sein. ${API_MAIN_USAGE}`);
      }
      caseDir = resolve(value);
    }
    index += 1;
  }
  return {
    help: false,
    ...configPath ? { configPath } : {},
    ...caseDir ? { caseDir } : {}
  };
}

// src/api-main.ts
function describePortConflict(error) {
  const listen = error;
  if (listen?.code !== "EADDRINUSE") return error;
  const address = typeof listen.address === "string" ? listen.address : "127.0.0.1";
  const port = typeof listen.port === "number" ? listen.port : 0;
  return new Error(
    `Auf ${address}:${port} laeuft bereits eine SSE-API. Nicht fortfahren: die laufende Instanz kann anders konfiguriert sein. Entweder diese Instanz weiterverwenden oder sie zuerst mit Strg+C beenden.`
  );
}
async function main() {
  const args = parseApiMainArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${API_MAIN_USAGE}
`);
    return;
  }
  const { assertForegroundCaseDirectory: assertForegroundCaseDirectory2, ensureForegroundApiFirstRun: ensureForegroundApiFirstRun2 } = await Promise.resolve().then(() => (init_api_first_run(), api_first_run_exports));
  if (args.caseDir) assertForegroundCaseDirectory2(args.caseDir);
  const firstRun = ensureForegroundApiFirstRun2(args.configPath);
  const { runApiRuntime: runApiRuntime2 } = await Promise.resolve().then(() => (init_api_runtime(), api_runtime_exports));
  const ready = await runApiRuntime2(args.configPath, args.caseDir ? { caseDir: args.caseDir } : {}).catch((error) => {
    throw describePortConflict(error);
  });
  if (firstRun.created) process.stdout.write(`Lokale Standardkonfiguration erstellt: ${firstRun.configPath}
`);
  process.stdout.write(
    `SSE-API bereit: ${ready.baseUrl} (${args.caseDir ? "Fallordner fuer diesen Lauf gebunden" : "kein Fallordner gebunden"}).
Dieses Terminal offen lassen; Strg+C beendet die API.
`
  );
}
process.on("unhandledRejection", (error) => {
  process.stderr.write(`Unbehandelte Promise-Ablehnung: ${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
});
main().catch((error) => {
  process.stderr.write(`SSE-API-Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
});
