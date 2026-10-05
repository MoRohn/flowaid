"use client";
/**
 * The workspace segment's error boundary: an unexpected render error in any page under `/[ws]`
 * shows the shared error panel with "Try again" (Next re-fetches and re-renders the segment)
 * instead of a blank screen. The session layout above it stays mounted.
 */
import { ErrorPanel } from "~/shell/states";

export default function WorkspaceError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="grid h-dvh place-items-center p-6">
      <div role="alert">
        <ErrorPanel error={error} onRetry={retry} page />
      </div>
    </main>
  );
}
