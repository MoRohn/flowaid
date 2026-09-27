"use client";
/**
 * The external reviewer page (UI.md §1): no shell, no session. The token arrives in the URL
 * fragment (`#t=…`, never sent to any server by the browser), is removed from the address bar at
 * once, kept for this tab only, and sent as `Authorization: Bearer` to `GET /v1/review` and
 * `POST /v1/review/respond`. The page renders `ExternalReviewView` only: title, context and the
 * response form, never run ids, node runs or assignees.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LinkIcon } from "lucide-react";
import type { HumanResponse } from "@flowaid/workflow-core";
import { EmptyState, LogoWordmark, Spinner } from "@flowaid/ui/primitives";
import { ReviewPage } from "@flowaid/ui/human";
import { externalToApproval, tokenFromHash } from "~/runs/humanTasks";
import type { ExternalReviewView } from "~/runs/types";

const STORAGE_KEY = "flowaid:review-token";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "gone" }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: ExternalReviewView }
  | { kind: "done"; action: HumanResponse["action"] };

function readToken(): string | null {
  const fromHash = tokenFromHash(window.location.hash);
  if (fromHash) {
    // Out of the address bar (and so out of history, screenshots and shared URLs) right away.
    window.history.replaceState(null, "", window.location.pathname);
    try {
      sessionStorage.setItem(STORAGE_KEY, fromHash);
    } catch {
      /* private mode: the token lives in memory only */
    }
    return fromHash;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  return fetch(path, {
    method,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export default function ExternalReview() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (t: string) => {
    try {
      const res = await call(t, "GET", "/v1/review");
      if (res.status === 404 || res.status === 401) {
        forget();
        setState({ kind: "gone" });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `The server answered ${res.status}. Try again in a moment.`,
        });
        return;
      }
      setState({ kind: "ready", view: (await res.json()) as ExternalReviewView });
    } catch {
      setState({
        kind: "error",
        message: "The server is unreachable. Check your connection and reload.",
      });
    }
  }, []);

  useEffect(() => {
    const t = readToken();
    // Reading the fragment is a one-time sync with the browser's URL on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t);
    if (!t) setState({ kind: "missing" });
    else void load(t);
  }, [load]);

  const respond = async (response: HumanResponse) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const res = await call(token, "POST", "/v1/review/respond", { response });
      if (res.status === 404) {
        forget();
        setState({ kind: "gone" });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setState({
          kind: "error",
          message: body?.error?.message ?? `The server answered ${res.status}.`,
        });
        return;
      }
      forget();
      setState({ kind: "done", action: response.action });
    } finally {
      setSubmitting(false);
    }
  };

  const brand = <LogoWordmark className="h-5" />;

  if (state.kind === "ready")
    return (
      <main className="min-h-dvh bg-canvas">
        <ReviewPage
          brand={brand}
          card={{
            request: externalToApproval(state.view),
            workflowName: state.view.workflowName,
            onRespond: respond,
            submitting,
            hotkeys: true,
          }}
        />
      </main>
    );

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        {brand}
        {state.kind === "loading" ? (
          <div role="status" className="flex items-center gap-2 text-sm text-ink-3">
            <Spinner /> Loading the review…
          </div>
        ) : state.kind === "done" ? (
          <EmptyState
            icon={<CheckCircle2 strokeWidth={1.5} />}
            title="Thank you, your response was recorded"
            description="The workflow continues with your answer. You can close this page; the link no longer works."
          />
        ) : (
          <EmptyState
            icon={<LinkIcon strokeWidth={1.5} />}
            title={
              state.kind === "missing"
                ? "This page needs a review link"
                : state.kind === "gone"
                  ? "This review link no longer works"
                  : "Something went wrong"
            }
            description={
              state.kind === "missing"
                ? "Open the full link you were sent; it ends with #t= followed by a code."
                : state.kind === "gone"
                  ? "It has expired, was already used, or was revoked. Ask the person who sent it for a new one."
                  : state.message
            }
          />
        )}
      </div>
    </main>
  );
}
