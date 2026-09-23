import { useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Braces,
  Check,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  FileJson,
  Filter,
  GitBranch,
  History,
  Inbox,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { NODE_CATEGORIES, RUN_STATUSES, NODE_RUN_STATUSES } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { formatCost, formatMs, formatProbability } from "@/lib/format";
import {
  Accordion,
  AccordionItem,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CategoryDot,
  Checkbox,
  Collapsible,
  ConfirmDialog,
  CopyButton,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  FieldRow,
  IconButton,
  Input,
  Kbd,
  Label,
  LogoMark,
  LogoWordmark,
  NumberInput,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressBar,
  RadioGroup,
  RadioItem,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  SearchInput,
  Select,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  Separator,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Shortcut,
  Skeleton,
  Slider,
  Spinner,
  StatusChip,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toaster,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipProvider,
  toast,
} from "./index";

// ---------------------------------------------------------------------------
// Gallery scaffolding
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <p className="text-2xs font-medium text-ink-3">{label}</p> : null}
      <div className={cn("flex flex-wrap items-center gap-3", className)}>{children}</div>
    </div>
  );
}

function Swatch({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border border-border bg-surface p-4 shadow-1", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sample data: support-triage workflow
// ---------------------------------------------------------------------------

const INTENT_DISTRIBUTION: Array<{ key: string; label: string; p: number }> = [
  { key: "billing", label: "Billing", p: 0.81 },
  { key: "technical", label: "Technical", p: 0.12 },
  { key: "account", label: "Account", p: 0.04 },
  { key: "other", label: "Other", p: 0.03 },
];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function BrandSection() {
  return (
    <Section
      id="brand"
      title="Brand"
      caption="LogoMark takes currentColor; the accent dot marks the chosen branch. LogoWordmark scales by height and keeps the file's viewBox."
    >
      <Row>
        <Swatch className="flex items-center gap-6">
          <LogoMark size={16} />
          <LogoMark size={24} />
          <LogoMark size={32} />
          <LogoMark size={48} />
          <LogoMark size={32} accent={false} className="text-ink-3" />
        </Swatch>
        <Swatch className="flex items-center gap-8">
          <LogoWordmark height={14} />
          <LogoWordmark height={20} />
          <LogoWordmark height={28} accent={false} className="text-ink-3" />
        </Swatch>
        <Swatch className="flex items-center gap-2 bg-ink text-surface">
          <LogoMark size={20} />
          <LogoWordmark height={16} />
        </Swatch>
      </Row>
    </Section>
  );
}

function ButtonsSection() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      caption="Primary is accent-filled and the only filled button on a screen. Secondary is the default raised control. Ghost and danger stay quiet until hovered."
    >
      <Row label="Variants">
        <Button variant="primary">Publish</Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Delete workflow</Button>
        <Button variant="link">View trace</Button>
      </Row>
      <Row label="Sizes">
        <Button size="sm" variant="primary">
          Run
        </Button>
        <Button size="md" variant="primary">
          Run
        </Button>
        <Button size="lg" variant="primary">
          Run
        </Button>
        <Button size="sm">Secondary</Button>
        <Button size="md">Secondary</Button>
        <Button size="lg">Secondary</Button>
      </Row>
      <Row label="Icons, loading, disabled">
        <Button variant="primary" leadingIcon={<Play />}>
          Run with test input
        </Button>
        <Button trailingIcon={<ChevronDown />}>Environment</Button>
        <Button leadingIcon={<Download />} trailingIcon={<Kbd>⌘E</Kbd>}>
          Export
        </Button>
        <Button variant="primary" loading>
          Publishing
        </Button>
        <Button loading>Saving</Button>
        <Button variant="primary" disabled>
          Publish
        </Button>
        <Button disabled>Save draft</Button>
        <Button variant="ghost" disabled>
          Cancel
        </Button>
        <Button asChild variant="link">
          <a href="#buttons">Anchor as button</a>
        </Button>
      </Row>
      <Row label="IconButton (label required; tooltip on hover)">
        <TooltipProvider>
          <IconButton label="Settings">
            <Settings />
          </IconButton>
          <IconButton label="Run" variant="primary" shortcut="mod+enter">
            <Play />
          </IconButton>
          <IconButton label="Edit" variant="secondary">
            <Pencil />
          </IconButton>
          <IconButton label="Delete" variant="danger">
            <Trash2 />
          </IconButton>
          <IconButton label="More" size="sm">
            <Ellipsis />
          </IconButton>
          <IconButton label="Refresh" size="lg" variant="secondary">
            <RefreshCw />
          </IconButton>
          <IconButton label="Syncing" loading>
            <RefreshCw />
          </IconButton>
          <IconButton label="Notifications" disabled>
            <Bell />
          </IconButton>
        </TooltipProvider>
      </Row>
    </Section>
  );
}

function KeyboardSection() {
  return (
    <Section
      id="keyboard"
      title="Keyboard"
      caption='Kbd is a single cap. Shortcut renders "⌘K" from "mod+k" on macOS and "Ctrl+K" elsewhere.'
    >
      <Row>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
        <Kbd>Esc</Kbd>
        <Kbd size="sm">↵</Kbd>
        <Separator orientation="vertical" className="h-4" />
        <Shortcut shortcut="mod+k" />
        <Shortcut shortcut="mod+shift+p" />
        <Shortcut shortcut="shift+enter" separate />
        <Shortcut shortcut="mod+k" platform="other" />
        <Shortcut shortcut="ctrl+alt+delete" platform="other" separate />
        <Shortcut shortcut="esc" />
        <span className="text-xs text-ink-2">
          Press <Shortcut shortcut="mod+k" /> to open the palette
        </span>
      </Row>
    </Section>
  );
}

