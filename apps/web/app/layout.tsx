import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "~/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FlowAId", template: "%s · FlowAId" },
  description: "Typed decision workflows: build, run, review and evaluate.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
