import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ArrowDownToLine, Eraser, Maximize2, Minimize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipProvider,
  useControllableState,
} from "@/primitives";

export interface BottomPanelTab {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  /** Any node after the label (a StatusChip while a run is live). */
  badge?: ReactNode;
  content: ReactNode;
  /** Tone for the count (Problems in red). */
  countTone?: "neutral" | "danger" | "warn";
}

export interface BottomPanelProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  tabs: BottomPanelTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Auto-scroll to the newest line (logs, trace). Omit to hide the toggle. */
  follow?: boolean;
  onFollowChange?: (follow: boolean) => void;
  onClear?: () => void;
  /** Fills the content area. Defaults to the AppShell state when inside one. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Defaults to the AppShell's close when inside one. */
  onClose?: () => void;
  /** Extra toolbar controls before the standard ones. */
  tools?: ReactNode;
}

/**
 * Dockable panel at the bottom of the builder: tabs (Run, Trace, Logs,
 * Output, Problems) with counts, and a right-side toolbar with follow, clear,
 * expand and close. The resize handle above it comes from AppShell.
 */
export const BottomPanel = forwardRef<HTMLElement, BottomPanelProps>(function BottomPanel(
  {
    tabs,
    value,
    defaultValue,
    onValueChange,
    follow,
    onFollowChange,
    onClear,
    expanded: expandedProp,
    onExpandedChange,
    onClose,
    tools,
    className,
    ...rest
  },
  ref,
) {
  const [current, setCurrent] = useControllableState<string | undefined>(
    value,
    defaultValue ?? tabs[0]?.id,
    (v) => {
      if (v !== undefined) onValueChange?.(v);
    },
  );
  const [expanded, setExpandedState] = useControllableState<boolean>(
    expandedProp,
    false,
    onExpandedChange,
  );
  const setExpanded = (next: boolean) => setExpandedState(next);
  const close = onClose;

  return (
    <TooltipProvider>
      <section
        ref={ref}
        aria-label="Bottom panel"
        data-expanded={expanded || undefined}
        className={cn("flex h-full min-h-0 min-w-0 flex-col bg-surface text-ink", className)}
        {...rest}
      >
        <Tabs value={current} onValueChange={setCurrent} size="sm" className="h-full min-h-0">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
            <TabsList className="h-8 min-w-0 flex-1 gap-3 border-b-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  count={
                    tab.countTone === undefined || tab.countTone === "neutral"
                      ? tab.count
                      : undefined
                  }
                  icon={tab.icon}
                  badge={
                    tab.count !== undefined && tab.countTone && tab.countTone !== "neutral" ? (
                      <span
                        className={cn(
                          "rounded-xs px-1 font-mono text-2xs font-normal leading-4 tabular",
                          tab.countTone === "danger"
                            ? "bg-danger-soft text-danger-text"
                            : "bg-warn-soft text-warn-text",
                        )}
                      >
                        {tab.count}
                      </span>
                    ) : (
                      tab.badge
                    )
                  }
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex shrink-0 items-center gap-0.5">
              {tools}
              {follow !== undefined ? (
                <IconButton
                  label={follow ? "Following output" : "Follow output"}
                  size="sm"
                  aria-pressed={follow}
                  onClick={() => onFollowChange?.(!follow)}
                  className={cn(
                    follow &&
                      "bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text",
                  )}
                >
                  <ArrowDownToLine strokeWidth={1.75} />
                </IconButton>
              ) : null}
              {onClear ? (
                <IconButton label="Clear" size="sm" onClick={onClear}>
                  <Eraser strokeWidth={1.75} />
                </IconButton>
              ) : null}
              <IconButton
                label={expanded ? "Restore panel" : "Expand panel"}
                size="sm"
                aria-pressed={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 strokeWidth={1.75} /> : <Maximize2 strokeWidth={1.75} />}
              </IconButton>
              {close ? (
                <IconButton label="Close panel" shortcut="mod+j" size="sm" onClick={close}>
                  <X strokeWidth={1.75} />
                </IconButton>
              ) : null}
            </div>
          </div>
          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="min-h-0 flex-1 overflow-auto">
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </TooltipProvider>
  );
});
