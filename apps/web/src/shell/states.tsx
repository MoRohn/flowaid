"use client";
/** Shared loading, empty and error states for pages. */
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, EmptyState, buttonVariants } from "@flowaid/ui/primitives";
import { ApiError } from "~/api/client";

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.status === 403 ? "You do not have access to this." : error.message;
  // fetch rejects with a TypeError when the API cannot be reached at all
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return "Could not reach FlowAId's API. Check that FlowAId is still running, then try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * A page that could not load. A missing item says so and links back to its list (retrying cannot
 * bring it back); anything else offers Try again, with the API's code and request id on demand.
 */
export function ErrorPanel({
  error,
  onRetry,
  back,
}: {
  error: unknown;
  onRetry?: () => void;
  /** where to go from a missing item, e.g. { href: "/acme/runs", label: "All runs" } */
  back?: { href: string; label: string };
}) {
  const notFound = error instanceof ApiError && error.status === 404;
  const technical =
    error instanceof ApiError
      ? [`HTTP ${error.status}`, error.code, error.requestId && `request ${error.requestId}`]
          .filter(Boolean)
          .join(" · ")
      : undefined;
  return (
    <EmptyState
      icon={<AlertTriangle strokeWidth={1.5} />}
      title={notFound ? "Not found" : "Could not load this"}
      description={
        <>
          {notFound
            ? `${sentence(errorMessage(error)).replace(/\.?$/, ".")} It may have been deleted, or the link is wrong.`
            : errorMessage(error)}
          {technical && !notFound ? <TechnicalDetails text={technical} /> : null}
        </>
      }
      primaryAction={
        notFound && back ? (
          <Link href={back.href} className={buttonVariants({ variant: "secondary" })}>
            {back.label}
          </Link>
        ) : onRetry && !notFound ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

/** Inside the empty state's paragraph, so a button and spans rather than <details>. */
function TechnicalDetails({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="mt-2 block text-2xs text-ink-3">
      <button
        type="button"
        aria-expanded={open}
        className="rounded-sm underline-offset-2 hover:underline focus-visible:shadow-(--focus) focus-visible:outline-none"
        onClick={() => setOpen((o) => !o)}
      >
        Technical details
      </button>
      {open ? <span className="mt-1 block font-mono">{text}</span> : null}
    </span>
  );
}
