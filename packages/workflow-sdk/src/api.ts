/**
 * Typed access to every operation of the API through the generated `paths` (openapi-typescript
 * over the checked-in OpenAPI snapshot): `fa.api.get("/v1/runs/{id}/node-runs", { path: { id } })`.
 * Path, query and body types come from the document; the response is the JSON body of the
 * operation's success status (`unknown` where the route declares none).
 */
import type { paths } from "./generated/openapi.js";
import type { QueryValue, Transport } from "./http.js";

export type { paths };
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** Paths that define `M`. */
export type PathsWith<M extends HttpMethod> = {
  [P in keyof paths]: paths[P] extends { [K in M]: infer O }
    ? [O] extends [never]
      ? never
      : P
    : never;
}[keyof paths];

/** The operation object for `M P`. */
export type Operation<P extends keyof paths, M extends HttpMethod> = paths[P] extends {
  [K in M]: infer O;
}
  ? O
  : never;

type Params<O, Where extends "path" | "query"> = O extends {
  parameters: { [K in Where]?: infer X };
}
  ? [X] extends [undefined]
    ? never
    : X
  : never;

type RequestBody<O> = O extends { requestBody?: { content: { "application/json": infer B } } }
  ? B
  : never;

type SuccessStatus = 200 | 201 | 202 | 204;
type ResponseBody<R> = R extends { content: { "application/json": infer B } } ? B : unknown;

/** The JSON body of the operation's success response. */
export type ResponseOf<O> = O extends { responses: infer R }
  ? ResponseBody<R[Extract<keyof R, SuccessStatus>]>
  : unknown;

/** Call options: `path` is required exactly when the template has parameters. */
export type CallOptions<O> = ([Params<O, "path">] extends [never]
  ? { path?: undefined }
  : { path: Params<O, "path"> }) & {
  query?: [Params<O, "query">] extends [never] ? undefined : Params<O, "query">;
  body?: [RequestBody<O>] extends [never] ? undefined : RequestBody<O>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type OptionalWhenNoPath<O> = [Params<O, "path">] extends [never]
  ? [options?: CallOptions<O>]
  : [options: CallOptions<O>];

/** Fills `{name}` segments of an OpenAPI path template. */
export function fillPath(template: string, values: Record<string, unknown> | undefined): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values?.[name];
    if (value === undefined || value === null || value === "")
      throw new TypeError(`missing path parameter '${name}' for ${template}`);
    return encodeURIComponent(typeof value === "string" ? value : JSON.stringify(value));
  });
}

export class TypedApi {
  constructor(private readonly transport: Transport) {}

  async call<M extends HttpMethod, P extends PathsWith<M>>(
    method: M,
    path: P,
    ...[options]: OptionalWhenNoPath<Operation<P, M>>
  ): Promise<ResponseOf<Operation<P, M>>> {
    const o = (options ?? {}) as {
      path?: Record<string, unknown>;
      query?: Record<string, QueryValue>;
      body?: unknown;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    };
    return this.transport.request<ResponseOf<Operation<P, M>>>(
      method.toUpperCase(),
      fillPath(path, o.path),
      {
        query: o.query,
        body: o.body,
        headers: o.headers,
        signal: o.signal,
      },
    );
  }

  get<P extends PathsWith<"get">>(path: P, ...o: OptionalWhenNoPath<Operation<P, "get">>) {
    return this.call("get", path, ...o);
  }
  post<P extends PathsWith<"post">>(path: P, ...o: OptionalWhenNoPath<Operation<P, "post">>) {
    return this.call("post", path, ...o);
  }
  put<P extends PathsWith<"put">>(path: P, ...o: OptionalWhenNoPath<Operation<P, "put">>) {
    return this.call("put", path, ...o);
  }
  patch<P extends PathsWith<"patch">>(path: P, ...o: OptionalWhenNoPath<Operation<P, "patch">>) {
    return this.call("patch", path, ...o);
  }
  delete<P extends PathsWith<"delete">>(path: P, ...o: OptionalWhenNoPath<Operation<P, "delete">>) {
    return this.call("delete", path, ...o);
  }
}
