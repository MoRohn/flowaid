import { cn } from "@/lib/cn";

/**
 * A small dot after a tab or section label that has edits nobody saved yet. Screen readers hear
 * "unsaved changes"; the dot is never the only sign (the form itself says "Unsaved changes").
 */
export function UnsavedMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
      <span className="sr-only">(unsaved changes)</span>
    </span>
  );
}
