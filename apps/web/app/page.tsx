"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiError, get, setWorkspace } from "~/api/client";
import type { Me } from "~/api/types";
import { FullPageError, FullPageSpinner, meQueryKey } from "~/session";

/** `/`: signed in → the first workspace's home; otherwise the login page. */
export default function Root() {
  setWorkspace(null);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: meQueryKey(null),
    queryFn: () => get<Me>("/v1/me"),
    retry: false,
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login");
    const first = me.data?.workspaces[0];
    if (!me.data || !first) return;
    // the answer is already the first workspace's: the workspace session reuses it
    if (me.data.principal.workspaceSlug === first.slug)
      qc.setQueryData(meQueryKey(first.slug), me.data);
    router.replace(`/${first.slug}`);
  }, [me.data, me.error, router, qc]);
  if (me.data && me.data.workspaces.length === 0)
    return (
      <FullPageError message="Your account does not belong to any workspace yet. Ask an owner to invite you." />
    );
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401))
    return <FullPageError message={me.error.message} />;
  return <FullPageSpinner />;
}
