import { useId, useState } from "react";
import { CircleAlert, CircleCheck, FolderDown } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldRow,
  Label,
  RadioGroup,
  RadioItem,
  Select,
  SelectItem,
  Spinner,
} from "@/primitives";

/** How the package depends on the FlowAId runtime (CODE_EXPORT.md §1). */
export type ExportMode = "vendored" | "npm";

/** A version the package can be built from; `id: "draft"` is the current draft. */
export interface ExportTargetOption {
  id: string;
  /** "v3", "Current draft" */
  label: string;
  /** "Published 2 days ago · deployed to production" */
  detail?: string;
}

export interface ExportChoice {
  target: string;
  mode: ExportMode;
  /** `inputs/example.json` from the sample run's input */
  includeSample: boolean;
  /** `tests/recorded-run.json` from the sample run, replayed by the package's tests */
  includeRecorded: boolean;
}

export type ExportDialogStatus =
  | { phase: "idle" }
  /** the request is on its way, or the job waits for a worker */
  | { phase: "queued" }
  | { phase: "building" }
  | { phase: "downloading" }
  | { phase: "done"; fileName: string }
  | { phase: "failed"; message: string; problems?: readonly string[] };

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowName: string;
  /** newest first; the first is chosen unless `defaultTarget` names another */
  targets: readonly ExportTargetOption[];
  defaultTarget?: string;
  /**
   * Whether this FlowAId carries the packed runtime packages; without them only npm works, and the
   * self-contained choice says why it is off.
   */
  vendoredAvailable: boolean;
  /** The run a sample input and a recorded run can come from ("the last successful run, 2 h ago"). */
  sampleRun?: { label: string } | null;
  status: ExportDialogStatus;
  onExport: (choice: ExportChoice) => void;
  /** Saves the finished package again (the browser may have blocked the first download). */
  onDownloadAgain?: () => void;
}

const PHASE_TEXT: Record<"queued" | "building" | "downloading", string> = {
  queued: "Waiting for the worker to start the package…",
  building: "Building the package: the workflow as code, its runner, tests and Dockerfile…",
  downloading: "Downloading the zip…",
};

/**
 * Download code (CODE_EXPORT.md §4): choose the version (or the current draft), how the package
 * gets the FlowAId runtime, and whether a past run supplies its sample input and recorded test;
 * then follow the build to the browser download. The app runs the job; this shows its state.
 */
export function ExportDialog({
  open,
  onOpenChange,
  workflowName,
  targets,
  defaultTarget,
  vendoredAvailable,
  sampleRun,
  status,
  onExport,
  onDownloadAgain,
}: ExportDialogProps) {
  // what the person picked; until then (and when the list no longer has it, as while the versions
  // load) the caller's version, and the self-contained runtime wherever it is packed
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedMode, setPickedMode] = useState<ExportMode | null>(null);
  const [includeSample, setIncludeSample] = useState(true);
  const [includeRecorded, setIncludeRecorded] = useState(true);
  const sampleId = useId();
  const recordedId = useId();
  const firstTarget = targets.find((t) => t.id === defaultTarget)?.id ?? targets[0]?.id ?? "";
  const target = picked !== null && targets.some((t) => t.id === picked) ? picked : firstTarget;
  const mode: ExportMode = vendoredAvailable ? (pickedMode ?? "vendored") : "npm";

  // a dialog opened again starts from the caller's version, not the last one chosen
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(null);
  }

  const busy =
    status.phase === "queued" || status.phase === "building" || status.phase === "downloading";
  const done = status.phase === "done";
  const chosen = targets.find((t) => t.id === target);
  const canRun = sampleRun !== null && sampleRun !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Download code</DialogTitle>
          <DialogDescription>
            {workflowName} as a package that runs without FlowAId: the workflow as TypeScript, a
            local runner, an HTTP server, tests and a Dockerfile. Secrets stay out; the package
            lists the names it needs in .env.example.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {status.phase === "failed" ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs"
            >
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-danger-text"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-col gap-1 text-ink-2">
                <span>{status.message}</span>
                {status.problems?.length ? (
                  <ul className="list-disc pl-4">
                    {status.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {done ? (
            <div role="status" className="flex items-start gap-2 text-sm text-ink-2">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-ok-text"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <span>
                  Saved <span className="font-mono text-xs text-ink">{status.fileName}</span>.
                </span>
                <span className="text-xs text-ink-3">
                  Unzip it, then run <span className="font-mono">pnpm install</span> and{" "}
                  <span className="font-mono">pnpm flow -- --input inputs/example.json</span>. Its
                  README explains the runner, the server and the tests.
                </span>
              </div>
            </div>
          ) : busy ? (
            <div className="flex items-center gap-2 text-sm text-ink-2">
              <Spinner size="sm" label="Preparing the package" />
              <span aria-live="polite">{PHASE_TEXT[status.phase]}</span>
            </div>
          ) : (
            <>
              <FieldRow label="Version">
                <Select
                  value={target}
                  onValueChange={setPicked}
                  placeholder="Choose a version"
                  disabled={targets.length === 0}
                >
                  {targets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </Select>
              </FieldRow>
              {chosen?.detail ? <p className="-mt-2 text-xs text-ink-3">{chosen.detail}</p> : null}

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-medium text-ink-2">
                  How it gets the FlowAId runtime
                </legend>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => setPickedMode(v === "npm" ? "npm" : "vendored")}
                >
                  <RadioItem
                    value="vendored"
                    label="Self-contained"
                    disabled={!vendoredAvailable}
                    description={
                      vendoredAvailable
                        ? "Includes the runtime packages, so it installs without the npm registry."
                        : "Not available here: this FlowAId has no packed runtime packages (FLOWAID_VENDOR_DIR)."
                    }
                  />
                  <RadioItem
                    value="npm"
                    label="npm packages"
                    description="Lists the @flowaid packages as dependencies at this FlowAId's version; installing fetches them from the npm registry."
                  />
                </RadioGroup>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-medium text-ink-2">From a past run</legend>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={sampleId}
                    checked={canRun && includeSample}
                    disabled={!canRun}
                    onCheckedChange={(c) => setIncludeSample(c === true)}
                  />
                  <Label htmlFor={sampleId} className="font-normal">
                    Sample input from {sampleRun?.label ?? "a successful run"}
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={recordedId}
                    checked={canRun && includeRecorded}
                    disabled={!canRun}
                    onCheckedChange={(c) => setIncludeRecorded(c === true)}
                  />
                  <Label htmlFor={recordedId} className="font-normal">
                    A recorded run for the package's tests, so they pass without model keys
                  </Label>
                </div>
                {!canRun ? (
                  <p className="text-xs text-ink-3">
                    No successful run yet: the package gets an example input built from the input
                    schema instead.
                  </p>
                ) : (
                  <p className="text-xs text-ink-3">
                    Personal data in the run is replaced by placeholders.
                  </p>
                )}
              </fieldset>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {done ? (
            <>
              {onDownloadAgain ? (
                <Button variant="secondary" onClick={onDownloadAgain}>
                  Download again
                </Button>
              ) : null}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                leadingIcon={<FolderDown strokeWidth={1.75} />}
                loading={busy}
                disabled={!chosen}
                onClick={() =>
                  onExport({
                    target,
                    mode,
                    includeSample: canRun && includeSample,
                    includeRecorded: canRun && includeRecorded,
                  })
                }
              >
                {status.phase === "failed" ? "Try again" : "Download code"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
