"use client";
/** The credential types the server's own keys answer, from `GET /v1/providers` (shared cache). */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { get } from "~/api/client";
import { useSession } from "~/session";
import { serverCredentialTypes } from "./keySources";

export function useServerCredentialTypes(): ReadonlySet<string> {
  const s = useSession();
  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<{ id: string; configuredOnServer: boolean }[]>("/v1/providers"),
    staleTime: 60_000,
  });
  return useMemo(
    () =>
      serverCredentialTypes(
        Object.fromEntries((providers.data ?? []).map((p) => [p.id, p.configuredOnServer])),
      ),
    [providers.data],
  );
}
