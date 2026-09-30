"use client";
/**
 * A server's tool policy (`PATCH /v1/mcp/servers/:id/policy`): which of its tools may be called,
 * which never, and which always wait for a person's approval. Globs match the server's own tool
 * names; the preview applies them to the tools discovered last time. Calls follow the new policy
 * at once; the tool list changes at the next discovery.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Textarea,
} from "@flowaid/ui/primitives";
import { get, patch } from "~/api/client";
import { useSession } from "~/session";
import type { McpServer } from "../types";
import { Notice, useMutate } from "../ui";
import { parseGlobs, policyPreview, type ToolPolicy } from "./guide";

const VERDICT = {
  allowed: { tone: "ok", label: "Allowed" },
  approval: { tone: "warn", label: "Needs approval" },
  blocked: { tone: "danger", label: "Blocked" },
} as const;

export function McpPolicyDialog({
  server,
  onClose,
  onRediscover,
}: {
  server: McpServer;
  onClose: () => void;
  /** runs discovery again (an explicit button) */
  onRediscover: (server: McpServer) => void;
}) {
  const s = useSession();
  const p = server.toolPolicy;
  const [allow, setAllow] = useState((p?.allow ?? ["*"]).join("\n"));
  const [deny, setDeny] = useState((p?.deny ?? []).join("\n"));
  const [approval, setApproval] = useState((p?.approvalRequired ?? []).join("\n"));
  const [saved, setSaved] = useState(false);
  const tools = useQuery({
    queryKey: ["mcp-server-tools", s.ws, server.id],
    queryFn: () =>
      get<{ name: string; "x-mcp-name"?: string }[]>(`/v1/mcp/servers/${server.id}/tools`),
  });
  const policy: ToolPolicy = {
    allow: parseGlobs(allow),
    deny: parseGlobs(deny),
    approvalRequired: parseGlobs(approval),
  };
  const names = (tools.data ?? []).map((t) => t["x-mcp-name"] ?? t.name);
  const preview = policyPreview(policy, names);
  const save = useMutate(() => patch<McpServer>(`/v1/mcp/servers/${server.id}/policy`, policy), {
    success: `Saved the tool policy of ${server.name}`,
    invalidate: [["mcp-servers", s.ws]],
    errorTitle: "Could not save the tool policy",
    onSuccess: () => setSaved(true),
  });
  const http = server.transport !== "stdio";

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Tool policy: {server.name}</DialogTitle>
          <DialogDescription>
            Limit which of the server&apos;s tools workflows and agents may call. One pattern per
            line; <code className="font-mono">*</code> matches anything, so{" "}
            <code className="font-mono">get_*</code> matches every tool whose name starts with get_.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[70vh] flex-col gap-4 overflow-auto">
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldRow
              label="Allow"
              htmlFor="pol-allow"
              hint="Only these may be called. * (or empty) allows all."
            >
              <Textarea
                id="pol-allow"
                className="font-mono"
                rows={4}
                value={allow}
                onChange={(e) => setAllow(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Block" htmlFor="pol-deny" hint="Never called; wins over Allow.">
              <Textarea
                id="pol-deny"
                className="font-mono"
                rows={4}
                value={deny}
                placeholder="delete_*"
                onChange={(e) => setDeny(e.target.value)}
              />
            </FieldRow>
            <FieldRow
              label="Ask first"
              htmlFor="pol-approval"
              hint="Marked as needing approval: agents that ask for irreversible calls wait for a person."
            >
              <Textarea
                id="pol-approval"
                className="font-mono"
                rows={4}
                value={approval}
                placeholder="create_*"
                onChange={(e) => setApproval(e.target.value)}
              />
            </FieldRow>
          </div>
          <section aria-labelledby="pol-preview" className="flex flex-col gap-2">
            <h3 id="pol-preview" className="m-0 text-xs font-semibold text-ink">
              Preview on the tools discovered last time
            </h3>
            {tools.isPending ? (
              <p className="m-0 text-xs text-ink-3">Loading the tools…</p>
            ) : names.length === 0 ? (
              <p className="m-0 text-xs text-ink-3">
                No tools discovered yet. Discover the server&apos;s tools to preview the policy on
                them.
              </p>
            ) : (
              <ul
                className="m-0 flex max-h-56 list-none flex-col divide-y divide-border overflow-auto rounded-md border border-border p-0"
                aria-label="Policy preview"
              >
                {preview.map((t) => (
                  <li key={t.name} className="flex items-center gap-2 px-3 py-1.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                      {t.name}
                    </code>
                    <Badge tone={VERDICT[t.verdict].tone} dot>
                      {VERDICT[t.verdict].label}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 text-2xs text-ink-3">
              Tools an earlier policy blocked are not listed here. Tools with suspicious
              descriptions are always marked as needing approval.
            </p>
          </section>
          {saved ? (
            <Notice tone="info">
              Saved. Calls follow it now; the tool list that steps and agents offer changes at the
              next discovery.
              {http ? (
                <>
                  {" "}
                  <Button size="sm" variant="link" onClick={() => onRediscover(server)}>
                    Discover again
                  </Button>
                </>
              ) : null}
            </Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {saved ? "Done" : "Cancel"}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Save policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
