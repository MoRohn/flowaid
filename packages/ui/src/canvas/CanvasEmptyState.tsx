import { forwardRef, type HTMLAttributes } from "react";
import { LayoutTemplate, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, LogoMark, Shortcut } from "@/primitives";

export interface CanvasEmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  onAddNode: () => void;
  onStartFromTemplate?: () => void;
  onDescribeToBuilder?: () => void;
}

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * Shown when the workflow has no nodes. Offers the three ways to start:
 * the palette, a template, or describing the workflow to the AI builder.
 */
export const CanvasEmptyState = forwardRef<HTMLDivElement, CanvasEmptyStateProps>(
  function CanvasEmptyState(
    { onAddNode, onStartFromTemplate, onDescribeToBuilder, className, ...rest },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-8 text-center shadow-2",
          className,
        )}
        {...rest}
      >
        <LogoMark size={40} className="text-ink" />
        <div className="flex flex-col gap-1">
          <p className="text-md font-semibold tracking-tight text-ink">Add your first node</p>
          <p className="text-sm text-ink-3">
            Start with a decision, a tool or a trigger. Wire them, then gate on confidence.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            leadingIcon={<Plus {...ICON} />}
            onClick={onAddNode}
            className="w-full"
          >
            Add node
            <Shortcut
              shortcut="mod+k"
              size="sm"
              className="ml-auto border-transparent bg-transparent text-accent-ink/70"
            />
          </Button>
          {onStartFromTemplate ? (
            <Button
              size="lg"
              leadingIcon={<LayoutTemplate {...ICON} />}
              onClick={onStartFromTemplate}
              className="w-full justify-start"
            >
              Start from template
            </Button>
          ) : null}
          {onDescribeToBuilder ? (
            <Button
              size="lg"
              leadingIcon={<Sparkles {...ICON} />}
              onClick={onDescribeToBuilder}
              className="w-full justify-start"
            >
              Describe it to the AI builder
            </Button>
          ) : null}
        </div>
      </div>
    );
  },
);
