"use client";
import { use, type ReactNode } from "react";
import { AssistantProvider } from "~/assistant/AssistantProvider";
import { GuideProvider } from "~/guide/GuideProvider";
import { SessionProvider } from "~/session";

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ ws: string }>;
}) {
  const { ws } = use(params);
  return (
    <SessionProvider ws={ws}>
      <AssistantProvider>
        <GuideProvider>{children}</GuideProvider>
      </AssistantProvider>
    </SessionProvider>
  );
}