function InputsSection() {
  const [bio, setBio] = useState(
    "Classify the customer's message into one of the support intents. Prefer Billing when the message mentions an invoice, charge or refund.",
  );
  const [search, setSearch] = useState("");
  const [threshold, setThreshold] = useState<number | null>(0.9);
  return (
    <Section
      id="inputs"
      title="Text inputs"
      caption="28px controls, 5px radius, 1px border. The accent border joins the focus ring on focus. Mono variants for identifiers and numbers."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FieldRow label="Node name" hint="Shown on the canvas and in the trace.">
          <Input defaultValue="Intent" />
        </FieldRow>
        <FieldRow label="Placeholder">
          <Input placeholder="e.g. Classify intent" />
        </FieldRow>
        <FieldRow label="With leading and trailing slots">
          <Input
            leading={<Search />}
            placeholder="Filter nodes"
            trailing={<Shortcut shortcut="mod+f" />}
          />
        </FieldRow>
        <FieldRow label="Mono (identifier)">
          <Input mono defaultValue="run_01j8x2k9v3" />
        </FieldRow>
        <FieldRow label="Invalid" error="Name must be unique within the workflow.">
          <Input defaultValue="Intent" />
        </FieldRow>
        <FieldRow label="Disabled" disabled>
          <Input defaultValue="jev-latest" />
        </FieldRow>
        <FieldRow label="Read only">
          <Input readOnly defaultValue="wf_support_triage" mono />
        </FieldRow>
        <FieldRow label="Small">
          <Input size="sm" placeholder="Small, 24px" />
        </FieldRow>
        <FieldRow label="Large">
          <Input size="lg" placeholder="Large, 32px" />
        </FieldRow>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FieldRow label="Textarea (auto-grow)" hint={`${bio.length} characters`}>
          <Textarea
            autoGrow
            minRows={2}
            maxRows={6}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Textarea (fixed, mono)">
          <Textarea
            mono
            rows={3}
            defaultValue={'{\n  "ticketId": "4821",\n  "channel": "email"\n}'}
          />
        </FieldRow>
        <FieldRow label="Textarea (invalid)" error="Question is required for a choice decision.">
          <Textarea rows={2} placeholder="What is this message about?" />
        </FieldRow>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FieldRow label="NumberInput" hint="Arrow keys step; Shift ×10.">
          <NumberInput defaultValue={3} min={0} max={10} step={1} />
        </FieldRow>
        <FieldRow
          label="Auto threshold"
          hint={`Current: ${threshold === null ? "—" : formatProbability(threshold)}`}
        >
          <NumberInput value={threshold} onValueChange={setThreshold} min={0} max={1} step={0.05} />
        </FieldRow>
        <FieldRow label="With unit">
          <NumberInput defaultValue={30000} min={1000} step={1000} unit="ms" />
        </FieldRow>
        <FieldRow label="Budget (no stepper)">
          <NumberInput
            defaultValue={0.25}
            min={0}
            step={0.01}
            precision={2}
            unit="USD"
            hideStepper
          />
        </FieldRow>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FieldRow label="SearchInput" hint="Escape clears. Shortcut hint disappears on focus.">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            shortcut="mod+k"
            placeholder="Search runs"
          />
        </FieldRow>
        <FieldRow label="With value">
          <SearchInput defaultValue="status:failed node:Intent" />
        </FieldRow>
        <FieldRow label="Loading, small">
          <SearchInput size="sm" loading defaultValue="billing" />
        </FieldRow>
      </div>
    </Section>
  );
}

