/**
 * Any path under a workspace that no page answers ("/acme/nope"). Next sends unmatched URLs to the
 * root not-found page, outside the workspace; this catch-all hands them to the workspace's own
 * not-found page instead, which keeps the navigation and the theme.
 */
import { notFound } from "next/navigation";

export default function UnknownWorkspacePath(): never {
  notFound();
}
