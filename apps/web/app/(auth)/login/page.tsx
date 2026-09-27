"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button, FieldError, FieldRow, Input, Label, LogoWordmark } from "@flowaid/ui/primitives";
import { ApiError, post, setWorkspace } from "~/api/client";

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
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(
        safeNext ?? (res.workspaces[0] ? `/${res.workspaces[0].slug}/workflows` : "/"),
      );
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
