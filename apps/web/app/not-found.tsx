"use client";
/**
 * A URL outside any workspace that no page answers. Branded, in the app's theme, with a way back;
 * paths under a workspace have their own page inside the frame (`(app)/[ws]/not-found.tsx`).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark, buttonVariants } from "@flowaid/ui/primitives";

export default function NotFound() {
  const pathname = usePathname();
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6 text-ink">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <LogoMark size={40} />
        <h1 className="m-0 text-lg font-semibold tracking-tight text-ink">
          This page does not exist
        </h1>
        <p className="m-0 text-sm text-ink-2">
          Nothing in FlowAId lives at{" "}
          <code className="break-all font-mono text-xs text-ink">{pathname}</code>. The link may be
          mistyped, or the page has moved.
        </p>
        <Link href="/" className={buttonVariants({ variant: "primary" })}>
          Go to your workspace
        </Link>
      </div>
    </main>
  );
}
