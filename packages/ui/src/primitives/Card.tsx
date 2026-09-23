import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Hover elevation + pointer for clickable cards. */
  interactive?: boolean;
  /** Accent ring for the selected card in a list. */
  selected?: boolean;
}

/** Raised surface: 1px border, shadow-1, 8px radius. Compose with CardHeader / CardBody / CardFooter. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, interactive = false, selected = false, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-selected={selected || undefined}
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-surface text-ink shadow-1",
        "transition-[box-shadow,border-color] duration-(--dur-base) ease-(--ease-out)",
        interactive && "cursor-pointer hover:border-border-strong hover:shadow-2",
        selected && "border-accent shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-1)]",
        className,
      )}
      {...rest}
    />
  );
});

export type CardHeaderProps = HTMLAttributes<HTMLDivElement>;

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-start justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
      {...rest}
    />
  );
});

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>;

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, children, ...rest },
  ref,
) {
  return (
    <h3
      ref={ref}
      className={cn("text-sm font-semibold leading-tight tracking-tight text-ink", className)}
      {...rest}
    >
      {children}
    </h3>
  );
});

export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  function CardDescription({ className, ...rest }, ref) {
    return (
      <p
        ref={ref}
        className={cn("mt-0.5 text-xs leading-normal text-ink-3", className)}
        {...rest}
      />
    );
  },
);

export type CardBodyProps = HTMLAttributes<HTMLDivElement>;

export const CardBody = forwardRef<HTMLDivElement, CardBodyProps>(function CardBody(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn("min-w-0 flex-1 p-4 text-sm", className)} {...rest} />;
});

export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-between gap-3 rounded-b-md border-t border-border bg-surface-2 px-4 py-2.5",
        className,
      )}
      {...rest}
    />
  );
});
