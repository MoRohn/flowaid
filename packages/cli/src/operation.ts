/** One API operation as the CLI sees it (generated into `generated/operations.ts` from `x-cli`). */
export interface CliParam {
  name: string;
  /** JSON Schema type of the parameter (`any` when the schema does not say). */
  type: string;
  required: boolean;
  enum?: unknown[];
  description?: string;
}

export interface CliOperation {
  noun: string;
  verb: string;
  method: string;
  /** OpenAPI path template, e.g. `/v1/runs/{id}` */
  path: string;
  summary?: string;
  /** `public` | `session` | `session_or_api_key` */
  auth: string;
  /** Path parameters taken as positional arguments, in order. */
  positional: string[];
  query: CliParam[];
  /** JSON body, when the operation takes one: top-level properties become flags. */
  body: { required: boolean; properties: CliParam[] } | null;
}
