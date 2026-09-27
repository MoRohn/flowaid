/** `ErrorEnvelopeSchema` for every failure (API.md §2). */
import type { FastifyError, FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";
import { FlowaidError, toFlowaidError, type JsonValue } from "@flowaid/workflow-core";

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: JsonValue;
    request_id: string;
    run_id?: string;
    node_id?: string;
    node_run_id?: string;
  };
}

export function envelope(
  code: string,
  message: string,
  requestId: string,
  retryable = false,
  details?: JsonValue,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      retryable,
      request_id: requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    void reply
      .code(404)
      .send(envelope("NOT_FOUND", `no route ${req.method} ${req.url.split("?")[0] ?? ""}`, req.id));
  });
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((v) => ({
        path: v.instancePath || "/",
        message: v.message ?? "invalid",
        ...(v.params ? { params: v.params as JsonValue } : {}),
      }));
      return reply
        .code(400)
        .send(
          envelope(
            "BAD_REQUEST",
            `request ${error.validationContext ?? "input"} is invalid`,
            req.id,
            false,
            { issues },
          ),
        );
    }
    if (isResponseSerializationError(error)) {
      req.log.error({ err: error, cause: error.cause }, "response did not match its schema");
      return reply
        .code(500)
        .send(envelope("INTERNAL_ERROR", "the response did not match its declared schema", req.id));
    }
    if (error.statusCode === 429)
      return reply
        .code(429)
        .send(envelope("RATE_LIMIT_ERROR", error.message || "rate limit exceeded", req.id, true));
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(413).send(envelope("PAYLOAD_TOO_LARGE", "request body too large", req.id));
    if (
      error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
      error.code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
      (error.statusCode === 400 && !(error instanceof FlowaidError))
    )
      return reply.code(400).send(envelope("BAD_REQUEST", error.message, req.id));
    const fe = toFlowaidError(error);
    const status = fe.httpStatus ?? 500;
    if (status >= 500) req.log.error({ err: error }, "request failed");
    const message = status >= 500 && fe.code === "INTERNAL" ? "internal error" : fe.message;
    const info = fe.toInfo({});
    return reply
      .code(status)
      .send(envelope(fe.code, message, req.id, fe.retryable, info.details ?? undefined));
  });
}
