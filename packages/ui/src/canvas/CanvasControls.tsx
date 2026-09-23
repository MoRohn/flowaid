import { forwardRef, type HTMLAttributes } from "react";
import { Lock, LockOpen, Map as MapIcon, Maximize, Minus, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Tooltip, TooltipProvider } from "@/primitives";

export interface CanvasControlsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** Reset to 100% (clicking the zoom readout). */
  onResetZoom?: () => void;
  locked: boolean;
  onToggleLock: () => void;
  onAutoLayout?: () => void;
  minimapVisible?: boolean;
  onToggleMinimap?: () => void;
  minZoom?: number;
  maxZoom?: number;
}

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * Compact vertical stack of canvas controls: zoom in/out with a mono readout,
 * fit, lock, auto-layout and minimap toggle. Presentational; FlowCanvas
 * wires it to the viewport.
 */
export const CanvasControls = forwardRef<HTMLDivElement, CanvasControlsProps>(
  function CanvasControls(
    {
      zoom,
      onZoomIn,
      onZoomOut,
      onFitView,
      onResetZoom,
      locked,
      onToggleLock,
      onAutoLayout,
      minimapVisible,
      onToggleMinimap,
      minZoom = 0.25,
      maxZoom = 2,
      className,
      ...rest
    },
    ref,
  ) {
    const pct = Math.round(zoom * 100);
    return (
      <TooltipProvider>
        <div
          ref={ref}
          role="toolbar"
          aria-label="Canvas controls"
          aria-orientation="vertical"
          className={cn(
            "flex flex-col items-stretch rounded-md border border-border bg-surface p-0.5 shadow-2",
            className,
          )}
          {...rest}
        >
          <IconButton
            label="Zoom in"
            shortcut="mod+="
            size="sm"
            onClick={onZoomIn}
            tooltipSide="right"
            disabled={zoom >= maxZoom}
          >
            <Plus {...ICON} />
          </IconButton>
          <Tooltip content="Reset zoom" shortcut="mod+0" side="right">
            <button
              type="button"
              onClick={onResetZoom}
              className="h-5 rounded-xs font-mono text-2xs tabular text-ink-3 transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-ink"
              aria-label={`Zoom ${pct}%`}
            >
              {pct}%
            </button>
          </Tooltip>
          <IconButton
            label="Zoom out"
            shortcut="mod+-"
            size="sm"
            onClick={onZoomOut}
            tooltipSide="right"
            disabled={zoom <= minZoom}
          >
            <Minus {...ICON} />
          </IconButton>
          <span aria-hidden="true" className="mx-1 my-0.5 h-px bg-border" />
          <IconButton
            label="Fit to view"
            shortcut="mod+0"
            size="sm"
            onClick={onFitView}
            tooltipSide="right"
          >
            <Maximize {...ICON} />
          </IconButton>
          <IconButton
            label={locked ? "Unlock canvas" : "Lock canvas"}
            size="sm"
            onClick={onToggleLock}
            tooltipSide="right"
            aria-pressed={locked}
            className={cn(
              locked && "bg-warn-soft text-warn-text hover:bg-warn-soft hover:text-warn-text",
            )}
          >
            {locked ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
          </IconButton>
          {onAutoLayout ? (
            <IconButton
              label="Auto layout"
              shortcut="shift+L"
              size="sm"
              onClick={onAutoLayout}
              tooltipSide="right"
            >
              <Sparkles {...ICON} />
            </IconButton>
          ) : null}
          {onToggleMinimap ? (
            <IconButton
              label={minimapVisible ? "Hide minimap" : "Show minimap"}
              size="sm"
              onClick={onToggleMinimap}
              tooltipSide="right"
              aria-pressed={minimapVisible}
              className={cn(minimapVisible && "text-ink")}
            >
              <MapIcon {...ICON} />
            </IconButton>
          ) : null}
        </div>
      </TooltipProvider>
    );
  },
);
