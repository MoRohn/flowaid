"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button, FieldError, FieldRow, Input, Label, LogoWordmark } from "@flowaid/ui/primitives";
import { ApiError, api, post, setWorkspace, signInLocally } from "~/api/client";
import { sessionNotKeptMessage } from "~/auth/cookieHint";
import { FullPageSpinner } from "~/session";

interface SessionResponse {
  workspaces: { slug: string }[];
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // FlowAId on your own computer signs you in by itself; the form is for server deployments
  const [local, setLocal] = useState<"trying" | "off">("trying");
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  useEffect(() => {
    let live = true;
    void signInLocally().then((ok) => {
      if (!live) return;
      if (ok) router.replace(safeNext ?? "/");
      else setLocal("off");
    });
    return () => {
      live = false;
    };
  }, [router, safeNext]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setWorkspace(null);
    try {
      const res = await post<SessionResponse>(
        "/v1/auth/login",
        { email, password },
        { noRefresh: true },
      );
      // the server accepted the password; check the browser kept the session before moving on
      const kept = await api("GET", "/v1/me", { noRefresh: true }).then(
        () => true,
        (e: unknown) => !(e instanceof ApiError && e.status === 401),
      );
      if (!kept) {
        setError(sessionNotKeptMessage(window.location));
        setBusy(false);
        return;
      }
      router.replace(safeNext ?? (res.workspaces[0] ? `/${res.workspaces[0].slug}` : "/"));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : err.status === 401
              ? "The email or password is wrong."
              : err.message
          : "The server is unreachable.",
      );
      setBusy(false);
    }
  }

  if (local === "trying") return <FullPageSpinner />;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-1"
      noValidate
    >
      <div className="mb-6 flex flex-col items-center gap-3">
        <LogoWordmark className="h-6" />
        <h1 className="text-base font-semibold text-ink">Sign in to your workspace</h1>
      </div>
      <div className="flex flex-col gap-4">
        <FieldRow>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FieldRow>
        <FieldRow>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FieldRow>
        {error ? <FieldError role="alert">{error}</FieldError> : null}
        <Button type="submit" loading={busy} disabled={!email || !password} className="w-full">
          Sign in
        </Button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
