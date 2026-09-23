/**
 * The redacting logger (ARCHITECTURE.md §10.5): pino JSON lines bound to
 * `requestId / runId / nodeRunId / workspaceId`.
 *
 * Two layers keep secrets out of logs:
 *
 * 1. `redact.paths` censor well-known carriers wherever they are logged as structured fields
 *    (`Authorization`, cookies, webhook tokens and signatures, the `?t=` token of external review
 *    links, `Set-Cookie`).
 * 2. Every serialised line passes through the `Redactor` before it reaches the destination, so a
 *    learned secret (a decrypted credential value, a secret environment value) is replaced in
 *    the message, bindings, error stacks and nested fields alike. Bearer and Basic credentials in
 *    free text are scrubbed even when they were never learned.
 */
import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { REDACTED, type Redactor } from "@flowaid/credentials";

/** Fields every flowaid log line can be bound to. */
export interface LogBindings {
  service?: string;
  requestId?: string;
  runId?: string;
  nodeRunId?: string;
  workspaceId?: string;
  [key: string]: string | number | boolean | undefined;
}

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/** Structured paths censored by pino before serialisation. */
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-webhook-token"]',
  'req.headers["x-signature"]',
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
  "req.query.t",
  'res.headers["set-cookie"]',
  "headers.authorization",
  "headers.cookie",
];

export interface CreateLoggerOptions {
  /** Learned secrets are replaced in every line; without one only the fixed rules apply. */
  redactor?: Redactor;
  level?: LogLevel;
  /** Where lines go (default: stdout). Anything with `write(line)`. */
  destination?: DestinationStream;
  /** Extra structured paths to censor. */
  redactPaths?: readonly string[];
  /** Overrides for pino (applied last; `redact`, `hooks` and `formatters.level` are kept). */
  pino?: Omit<LoggerOptions, "redact" | "hooks" | "level">;
}

/** `Bearer <token>` / `Basic <b64>` in free text, however it got there. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;

/** Scrubs one serialised line: learned secrets first, then auth schemes. */
export function scrubLine(line: string, redactor?: Redactor): string {
  const learned = redactor ? redactor.redactText(line) : line;
  return learned.replace(AUTH_SCHEME, (_match, scheme: string) => `${scheme} ${REDACTED}`);
}

/** Wraps a destination so every line is scrubbed before it is written. */
export function redactingDestination(
  destination: DestinationStream,
  redactor?: Redactor,
): DestinationStream {
  return { write: (line: string) => destination.write(scrubLine(line, redactor)) };
}

/**
 * Creates the process logger. Child loggers (`logger.child({ runId })`) share the destination,
 * so they are redacted too.
 */
export function createLogger(
  bindings: LogBindings = {},
  options: CreateLoggerOptions = {},
): Logger {
  const destination = redactingDestination(
    options.destination ?? pino.destination({ dest: 1, sync: false }),
    options.redactor,
  );
  const base = Object.fromEntries(Object.entries(bindings).filter(([, v]) => v !== undefined));
  return pino(
    {
      timestamp: pino.stdTimeFunctions.isoTime,
      ...options.pino,
      base,
      level: options.level ?? "info",
      redact: { paths: [...REDACT_PATHS, ...(options.redactPaths ?? [])], censor: REDACTED },
      formatters: {
        ...options.pino?.formatters,
        level: (label) => ({ level: label }),
      },
    },
    destination,
  );
}

export type { Logger } from "pino";
