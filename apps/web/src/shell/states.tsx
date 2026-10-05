"use client";
/** Shared loading, empty and error states for pages. */
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button, EmptyState, buttonVariants } from "@flowaid/ui/primitives";
import { ApiError } from "~/api/client";
import { NAV, NAV_SECONDARY } from "./nav";

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The API refused the path itself: an id in the link is not even well formed. */
function badLink(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && /\bparams\b/i.test(error.message);
}

/**
 * A missing item: the API answered 404, or the link's id is malformed (a 400 for the path), which
 * no retry can fix either.
 */
export function isMissing(error: unknown): boolean {
  return (error instanceof ApiError && error.status === 404) || badLink(error);
}

/** "/acme/knowledge/<id>" → the Knowledge list: where a missing item's page links back to. */
export function listFor(pathname: string | null): { href: string; label: string } | undefined {
  const [, ws, section, item] = (pathname ?? "").split("/");
  if (!ws || !section || !item) return undefined;
  const entry = [...NAV, ...NAV_SECONDARY].find((e) => e.path === section);
  return entry ? { href: `/${ws}/${section}`, label: `Back to ${entry.label}` } : undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return error.status === 403 ? "You do not have access to this." : error.message;
  // fetch rejects with a TypeError when the API cannot be reached at all
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return "Could not reach FlowAId's API. Check that FlowAId is still running, then try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * A page that could not load. A missing item (or a link whose id is malformed) says so and links
 * back to its list, from `back` or else from the URL (retrying cannot bring it back); anything
 * else offers Try again, with the API's code and request id on demand. When it stands for the
 * whole page (a missing item, a detail page that passes `back`, or `page`) its title is the
 * page's h1.
 */
export function ErrorPanel({
  error,
  onRetry,
  back,
  page,
}: {
  error: unknown;
  onRetry?: () => void;
  /** where to go from a missing item, e.g. { href: "/acme/runs", label: "All runs" } */
  back?: { href: string; label: string };
  /** the panel is the whole page (its title becomes the h1) */
  page?: boolean;
}) {
  const pathname = usePathname();
  const notFound = isMissing(error);
  const backTo = back ?? (notFound ? listFor(pathname) : undefined);
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
      titleAs={page || notFound || back !== undefined ? "h1" : "p"}
      description={
        <>
          {badLink(error)
            ? "The id in this link is not valid, so it does not point to anything. Check the link, or go back to the list."
            : notFound
              ? `${sentence(errorMessage(error)).replace(/\.?$/, ".")} It may have been deleted, or the link is wrong.`
              : errorMessage(error)}
          {technical && !notFound ? <TechnicalDetails text={technical} /> : null}
        </>
      }
      primaryAction={
        notFound && backTo ? (
          <Link href={backTo.href} className={buttonVariants({ variant: "secondary" })}>
            {backTo.label}
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
