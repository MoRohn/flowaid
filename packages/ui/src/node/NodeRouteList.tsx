import { forwardRef, type HTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NodeCategory } from "@/lib/categories";
import type { PortView } from "@/types";
import { TypedHandle } from "./TypedHandle";
import { handleId } from "./nodeUtils";
import { Hint } from "@/primitives";

export interface NodeRouteItem {
  /** Control port name; the row's handle is `ctl:<id>`. */
  id: string;
  label: string;
  /** Expression or rule shown in mono after the label. */
  condition?: string;
}

export interface NodeRouteListProps extends HTMLAttributes<HTMLDivElement> {
  routes: NodeRouteItem[];
  /** Route id taken by the last run. */
  taken?: string;
  /** When true (a run happened), routes other than `taken` are muted. */
  resolved?: boolean;
  /** Category hue for the exit handles. */
  category?: NodeCategory;
  /** Data outputs listed below the exits, each with its `out:<port>` handle. */
  outputs?: PortView[];
  /** Handle ids to light up while a connection drags. */
  compatibleHandles?: ReadonlyArray<string>;
  /** Why other handles reject the dragged connection, by handle id. */
  handleReasons?: Readonly<Record<string, string>>;
}

/**
 * Exit rows for branch, router, gate and human nodes: one 24px row per
 * control-out with its own `ctl:<id>` handle on the card border, then one row
 * per data output (`out:<port>`) below them. After a run the taken route is
 * emphasised and the others fade.
 */
export const NodeRouteList = forwardRef<HTMLDivElement, NodeRouteListProps>(function NodeRouteList(
  {
    routes,
    taken,
    resolved = taken !== undefined,
    category = "flow",
    outputs = [],
    compatibleHandles,
    handleReasons,
    className,
    ...rest
  },
  ref,
) {
  const compatible = compatibleHandles ? new Set(compatibleHandles) : undefined;
  return (
    <div ref={ref} className={cn("flex flex-col", className)} {...rest}>
      <div role="list" aria-label="Routes" className="flex flex-col">
        {routes.map((route) => {
          const id = handleId("ctl", route.id);
          const isTaken = resolved && route.id === taken;
          const muted = resolved && !isTaken;
          return (
            <div
              key={route.id}
              role="listitem"
              data-route={route.id}
              data-taken={isTaken ? "true" : "false"}
              data-muted={muted ? "true" : undefined}
              className={cn(
                "relative flex h-6 items-center gap-1.5 pl-[26px] pr-3.5 transition-colors duration-(--dur-fast)",
                isTaken ? "text-ink" : muted ? "text-ink-3" : "text-ink-2",
              )}
            >
              <span className={cn("shrink-0 text-xs leading-none", isTaken && "font-medium")}>
                {route.label}
              </span>
              {route.condition ? (
                <Hint
                  hint={route.condition}
                  announce={false}
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-2xs leading-none",
                    isTaken ? "text-ink-3" : "text-ink-3",
                  )}
                >
                  {route.condition}
                </Hint>
              ) : (
                <span className="flex-1" />
              )}
              {isTaken ? (
                <ArrowRight
                  className="size-3 shrink-0 text-accent"
                  strokeWidth={2}
                  aria-label="Taken"
                />
              ) : null}
              <TypedHandle
                kind="ctl"
                name={route.id}
                label={route.label}
                category={category}
                connected={isTaken}
                compatible={compatible ? compatible.has(id) : undefined}
                reason={handleReasons?.[id]}
                className={cn(muted && "opacity-50")}
              />
            </div>
          );
        })}
      </div>
      {outputs.length ? (
        <div role="list" aria-label="Outputs" className="flex flex-col">
          {outputs.map((port) => {
            const id = handleId("out", port.id);
            return (
              <div
                key={id}
                role="listitem"
                data-output={port.id}
                className="relative flex h-6 items-center gap-1.5 pl-[26px] pr-3.5 text-ink-3"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-2xs leading-none">
                  {port.label}
                </span>
                <TypedHandle
                  kind="out"
                  name={port.id}
                  port={port}
                  category={category}
                  labelMode="never"
                  compatible={compatible ? compatible.has(id) : undefined}
                  reason={handleReasons?.[id]}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