function SelectionSection() {
  const [model, setModel] = useState("jev-latest");
  const [range, setRange] = useState([0.55, 0.9]);
  const [env, setEnv] = useState("staging");
  const [view, setView] = useState("graph");
  return (
    <Section
      id="selection"
      title="Selection controls"
      caption="Select, Switch, Checkbox, RadioGroup, ToggleGroup and Slider share the same heights, borders and accent-on-checked treatment."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FieldRow label="Select with groups and descriptions" hint={`Selected: ${model}`}>
          <Select value={model} onValueChange={setModel} mono leading={<Sparkles />}>
            <SelectGroup label="Decision models">
              <SelectItem
                value="jev-latest"
                description="TypeSafe · calibrated probabilities"
                meta="$0.40/M"
              >
                jev-latest
              </SelectItem>
              <SelectItem
                value="jev-mini"
                description="TypeSafe · faster, lower cost"
                meta="$0.10/M"
              >
                jev-mini
              </SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup label="Generative">
              <SelectItem value="gpt-5-mini" description="OpenAI · 400k context" meta="$0.25/M">
                gpt-5-mini
              </SelectItem>
              <SelectItem
                value="claude-sonnet-4-5"
                description="Anthropic · 200k context"
                meta="$3.00/M"
              >
                claude-sonnet-4-5
              </SelectItem>
              <SelectItem value="llama-3.3-70b" description="Local · Ollama" meta="local" disabled>
                llama-3.3-70b
              </SelectItem>
            </SelectGroup>
          </Select>
        </FieldRow>
        <FieldRow label="Select (placeholder, invalid)" error="Choose a credential.">
          <Select placeholder="Choose a credential">
            <SelectItem value="zendesk-prod">Zendesk · production</SelectItem>
            <SelectItem value="zendesk-staging">Zendesk · staging</SelectItem>
          </Select>
        </FieldRow>
        <FieldRow label="Select (small, disabled)" disabled>
          <Select size="sm" defaultValue="production">
            <SelectItem value="production">Production</SelectItem>
          </Select>
        </FieldRow>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">Switch</p>
          <div className="flex items-center gap-3">
            <Switch defaultChecked aria-label="Enabled" />
            <Switch aria-label="Disabled off" />
            <Switch size="sm" defaultChecked aria-label="Small on" />
            <Switch disabled defaultChecked aria-label="Disabled on" />
            <Switch disabled aria-label="Disabled off" />
          </div>
          <FieldRow layout="row" align="center" label="Streaming" labelWidth={88}>
            <Switch defaultChecked />
          </FieldRow>
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">Checkbox</p>
          <Checkbox
            label="Retry on provider error"
            description="Up to 3 attempts with exponential backoff."
            defaultChecked
          />
          <Checkbox label="Log full prompt" />
          <Checkbox label="Select all nodes" checked="indeterminate" />
          <Checkbox label="Archived" disabled defaultChecked />
          <div className="flex items-center gap-2">
            <Checkbox size="sm" aria-label="Small" defaultChecked />
            <Checkbox size="sm" aria-label="Small unchecked" />
          </div>
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">RadioGroup</p>
          <RadioGroup value={env} onValueChange={setEnv}>
            <RadioItem
              value="development"
              label="Development"
              description="Never charged; mocks enabled."
            />
            <RadioItem value="staging" label="Staging" meta="v6" />
            <RadioItem value="production" label="Production" meta="v5" />
            <RadioItem value="archived" label="Archived" disabled />
          </RadioGroup>
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">ToggleGroup</p>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v)}
            aria-label="View"
          >
            <ToggleGroupItem value="graph">
              <Workflow />
              Graph
            </ToggleGroupItem>
            <ToggleGroupItem value="trace">
              <Activity />
              Trace
            </ToggleGroupItem>
            <ToggleGroupItem value="json">
              <Braces />
              JSON
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="multiple"
            size="sm"
            defaultValue={["error", "warn"]}
            aria-label="Log levels"
          >
            <ToggleGroupItem value="debug">Debug</ToggleGroupItem>
            <ToggleGroupItem value="info">Info</ToggleGroupItem>
            <ToggleGroupItem value="warn">Warn</ToggleGroupItem>
            <ToggleGroupItem value="error">Error</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" defaultValue="1h" fullWidth aria-label="Range" disabled>
            <ToggleGroupItem value="1h">1h</ToggleGroupItem>
            <ToggleGroupItem value="24h">24h</ToggleGroupItem>
            <ToggleGroupItem value="7d">7d</ToggleGroupItem>
          </ToggleGroup>
        </Swatch>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FieldRow
          label="Slider (single)"
          hint="Auto threshold: run without review at or above this confidence."
        >
          <Slider
            defaultValue={[0.9]}
            min={0}
            max={1}
            step={0.01}
            showValue
            formatValue={(v) => formatProbability(v)}
            marks={[0.5, 0.75]}
          />
        </FieldRow>
        <FieldRow
          label="Slider (range)"
          hint={`Secondary review between ${formatProbability(range[0] ?? 0)} and ${formatProbability(range[1] ?? 1)}.`}
        >
          <Slider
            value={range}
            onValueChange={setRange}
            min={0}
            max={1}
            step={0.01}
            showValue
            formatValue={(v) => formatProbability(v)}
          />
        </FieldRow>
        <FieldRow label="Slider (disabled, invalid)">
          <div className="flex flex-col gap-3">
            <Slider defaultValue={[35]} showValue disabled />
            <Slider defaultValue={[70]} showValue invalid />
          </div>
        </FieldRow>
      </div>
    </Section>
  );
}

function FieldsSection() {
  return (
    <Section
      id="fields"
      title="Fields"
      caption="FieldRow wires id, aria-describedby and aria-invalid into any primitive control. Row layout collapses to stacked below 320px."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Swatch className="flex flex-col gap-4">
          <p className="text-2xs font-medium text-ink-3">Stacked</p>
          <FieldRow label="Question" required hint="Shown to the decision model verbatim.">
            <Textarea rows={2} defaultValue="What is this message about?" />
          </FieldRow>
          <FieldRow label="Provider" optional>
            <Select defaultValue="jev">
              <SelectItem value="jev">Jev (TypeSafe)</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </Select>
          </FieldRow>
          <FieldRow
            label="Max cost per run"
            error="Must be at least $0.01."
            labelAddon={
              <Badge tone="accent" size="sm">
                beta
              </Badge>
            }
          >
            <NumberInput defaultValue={0} min={0.01} step={0.01} unit="USD" />
          </FieldRow>
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">Row (2-col)</p>
          <FieldRow layout="row" label="Name" align="center">
            <Input defaultValue="Urgency" />
          </FieldRow>
          <FieldRow layout="row" label="Kind" align="center">
            <Input mono readOnly defaultValue="decision.score" />
          </FieldRow>
          <FieldRow layout="row" label="Levels" hint="1 = low, 5 = page the on-call.">
            <NumberInput defaultValue={5} min={2} max={10} />
          </FieldRow>
          <FieldRow
            layout="row"
            label="Timeout"
            align="center"
            error="Exceeds the workflow limit of 60 s."
          >
            <NumberInput defaultValue={90000} step={1000} unit="ms" />
          </FieldRow>
          <FieldRow layout="row" label="Enabled" align="center">
            <Switch defaultChecked />
          </FieldRow>
          <div className="mt-2 flex items-center gap-3">
            <Label>Standalone label</Label>
            <Label required>Required</Label>
            <Label optional>Optional</Label>
            <Label disabled>Disabled</Label>
          </div>
        </Swatch>
      </div>
    </Section>
  );
}

function OverlaysSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [showCost, setShowCost] = useState(false);
  const [density, setDensity] = useState("comfortable");

  return (
    <Section
      id="overlays"
      title="Overlays"
      caption="Tooltip (200ms), Popover, DropdownMenu, Dialog, Sheet and ConfirmDialog (the command menu lives in the shell group). Every surface animates in with the base duration and out with the fast one."
    >
      <Row label="Tooltip">
        <TooltipProvider>
          <Tooltip content="Run with the last test input">
            <Button leadingIcon={<Play />}>Run</Button>
          </Tooltip>
          <Tooltip content="Open command palette" shortcut="mod+k">
            <Button variant="ghost">With shortcut</Button>
          </Tooltip>
          <Tooltip content="Placed to the right" side="right">
            <Button variant="ghost">Right</Button>
          </Tooltip>
          <Tooltip content="Below, aligned to the start" side="bottom" align="start">
            <Button variant="ghost">Bottom</Button>
          </Tooltip>
        </TooltipProvider>
      </Row>

      <Row label="Popover, DropdownMenu">
        <Popover>
          <PopoverTrigger asChild>
            <Button leadingIcon={<Filter />} trailingIcon={<ChevronDown />}>
              Filters
            </Button>
          </PopoverTrigger>
          <PopoverContent width={288}>
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium text-ink">Filter runs</p>
              <FieldRow label="Status">
                <Select defaultValue="failed" size="sm">
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="waiting_for_human">Waiting for approval</SelectItem>
                </Select>
              </FieldRow>
              <FieldRow label="Min confidence">
                <Slider
                  defaultValue={[0.5]}
                  min={0}
                  max={1}
                  step={0.05}
                  showValue
                  formatValue={(v) => formatProbability(v)}
                />
              </FieldRow>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost">
                  Reset
                </Button>
                <Button size="sm" variant="primary">
                  Apply
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button trailingIcon={<ChevronDown />}>Node actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>Intent · decision.choice</DropdownMenuLabel>
            <DropdownMenuItem icon={<Play />} shortcut="mod+enter">
              Run from here
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Pencil />} shortcut="enter">
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy />} shortcut="mod+d">
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<Bot />}>Change model</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value="jev-latest">
                  <DropdownMenuRadioItem value="jev-latest">jev-latest</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="jev-mini">jev-mini</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showLogs}
              onCheckedChange={setShowLogs}
              shortcut="mod+l"
            >
              Logs
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showCost} onCheckedChange={setShowCost}>
              Cost
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
              <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} destructive shortcut="backspace">
              Delete node
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More" tooltip={false}>
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<FileJson />} description="Download the run as JSON">
              Export run
            </DropdownMenuItem>
            <DropdownMenuItem icon={<History />} description="Re-run with the same input">
              Replay
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>

      <Row label="Dialog, Sheet, ConfirmDialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="primary" leadingIcon={<Rocket />}>
              Publish version
            </Button>
          </DialogTrigger>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>Publish version 7 to production</DialogTitle>
              <DialogDescription>
                Replaces version 5. Runs in flight finish on the old version.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FieldRow label="Release note" hint="Shown in the version history.">
                <Textarea
                  autoGrow
                  minRows={2}
                  defaultValue="Raise the auto threshold for Intent to 0.90 after last week's misroutes."
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-2 p-3 text-xs">
                <div>
                  <p className="text-ink-3">Evaluation</p>
                  <p className="mt-0.5 font-medium text-ink">
                    142 / 148 passed <span className="font-mono text-ok-text">+2.1%</span>
                  </p>
                </div>
                <div>
                  <p className="text-ink-3">Cost per run</p>
                  <p className="mt-0.5 font-mono font-medium text-ink">
                    {formatCost(0.0031)}{" "}
                    <span className="text-ink-3">(was {formatCost(0.0034)})</span>
                  </p>
                </div>
              </div>
              <Checkbox label="Notify the on-call channel" defaultChecked />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button variant="primary">Publish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button leadingIcon={<Inbox />}>Open run</Button>
          </SheetTrigger>
          <SheetContent width={440}>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle className="font-mono">run_01j8x2k9v3</SheetTitle>
                <StatusChip status="waiting_for_human" size="sm" />
              </div>
              <SheetDescription>
                Support triage · v6 · production · triggered by webhook 4 min ago
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-ink-3">Duration</p>
                  <p className="mt-0.5 font-mono text-ink">{formatMs(4210)}</p>
                </div>
                <div>
                  <p className="text-ink-3">Cost</p>
                  <p className="mt-0.5 font-mono text-ink">{formatCost(0.0031)}</p>
                </div>
                <div>
                  <p className="text-ink-3">Tokens</p>
                  <p className="mt-0.5 font-mono text-ink">2.4k / 610</p>
                </div>
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <p className="text-eyebrow">Intent · decision.choice</p>
                {INTENT_DISTRIBUTION.map((d) => (
                  <div key={d.key} className="flex items-center gap-3 text-xs">
                    <span className="w-16 text-ink-2">{d.label}</span>
                    <ProgressBar
                      value={d.p}
                      tone={d.key === "billing" ? "accent" : "neutral"}
                      className="flex-1"
                    />
                    <span className="w-10 text-right font-mono text-ink-2">
                      {formatProbability(d.p)}
                    </span>
                  </div>
                ))}
              </div>
            </SheetBody>
            <SheetFooter>
              <Button variant="ghost">Reject</Button>
              <Button variant="primary">Approve reply</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Button onClick={() => setConfirmOpen(true)}>Confirm (default)</Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Replay 12 failed runs?"
          description="Each replay uses the current production version and is billed normally."
          confirmLabel="Replay 12 runs"
          onConfirm={() => new Promise<void>((resolve) => setTimeout(resolve, 900))}
        />
        <Button variant="danger" onClick={() => setDangerOpen(true)}>
          Confirm (danger)
        </Button>
        <ConfirmDialog
          open={dangerOpen}
          onOpenChange={setDangerOpen}
          variant="danger"
          title="Delete “Support triage”?"
          description="All 8 versions and 1,204 runs are removed. This cannot be undone."
          confirmLabel="Delete workflow"
          onConfirm={() => setDangerOpen(false)}
        />
      </Row>
    </Section>
  );
}

