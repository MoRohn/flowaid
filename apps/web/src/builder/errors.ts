import { ApiError } from "~/api/client";

/** What stopped a run, in words: the server's diagnostics when it validated the draft. */
export function runErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return "The run could not start.";
  const diags = (e.details as { diagnostics?: { message: string }[] } | undefined)?.diagnostics;
  if (diags?.length) {
    const first = diags.slice(0, 2).map((d) => d.message);
    const more = diags.length > 2 ? ` (+${diags.length - 2} more)` : "";
    return `The run could not start: ${first.join("; ")}${more}`;
  }
  return e.message;
}

/** Why a run did not start, sorted by what the person can do about it. */
export type RunErrorKind =
  "input" | "draft" | "secrets" | "connection" | "permission" | "busy" | "conflict" | "server";

export interface RunStartError {
  kind: RunErrorKind;
  /** One sentence: what happened. */
  title: string;
  /** What to do next. */
  action: string;
  /** Individual problems (an input field, a compiler diagnostic), in words. */
  items: string[];
  /** The server's code and request id, for the technical details line. */
  code?: string;
  requestId?: string;
}

interface Issue {
  path?: string;
  message?: string;
}

/** "must have required property 'message'" at "/" → "Message is required". */
export function describeInputIssue(issue: Issue): string {
  const message = issue.message ?? "is not valid";
  const required = /^must have required property '([^']+)'$/.exec(message);
  const field = (name: string) => humanizeField(name);
  if (required?.[1]) return `${field(required[1])} is required`;
  const path = (issue.path ?? "/").split("/").filter(Boolean);
  if (!path.length) return capitalize(message);
  return `${path.map(field).join(" › ")} ${message}`;
}

function humanizeField(name: string): string {
  return capitalize(name.replace(/[_-]+/g, " ").trim());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Classifies a failed `POST /v1/workflows/:id/run`: the input did not match the workflow's inputs,
 * the draft does not compile, the network or the server failed, or the person may not run it. Only
 * what the error actually says is used; anything else reads as a server failure with its message.
 */
export function describeRunError(e: unknown): RunStartError {
  if (!(e instanceof ApiError)) {
    // fetch rejects (TypeError) when the request never reached the server
    return {
      kind: "connection",
      title: "FlowAId could not be reached, so the run did not start.",
      action: "Check that FlowAId is still running, then press Run draft again.",
      items: [],
    };
  }
  const details = (e.details ?? {}) as {
    issues?: Issue[];
    diagnostics?: { code?: string; message: string }[];
  };
  const base = { code: e.code, ...(e.requestId ? { requestId: e.requestId } : {}) };
  if (details.issues?.length) {
    return {
      ...base,
      kind: "input",
      title: "The run input is incomplete or not valid, so the run did not start.",
      action: "Correct the fields below and run again. Nothing you typed was lost.",
      items: details.issues.map(describeInputIssue),
    };
  }
  const unbound = details.diagnostics?.filter((d) => d.code === "E_SECRET_UNBOUND");
  if (unbound?.length) {
    return {
      ...base,
      kind: "secrets",
      title:
        "A key this workflow needs is not connected for this environment, so the run did not start.",
      action:
        "Bind a saved credential to it in the workflow's Secrets settings, or set the provider's key in the server's environment, then run again.",
      items: unbound.map((d) => d.message),
    };
  }
  if (details.diagnostics?.length) {
    return {
      ...base,
      kind: "draft",
      title: "The server found problems in the draft, so the run did not start.",
      action: "Open Problems to fix them, then run again.",
      items: details.diagnostics.map((d) => d.message),
    };
  }
  if (e.status === 401 || e.status === 403)
    return {
      ...base,
      kind: "permission",
      title: "You are not allowed to run this workflow.",
      action:
        e.status === 401
          ? "Your session ended. Reload the page to sign in again; the draft is saved."
          : "Ask a workspace owner for a role that can start runs.",
      items: [],
    };
  if (e.status === 409 || e.status === 412)
    return {
      ...base,
      kind: "conflict",
      title: "The draft changed elsewhere before the run started.",
      action: "Resolve the draft conflict, then run again.",
      items: [e.message],
    };
  if (e.status === 429)
    return {
      ...base,
      kind: "busy",
      title: "Too many runs were started just now.",
      action: "Wait a few seconds and run again.",
      items: [],
    };
  if (e.status >= 500)
    return {
      ...base,
      kind: "server",
      title: "The server failed while starting the run.",
      action: "Try again. If it keeps failing, the API log has the details for the request below.",
      items: [e.message],
    };
  return {
    ...base,
    kind: "server",
    title: "The run did not start.",
    action: "Check the message below, correct what it names and run again.",
    items: [e.message],
  };
}
