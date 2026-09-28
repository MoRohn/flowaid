import { ExternalLink } from "lucide-react";

/** "Learn more" after a page or section description: the guide for the concept, in a new tab. */
export function LearnMore({ href, label = "Learn more" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 whitespace-nowrap text-accent-text hover:underline"
    >
      {label}
      <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