function NavigationSection() {
  return (
    <Section
      id="navigation"
      title="Navigation and layout"
      caption="Tabs with a sliding underline and counts, Separator, ScrollArea with thin overlay scrollbars, Card, Panel, Collapsible, Accordion and Resizable."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Swatch className="flex flex-col gap-4">
          <Tabs defaultValue="trace">
            <TabsList>
              <TabsTrigger value="trace" icon={<Activity />}>
                Trace
              </TabsTrigger>
              <TabsTrigger value="input" count={3}>
                Input
              </TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
              <TabsTrigger value="logs" count={128}>
                Logs
              </TabsTrigger>
              <TabsTrigger
                value="issues"
                badge={
                  <Badge tone="danger" size="sm" mono>
                    2
                  </Badge>
                }
              >
                Issues
              </TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Metrics
              </TabsTrigger>
            </TabsList>
            <TabsContent value="trace" className="pt-3 text-xs text-ink-2">
              9 node runs · {formatMs(4210)} · {formatCost(0.0031)}
            </TabsContent>
            <TabsContent value="input" className="pt-3 text-xs text-ink-2">
              ticketId, channel, message
            </TabsContent>
            <TabsContent value="output" className="pt-3 text-xs text-ink-2">
              Awaiting approval.
            </TabsContent>
            <TabsContent value="logs" className="pt-3 text-xs text-ink-2">
              128 lines, 2 warnings.
            </TabsContent>
            <TabsContent value="issues" className="pt-3 text-xs text-ink-2">
              Confidence 0.71 below auto threshold 0.90 · Provider failover to jev-mini.
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="a" size="sm">
            <TabsList>
              <TabsTrigger value="a">Small</TabsTrigger>
              <TabsTrigger value="b" count={12}>
                Tabs
              </TabsTrigger>
              <TabsTrigger value="c">Variant</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-3">
            <Separator />
            <Separator label="Earlier today" />
            <div className="flex h-5 items-center gap-3 text-xs text-ink-2">
              <span>Left</span>
              <Separator orientation="vertical" />
              <span>Right</span>
            </div>
          </div>
        </Swatch>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Support triage</CardTitle>
                <CardDescription>9 nodes · v6 in production</CardDescription>
              </div>
              <StatusChip status="running" size="sm" />
            </CardHeader>
            <CardBody className="flex flex-col gap-2 text-xs text-ink-2">
              <div className="flex justify-between">
                <span>Runs today</span>
                <span className="font-mono text-ink">1,204</span>
              </div>
              <div className="flex justify-between">
                <span>Auto-resolved</span>
                <span className="font-mono text-ink">86%</span>
              </div>
              <div className="flex justify-between">
                <span>p50 latency</span>
                <span className="font-mono text-ink">{formatMs(3820)}</span>
              </div>
            </CardBody>
            <CardFooter>
              <span className="text-2xs text-ink-3">Updated 2 min ago</span>
              <Button size="sm" variant="ghost" trailingIcon={<ArrowRight />}>
                Open
              </Button>
            </CardFooter>
          </Card>
          <div className="flex flex-col gap-3">
            <Card interactive className="p-3">
              <p className="text-sm font-medium">Interactive card</p>
              <p className="text-xs text-ink-3">Hover raises it to shadow-2.</p>
            </Card>
            <Card selected className="p-3">
              <p className="text-sm font-medium">Selected card</p>
              <p className="text-xs text-ink-3">Accent border with a soft ring.</p>
            </Card>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Trace"
          meta="9 spans"
          icon={<Activity />}
          toolbar={
            <TooltipProvider>
              <IconButton label="Filter" size="sm">
                <Filter />
              </IconButton>
              <IconButton label="Refresh" size="sm">
                <RefreshCw />
              </IconButton>
              <CopyButton value="run_01j8x2k9v3" size="sm" label="Copy run id" />
            </TooltipProvider>
          }
          footer={<span className="font-mono text-2xs text-ink-3">last event 00:04.21</span>}
          padded={false}
          className="h-64"
        >
          <ScrollArea className="h-full">
            <ul className="divide-y divide-border">
              {[
                ["Start", "flow", "0 ms", "completed"],
                ["Intent", "decision", "412 ms", "completed"],
                ["Urgency", "decision", "388 ms", "completed"],
                ["Escalation", "decision", "301 ms", "completed"],
                ["Router", "flow", "2 ms", "completed"],
                ["Lookup account", "tool", "1.2 s", "completed"],
                ["Draft reply", "generation", "1.9 s", "completed"],
                ["Safety", "safety", "212 ms", "completed"],
                ["Confidence gate", "flow", "1 ms", "completed"],
                ["Approval", "human", "—", "waiting_for_human"],
              ].map(([name, cat, dur, status]) => (
                <li key={name} className="flex h-[30px] items-center gap-3 px-3 text-xs">
                  <CategoryDot
                    category={
                      cat === "decision"
                        ? "decision"
                        : cat === "tool"
                          ? "tool"
                          : cat === "generation"
                            ? "generation"
                            : cat === "safety"
                              ? "safety"
                              : cat === "human"
                                ? "human"
                                : "flow"
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
                  <StatusChip
                    status={status === "waiting_for_human" ? "waiting_for_human" : "completed"}
                    compact
                  />
                  <span className="w-14 text-right font-mono text-ink-3">{dur}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </Panel>

        <Swatch className="flex flex-col gap-4">
          <div className="flex flex-col">
            <Collapsible title="Advanced" meta="4 settings" defaultOpen>
              <div className="flex flex-col gap-3 pt-1">
                <FieldRow layout="row" label="Temperature" align="center" labelWidth={96}>
                  <NumberInput defaultValue={0.2} min={0} max={2} step={0.1} />
                </FieldRow>
                <FieldRow layout="row" label="Seed" align="center" labelWidth={96}>
                  <Input mono placeholder="random" />
                </FieldRow>
              </div>
            </Collapsible>
            <Collapsible title="Retries and timeouts" meta="defaults">
              <p className="pt-1 text-xs text-ink-3">
                3 attempts, 30 s timeout, exponential backoff.
              </p>
            </Collapsible>
          </div>
          <Accordion type="single" collapsible defaultValue="input" bordered>
            <AccordionItem value="input" title="Input" meta="3 fields" icon={<Braces />}>
              ticketId, channel, message
            </AccordionItem>
            <AccordionItem value="decision" title="Decision" meta="0.81" icon={<GitBranch />}>
              Billing chosen over Technical (0.12), Account (0.04), Other (0.03).
            </AccordionItem>
            <AccordionItem value="output" title="Output" icon={<FileJson />}>
              Awaiting approval.
            </AccordionItem>
          </Accordion>
        </Swatch>
      </div>

      <div className="h-56 overflow-hidden rounded-md border border-border bg-surface shadow-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="22%" minSize="12%">
            <Panel flush title="Nodes" padded className="h-full">
              <ul className="flex flex-col gap-1 text-xs">
                {NODE_CATEGORIES.slice(0, 6).map((c) => (
                  <li key={c}>
                    <CategoryDot category={c} withLabel />
                  </li>
                ))}
              </ul>
            </Panel>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize="30%">
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize="60%">
                <div className="canvas-grid flex h-full items-center justify-center text-xs text-ink-3">
                  Canvas
                </div>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize="40%" minSize="20%">
                <Panel flush title="Run" meta="run_01j8x2" padded className="h-full">
                  <p className="text-xs text-ink-3">
                    Drag the 1px handles. They widen on hover and show a grip.
                  </p>
                </Panel>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="26%" minSize="16%">
            <Panel flush title="Inspector" padded className="h-full">
              <p className="text-xs text-ink-3">Select a node.</p>
            </Panel>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Section>
  );
}

function FeedbackSection() {
  return (
    <Section
      id="feedback"
      title="Feedback"
      caption="Skeleton, Spinner, ProgressBar, EmptyState, CopyButton and toasts. Loading states never lie: an indeterminate bar means the total is unknown."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">Skeleton</p>
          <div className="flex items-center gap-3">
            <Skeleton variant="circle" width={24} height={24} />
            <Skeleton lines={2} className="flex-1" />
          </div>
          <Skeleton height={28} />
          <Skeleton lines={3} />
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">Spinner</p>
          <div className="flex items-center gap-4">
            <Spinner size="xs" />
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
            <Spinner className="text-accent" />
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <Spinner size="sm" /> Running Intent…
            </span>
          </div>
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">ProgressBar</p>
          <ProgressBar value={0.62} showValue />
          <ProgressBar value={0.93} tone="ok" showValue />
          <ProgressBar value={0.35} tone="warn" size="md" showValue />
          <ProgressBar value={1} tone="danger" showValue />
          <ProgressBar label="Evaluating" />
        </Swatch>
        <Swatch className="flex flex-col gap-3">
          <p className="text-2xs font-medium text-ink-3">CopyButton</p>
          <div className="flex flex-wrap items-center gap-3">
            <TooltipProvider>
              <CopyButton value="run_01j8x2k9v3" />
              <CopyButton value="run_01j8x2k9v3" variant="secondary" />
              <CopyButton
                value={() => JSON.stringify({ ticketId: "4821" })}
                variantStyle="button"
              />
            </TooltipProvider>
            <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-2">
              run_01j8x2k9v3
            </code>
          </div>
          <p className="text-2xs font-medium text-ink-3">Toasts</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                toast.success("Version 7 published", { description: "Production now serves v7." })
              }
            >
              Success
            </Button>
            <Button
              size="sm"
              onClick={() =>
                toast.error("Intent failed", {
                  description: "jev-latest timed out after 30 s. Retry or lower the timeout.",
                })
              }
            >
              Error
            </Button>
            <Button
              size="sm"
              onClick={() =>
                toast.info("Replay queued", {
                  description: "12 runs, roughly 40 s.",
                  action: { label: "View", onClick: () => undefined },
                })
              }
            >
              Info
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void toast.promise(new Promise<void>((resolve) => setTimeout(resolve, 1400)), {
                  loading: "Evaluating 148 cases…",
                  success: "142 / 148 passed",
                  error: "Evaluation failed",
                })
              }
            >
              Promise
            </Button>
          </div>
        </Swatch>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch className="p-0">
          <EmptyState
            icon={<Inbox />}
            title="No runs yet"
            description="Run the workflow with a test input or send a request to the endpoint to see traces here."
            primaryAction={
              <Button variant="primary" leadingIcon={<Play />}>
                Run with test input
              </Button>
            }
            secondaryAction={<Button variant="ghost">Copy endpoint</Button>}
          />
        </Swatch>
        <Swatch className="p-0">
          <EmptyState
            size="sm"
            icon={<Search />}
            title="No nodes match “vector”"
            description="Try a broader term or browse categories."
            primaryAction={<Button size="sm">Clear search</Button>}
          />
        </Swatch>
      </div>
    </Section>
  );
}

function StatusSection() {
  return (
    <Section
      id="status"
      title="Status and identity"
      caption="StatusChip covers every RunStatus and NodeRunStatus; active states pulse. Badges tint by tone or by node category. Avatars are neutral: they are people, not categories."
    >
      <Row label="StatusChip (run statuses)">
        {RUN_STATUSES.map((s) => (
          <StatusChip key={s} status={s} />
        ))}
      </Row>
      <Row label="StatusChip (node-run statuses, small, compact, with meta)">
        {NODE_RUN_STATUSES.map((s) => (
          <StatusChip key={s} status={s} size="sm" />
        ))}
        <Separator orientation="vertical" className="h-4" />
        <StatusChip status="running" compact />
        <StatusChip status="failed" compact />
        <StatusChip status="completed" compact />
        <Separator orientation="vertical" className="h-4" />
        <StatusChip status="retrying" meta="2/3" />
        <StatusChip status="completed" meta={formatMs(412)} />
      </Row>
      <Row label="Badge (tones)">
        <Badge>Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="ok">Passed</Badge>
        <Badge tone="warn">Degraded</Badge>
        <Badge tone="danger">Failed</Badge>
        <Badge tone="info">Info</Badge>
        <Badge tone="outline">Outline</Badge>
        <Badge tone="accent" dot>
          Auto
        </Badge>
        <Badge tone="warn" dot>
          Review
        </Badge>
        <Badge tone="danger" dot>
          Human
        </Badge>
        <Badge mono>v7</Badge>
        <Badge mono tone="accent">
          0.81
        </Badge>
        <Badge size="sm">sm</Badge>
        <Badge icon={<Zap />} tone="accent">
          TypeSafe
        </Badge>
      </Row>
      <Row label="Badge (categories)">
        {NODE_CATEGORIES.map((c) => (
          <Badge key={c} category={c} dot>
            {c}
          </Badge>
        ))}
      </Row>
      <Row label="CategoryDot">
        {NODE_CATEGORIES.map((c) => (
          <CategoryDot key={c} category={c} />
        ))}
        <Separator orientation="vertical" className="h-4" />
        <CategoryDot category="decision" withLabel />
        <CategoryDot category="human" withLabel size={6} />
        <CategoryDot category="tool" hollow size={10} />
      </Row>
      <Row label="Avatar">
        <Avatar name="Ada Lovelace" size="xs" />
        <Avatar name="Ada Lovelace" size="sm" />
        <Avatar name="Ada Lovelace" />
        <Avatar name="Ada Lovelace" size="lg" />
        <Avatar name="ops-bot" shape="square" />
        <Avatar
          name="Grace Hopper"
          src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='%235c5c68'/></svg>"
        />
        <Avatar name="Broken image" src="data:image/png;base64,bm90LWFuLWltYWdl" />
        <div className="flex -space-x-1.5">
          <Avatar name="Ada Lovelace" className="ring-2 ring-surface" />
          <Avatar name="Grace Hopper" className="ring-2 ring-surface" />
          <Avatar name="Linus Torvalds" className="ring-2 ring-surface" />
        </div>
      </Row>
    </Section>
  );
}

function CompositionSection() {
  const [open, setOpen] = useState(false);
  const [autoT, setAutoT] = useState([0.9]);
  const [reviewT, setReviewT] = useState([0.7]);
  return (
    <Section
      id="composition"
      title="Composition"
      caption="An inspector-like form for the Intent decision node, and the approval dialog it produces when confidence falls below the threshold."
    >
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel
          title="Intent"
          meta="decision.choice"
          icon={<CategoryDot category="decision" />}
          toolbar={
            <TooltipProvider>
              <IconButton label="Run from here" size="sm">
                <Play />
              </IconButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More" size="sm" tooltip={false}>
                    <Ellipsis />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem icon={<Copy />} shortcut="mod+d">
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Trash2 />} destructive>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TooltipProvider>
          }
          padded={false}
          className="h-[560px]"
        >
          <Tabs defaultValue="config" className="h-full">
            <TabsList className="px-3">
              <TabsTrigger value="config">Config</TabsTrigger>
              <TabsTrigger value="io" count={2}>
                Ports
              </TabsTrigger>
              <TabsTrigger
                value="issues"
                badge={
                  <Badge tone="warn" size="sm" mono>
                    1
                  </Badge>
                }
              >
                Issues
              </TabsTrigger>
            </TabsList>
            <TabsContent value="config" className="h-[calc(100%-32px)]">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-4 p-3">
                  <FieldRow label="Name" required>
                    <Input defaultValue="Intent" />
                  </FieldRow>
                  <FieldRow label="Question" hint="Sent to the decision model verbatim.">
                    <Textarea autoGrow minRows={2} defaultValue="What is this message about?" />
                  </FieldRow>
                  <FieldRow label="Model">
                    <Select defaultValue="jev-latest" mono>
                      <SelectItem
                        value="jev-latest"
                        description="TypeSafe · calibrated"
                        meta="$0.40/M"
                      >
                        jev-latest
                      </SelectItem>
                      <SelectItem value="jev-mini" description="TypeSafe · faster" meta="$0.10/M">
                        jev-mini
                      </SelectItem>
                    </Select>
                  </FieldRow>
                  <FieldRow
                    label="Options"
                    labelAddon={
                      <Badge size="sm" mono>
                        4
                      </Badge>
                    }
                  >
                    <div className="flex flex-col gap-1.5">
                      {INTENT_DISTRIBUTION.map((d) => (
                        <div key={d.key} className="flex items-center gap-2">
                          <Input size="sm" defaultValue={d.label} />
                          <Input
                            size="sm"
                            mono
                            defaultValue={d.key}
                            className="w-24"
                            wrapperClassName="w-24 shrink-0"
                          />
                          <IconButton label={`Remove ${d.label}`} size="sm" tooltip={false}>
                            <Trash2 />
                          </IconButton>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        leadingIcon={<Plus />}
                        className="self-start"
                      >
                        Add option
                      </Button>
                    </div>
                  </FieldRow>
                  <Separator label="Confidence gate" />
                  <FieldRow label="Auto at or above" hint="Runs continue without review.">
                    <Slider
                      value={autoT}
                      onValueChange={setAutoT}
                      min={0}
                      max={1}
                      step={0.01}
                      showValue
                      formatValue={(v) => formatProbability(v)}
                    />
                  </FieldRow>
                  <FieldRow
                    label="Review at or above"
                    hint="Between review and auto, a secondary model validates."
                    error={
                      (reviewT[0] ?? 0) >= (autoT[0] ?? 1)
                        ? "Review threshold must be below the auto threshold."
                        : undefined
                    }
                  >
                    <Slider
                      value={reviewT}
                      onValueChange={setReviewT}
                      min={0}
                      max={1}
                      step={0.01}
                      showValue
                      formatValue={(v) => formatProbability(v)}
                      invalid={(reviewT[0] ?? 0) >= (autoT[0] ?? 1)}
                    />
                  </FieldRow>
                  <div className="flex items-center gap-2 text-2xs">
                    <Badge tone="danger" dot>
                      Human &lt; {formatProbability(reviewT[0] ?? 0)}
                    </Badge>
                    <Badge tone="warn" dot>
                      Review
                    </Badge>
                    <Badge tone="accent" dot>
                      Auto ≥ {formatProbability(autoT[0] ?? 1)}
                    </Badge>
                  </div>
                  <Collapsible title="Advanced" meta="3">
                    <div className="flex flex-col gap-3 pt-1">
                      <FieldRow layout="row" label="Timeout" align="center" labelWidth={80}>
                        <NumberInput defaultValue={30000} step={1000} unit="ms" />
                      </FieldRow>
                      <FieldRow layout="row" label="Retries" align="center" labelWidth={80}>
                        <NumberInput defaultValue={3} min={0} max={5} />
                      </FieldRow>
                      <FieldRow layout="row" label="Failover" align="center" labelWidth={80}>
                        <Switch defaultChecked />
                      </FieldRow>
                    </div>
                  </Collapsible>
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="io" className="p-3 text-xs text-ink-2">
              message: string → decision: choice
            </TabsContent>
            <TabsContent value="issues" className="p-3 text-xs text-ink-2">
              Option “Other” absorbed 14% of last week's traffic; consider splitting it.
            </TabsContent>
          </Tabs>
        </Panel>

        <Card className="self-start">
          <CardHeader>
            <div>
              <CardTitle>Approval required</CardTitle>
              <CardDescription>
                Confidence 0.71 is below the auto threshold 0.90 for Intent.
              </CardDescription>
            </div>
            <StatusChip status="waiting_for_human" />
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-ink-3">Run</p>
                <p className="mt-0.5 flex items-center gap-1 font-mono text-ink">
                  run_01j8x2k9v3
                  <CopyButton value="run_01j8x2k9v3" size="xs" tooltip={false} />
                </p>
              </div>
              <div>
                <p className="text-ink-3">Ticket</p>
                <p className="mt-0.5 font-mono text-ink">#4821</p>
              </div>
              <div>
                <p className="text-ink-3">Waiting</p>
                <p className="mt-0.5 font-mono text-ink">4 m 12 s</p>
              </div>
              <div>
                <p className="text-ink-3">Assignee</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-ink">
                  <Avatar name="Ada Lovelace" size="xs" /> Ada
                </p>
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-ink-2">
              “Hi, I was charged twice for September and the app keeps crashing when I open the
              invoice page. Can you refund one and fix the crash?”
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-eyebrow">Intent · decision.choice</p>
                <span className="font-mono text-2xs text-ink-3">jev-latest · {formatMs(412)}</span>
              </div>
              {[
                { label: "Billing", p: 0.71 },
                { label: "Technical", p: 0.24 },
                { label: "Account", p: 0.03 },
                { label: "Other", p: 0.02 },
              ].map((d, i) => (
                <div key={d.label} className="flex items-center gap-3 text-xs">
                  <span className={`w-16 ${i === 0 ? "font-medium text-ink" : "text-ink-2"}`}>
                    {d.label}
                  </span>
                  <ProgressBar
                    value={d.p}
                    tone={i === 0 ? "accent" : "neutral"}
                    className="flex-1"
                  />
                  <span className="w-10 text-right font-mono text-ink-2">
                    {formatProbability(d.p)}
                  </span>
                </div>
              ))}
            </div>
            <RadioGroup defaultValue="billing" aria-label="Choose intent">
              <RadioItem value="billing" label="Billing" meta="0.71" />
              <RadioItem value="technical" label="Technical" meta="0.24" />
              <RadioItem
                value="both"
                label="Both — split into two tickets"
                description="Creates a linked technical ticket."
              />
            </RadioGroup>
          </CardBody>
          <CardFooter>
            <Button variant="ghost" leadingIcon={<History />} size="sm">
              View trace
            </Button>
            <div className="flex gap-2">
              <Button variant="danger" size="sm">
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Check />}
                onClick={() => setOpen(true)}
              >
                Approve
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Approve as Billing?</DialogTitle>
            <DialogDescription>
              The run continues to “Draft reply” with intent = billing. Your choice is recorded for
              calibration.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <FieldRow label="Comment" optional>
              <Textarea
                autoGrow
                minRows={2}
                placeholder="Why this choice? (helps calibrate the model)"
              />
            </FieldRow>
            <Checkbox
              label="Also lower the auto threshold to 0.85 for Intent"
              description="Opens a draft version; nothing changes in production until published."
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

export default function PrimitivesGallery() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <LogoMark size={28} />
          <h1 className="text-lg font-semibold tracking-tight">Primitives</h1>
          <Badge tone="accent" mono>
            v0.1
          </Badge>
        </div>
        <p className="max-w-2xl text-sm text-ink-2">
          The controls every other group builds on: 28px controls, 5px radius, 1px borders, shadow-1
          on raised surfaces, one cobalt accent for decision and the primary action.
        </p>
      </header>
      <BrandSection />
      <ButtonsSection />
      <KeyboardSection />
      <InputsSection />
      <SelectionSection />
      <FieldsSection />
      <OverlaysSection />
      <NavigationSection />
      <FeedbackSection />
      <StatusSection />
      <CompositionSection />
      <Toaster />
    </div>
  );
}
