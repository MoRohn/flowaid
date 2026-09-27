"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiError, get, setWorkspace } from "~/api/client";
import type { Me } from "~/api/types";
import { FullPageError, FullPageSpinner } from "~/session";

/** `/`: signed in → the first workspace; otherwise the login page. */
export default function Root() {
  setWorkspace(null);
  const router = useRouter();
  const me = useQuery({ queryKey: ["me", null], queryFn: () => get<Me>("/v1/me"), retry: false });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login");
    const first = me.data?.workspaces[0];
    if (first) router.replace(`/${first.slug}/workflows`);
  }, [me.data, me.error, router]);
  if (me.data && me.data.workspaces.length === 0)
    return (
      <FullPageError message="Your account does not belong to any workspace yet. Ask an owner to invite you." />
    );
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401))
    return <FullPageError message={me.error.message} />;
  return <FullPageSpinner />;
}
