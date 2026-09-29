"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@flowaid/ui/theme";
import { Toaster, TooltipProvider } from "@flowaid/ui/primitives";
import { ApiError } from "~/api/client";
import { recordAppWindow } from "~/shell/appWindow";

// before the root page's redirect drops the launcher's #flowaid-window
recordAppWindow();

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, error) =>
              count < 2 && !(error instanceof ApiError && error.status < 500),
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
