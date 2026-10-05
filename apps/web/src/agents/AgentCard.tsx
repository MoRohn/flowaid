"use client";
/** One agent on the Agents page: its model, bounds and tools, with Edit and Delete. */
import { useMemo } from "react";
import type { ToolDefinition } from "@flowaid/workflow-core";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@flowaid/ui/primitives";
import { AgentActiveSwitch } from "./AgentActiveSwitch";
import {
  asksFirst,
  boundsOf,
  changesData,
  missingTools,
  modelLabel,
  type AgentPreset,
  type ApprovalMode,
} from "./logic";

export function AgentCard({
  agent: a,
  catalog,
  canWrite,
  onEdit,
  onDelete,
}: {
  agent: AgentPreset;
  /** the workspace's tool catalog; undefined until it has loaded */
  catalog: readonly ToolDefinition[] | undefined;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tools = (Array.isArray(a.config.tools) ? a.config.tools : []) as {
    name: string;
    approval: ApprovalMode;
  }[];
  const changes = useMemo(
    () => (catalog ? new Map(catalog.map((t) => [t.name, changesData(t)])) : undefined),
    [catalog],
  );
  const known = useMemo(() => (changes ? new Set(changes.keys()) : undefined), [changes]);
  const missing = new Set(missingTools(tools, known));
  const bounds = boundsOf(a.config);
  return (
    <Card className={a.active === false ? "opacity-80" : undefined}>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <CardTitle className="min-w-0 break-words">{a.name}</CardTitle>
            <AgentActiveSwitch agent={a} disabled={!canWrite} />
          </div>
          {a.description ? <CardDescription>{a.description}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-3">Model</dt>
          <dd className="min-w-0 break-words font-mono text-ink">{modelLabel(a.config.model)}</dd>
          <dt className="text-ink-3">Bounds</dt>
          <dd className="font-mono text-ink">
            {`${bounds.maxSteps} steps · ${bounds.maxToolCalls} tool calls · $${bounds.maxCostUsd}`}
          </dd>
        </dl>
        <div className="flex flex-wrap gap-1.5">
          {tools.length === 0 ? (
            <span className="text-xs text-ink-3">No tools</span>
          ) : (
            tools.map((t) => {
              if (missing.has(t.name))
                return (
                  <Badge key={t.name} tone="danger">
                    <span className="font-mono">{t.name}</span>
                    <span> · no longer available</span>
                  </Badge>
                );
              // the badge says what really happens: a read-only tool never waits for a person
              const asks = asksFirst(t.approval, changes?.get(t.name));
              return (
                <Badge key={t.name} tone={asks ? "warn" : "neutral"}>
                  <span className="font-mono">{t.name}</span>
                  <span className="sr-only">
                    {asks ? " (asks a person first)" : " (runs without asking)"}
                  </span>
                  {asks ? (
                    <span aria-hidden className="text-ink-3">
                      {" "}
                      · approval
                    </span>
                  ) : null}
                </Badge>
              );
            })
          )}
        </div>
        {missing.size ? (
          <p className="m-0 text-xs text-danger-text">
            Runs of this agent fail until {missing.size === 1 ? "that tool is" : "those tools are"}{" "}
            removed (Edit, then Tools) or connected again.
          </p>
        ) : null}
        {canWrite ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${a.name}`}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${a.name}`}>
              Delete
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
