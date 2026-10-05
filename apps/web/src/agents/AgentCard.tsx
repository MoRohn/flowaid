"use client";
/** One agent on the Agents page: its model, bounds and tools, with Edit and Delete. */
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
  APPROVAL_LABEL,
  boundsOf,
  missingTools,
  modelLabel,
  type AgentPreset,
  type ApprovalMode,
} from "./logic";

export function AgentCard({
  agent: a,
  known,
  canWrite,
  onEdit,
  onDelete,
}: {
  agent: AgentPreset;
  /** every tool name the workspace offers; undefined until the catalog has loaded */
  known: ReadonlySet<string> | undefined;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tools = (Array.isArray(a.config.tools) ? a.config.tools : []) as {
    name: string;
    approval: ApprovalMode;
  }[];
  const missing = new Set(missingTools(tools, known));
  const bounds = boundsOf(a.config);
  return (
    <Card className={a.active === false ? "opacity-80" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{a.name}</CardTitle>
          <AgentActiveSwitch agent={a} disabled={!canWrite} />
        </div>
        {a.description ? <CardDescription>{a.description}</CardDescription> : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-3">Model</dt>
          <dd className="font-mono text-ink">{modelLabel(a.config.model)}</dd>
          <dt className="text-ink-3">Bounds</dt>
          <dd className="font-mono text-ink">
            {`${bounds.maxSteps} steps · ${bounds.maxToolCalls} tool calls · $${bounds.maxCostUsd}`}
          </dd>
        </dl>
        <div className="flex flex-wrap gap-1.5">
          {tools.length === 0 ? (
            <span className="text-xs text-ink-3">No tools</span>
          ) : (
            tools.map((t) =>
              missing.has(t.name) ? (
                <Badge key={t.name} tone="danger">
                  <span className="font-mono">{t.name}</span>
                  <span> · no longer available</span>
                </Badge>
              ) : (
                <Badge key={t.name} tone={t.approval === "never" ? "neutral" : "warn"}>
                  <span className="font-mono">{t.name}</span>
                  <span className="sr-only"> ({APPROVAL_LABEL[t.approval]})</span>
                  {t.approval !== "never" ? (
                    <span aria-hidden className="text-ink-3">
                      {" "}
                      · approval
                    </span>
                  ) : null}
                </Badge>
              ),
            )
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
            <Button size="sm" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
