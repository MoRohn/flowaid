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
