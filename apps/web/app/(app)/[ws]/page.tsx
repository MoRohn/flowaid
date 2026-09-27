import { redirect } from "next/navigation";

/** The dashboard ships with the metrics overview (P6-04); until then the workspace opens on its workflows. */
export default async function WorkspaceHome({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  redirect(`/${ws}/workflows`);
}
