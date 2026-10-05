/**
 * A failure in plain words. Its own module, free of components, so the session (which every page,
 * the login page included, loads) can use it without pulling the page states and their icons in.
 */
import { ApiError } from "~/api/client";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.status === 403 ? "You do not have access to this." : error.message;
  // fetch rejects with a TypeError when the API cannot be reached at all
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return "Could not reach FlowAId's API. Check that FlowAId is still running, then try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}
