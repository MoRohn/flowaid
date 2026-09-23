import { useCallback, useId, useRef, useState, type DragEvent } from "react";
import { CircleAlert, FileJson, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NodeCategory } from "@/lib/categories";
import {
  Badge,
  Button,
  CategoryDot,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@/primitives";

export type ImportNodeStatus = "imported" | "converted" | "needs_config" | "unsupported";

export interface ImportNodeReport {
  id: string;
  /** Node type in the source export, e.g. "chatOpenAI". */
  sourceType: string;
  name: string;
  /** FlowAId node definition it maps to, when it does. */
  targetType?: string;
  category?: NodeCategory;
  status: ImportNodeStatus;
  /** What happened or what still needs doing. */
  message?: string;
}

export interface ImportMigrationReport {
  fileName: string;
  workflowName: string;
  counts: { imported: number; converted: number; needsConfig: number; unsupported: number };
  nodes: ImportNodeReport[];
}

export type ImportDialogStatus = "idle" | "reading" | "analysing" | "ready" | "importing" | "error";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ImportMigrationReport | null;
  status: ImportDialogStatus;
  error?: string;
  /** Receives the file's text once read; the app parses and analyses it. */
  onFile: (text: string, fileName: string) => void;
  onImport: (report: ImportMigrationReport) => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<ImportNodeStatus, string> = {
  imported: "imported",
  converted: "converted",
  needs_config: "needs config",
  unsupported: "unsupported",
};
const STATUS_TONE: Record<ImportNodeStatus, "ok" | "accent" | "warn" | "danger"> = {
  imported: "ok",
  converted: "accent",
  needs_config: "warn",
  unsupported: "danger",
};

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "accent" | "warn" | "danger";
}) {
  const text = {
    ok: "text-ok-text",
    accent: "text-accent-text",
    warn: "text-warn-text",
    danger: "text-danger-text",
  }[tone];
  return (
    <div className="flex flex-col gap-0.5 bg-surface px-3 py-2">
      <span className="text-2xs font-medium text-ink-3">{label}</span>
      <span
        className={cn("font-mono text-lg font-semibold tabular", value === 0 ? "text-ink-3" : text)}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Import a flow exported from an external flow builder. Step one is a drop zone that reads the
 * .json with FileReader and hands the text to the app; step two shows the
 * migration report (count tiles and a per-node table) before importing.
 */
export function ImportDialog({
  open,
  onOpenChange,
  report,
  status,
  error,
  onFile,
  onImport,
  onCancel,
}: ImportDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();

  const readFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") {
        setLocalError(`${file.name} is not a .json export. Export the flow as JSON first.`);
        return;
      }
      setLocalError(undefined);
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        onFile(text, file.name);
      };
      reader.onerror = () =>
        setLocalError(`${file.name} could not be read. Check the file and try again.`);
      reader.readAsText(file);
    },
    [onFile],
  );

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files[0]);
  };

  const busy = status === "reading" || status === "analysing";
  const message = error ?? localError;
  const showReport = report !== null && (status === "ready" || status === "importing");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import a flow</DialogTitle>
          <DialogDescription>
            Chat models become generation nodes, condition nodes become TypeSafe decisions, tools
            keep their credentials as placeholders.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {message ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs"
            >
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-danger-text"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="text-ink-2">{message}</span>
            </div>
          ) : null}

          {!showReport ? (
            <label
              htmlFor={inputId}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              data-dragging={dragging || undefined}
              className={cn(
                "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center",
                "transition-[border-color,background-color] duration-(--dur-fast) ease-(--ease-out)",
                dragging
                  ? "border-accent bg-accent-soft"
                  : "border-border-strong bg-surface-2 hover:border-ink-4",
                busy && "pointer-events-none opacity-70",
              )}
            >
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(e) => {
                  readFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <span className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-ink-3 shadow-1">
                {busy ? (
                  <Spinner
                    size="sm"
                    label={status === "reading" ? "Reading file" : "Analysing chatflow"}
                  />
                ) : (
                  <Upload className="size-4" strokeWidth={1.75} aria-hidden="true" />
                )}
              </span>
              <span className="text-sm font-medium text-ink">
                {status === "reading"
                  ? "Reading file"
                  : status === "analysing"
                    ? "Analysing chatflow"
                    : "Drop a flow export here"}
              </span>
              <span className="text-xs text-ink-3">
                {busy
                  ? "This takes a moment for large chatflows."
                  : "or click to choose a .json file"}
              </span>
            </label>
          ) : null}

          {showReport && report ? (
            <>
              <div className="flex items-center gap-2 text-xs">
                <FileJson className="size-4 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
                <span className="font-medium text-ink">{report.workflowName}</span>
                <span className="font-mono text-2xs text-ink-3">{report.fileName}</span>
                <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
                  {report.nodes.length} nodes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
                <Tile label="Imported as-is" value={report.counts.imported} tone="ok" />
                <Tile
                  label="Converted automatically"
                  value={report.counts.converted}
                  tone="accent"
                />
                <Tile label="Need configuration" value={report.counts.needsConfig} tone="warn" />
                <Tile label="Unsupported" value={report.counts.unsupported} tone="danger" />
              </div>
              <div className="contain-inline-size overflow-x-auto rounded-md border border-border">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="h-7 border-b border-border bg-surface-2 text-left text-2xs font-medium text-ink-3">
                      <th scope="col" className="pl-3 font-medium">
                        Node
                      </th>
                      <th scope="col" className="hidden pr-3 font-medium sm:table-cell">
                        Becomes
                      </th>
                      <th scope="col" className="pr-3 font-medium">
                        Status
                      </th>
                      <th scope="col" className="hidden pr-3 font-medium md:table-cell">
                        Message
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.nodes.map((n) => (
                      <tr key={n.id} data-status={n.status} className="align-top">
                        <td className="py-1.5 pl-3 pr-3">
                          <div className="flex flex-col">
                            <span className="text-ink">{n.name}</span>
                            <span className="font-mono text-2xs text-ink-3">{n.sourceType}</span>
                          </div>
                        </td>
                        <td className="hidden py-1.5 pr-3 sm:table-cell">
                          {n.targetType ? (
                            <span className="inline-flex items-center gap-1.5 font-mono text-2xs text-ink-2">
                              {n.category ? <CategoryDot category={n.category} size={6} /> : null}
                              {n.targetType}
                            </span>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <Badge tone={STATUS_TONE[n.status]} size="sm" dot>
                            {STATUS_LABEL[n.status]}
                          </Badge>
                        </td>
                        <td className="hidden max-w-72 py-1.5 pr-3 text-2xs leading-normal text-ink-2 md:table-cell">
                          {n.message ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {showReport && report && report.counts.unsupported > 0 ? (
            <span className="mr-auto text-2xs text-ink-3">
              {report.counts.unsupported} unsupported{" "}
              {report.counts.unsupported === 1 ? "node is" : "nodes are"} skipped on import.
            </span>
          ) : null}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!showReport || !report}
            loading={status === "importing"}
            onClick={() => {
              if (report) onImport(report);
            }}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
