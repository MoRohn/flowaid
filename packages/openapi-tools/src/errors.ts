/** Import errors carry a stable code the API maps to diagnostics. */
import { BadRequestError } from "@flowaid/workflow-core";

export type OpenApiErrorCode =
  | "E_OPENAPI_INVALID"
  | "E_OPENAPI_EXTERNAL_REF"
  | "E_OPENAPI_TOO_LARGE"
  | "E_OPENAPI_UNSUPPORTED"
  | "E_TOOL_SERVER_PRIVATE";

export class OpenApiImportError extends BadRequestError {
  constructor(
    readonly diagnostic: OpenApiErrorCode,
    message: string,
  ) {
    super(`${diagnostic}: ${message}`, { diagnostic });
  }
}
