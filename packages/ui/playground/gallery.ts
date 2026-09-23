import type { ComponentType } from "react";

/**
 * Gallery manifest. Each component group registers one page here by adding
 * `<group>/gallery.tsx` exporting `default: ComponentType` and `meta`.
 * Pages are lazily imported so a broken group does not take down the rest.
 */
export interface GalleryPage {
  slug: string;
  title: string;
  load: () => Promise<{ default: ComponentType }>;
}

export const GALLERY: GalleryPage[] = [
  { slug: "primitives", title: "Primitives", load: () => import("@/primitives/gallery") },
  { slug: "decision", title: "Decision", load: () => import("@/decision/gallery") },
  { slug: "node", title: "Nodes", load: () => import("@/node/gallery") },
  { slug: "canvas", title: "Canvas", load: () => import("@/canvas/gallery") },
  { slug: "trace", title: "Trace", load: () => import("@/trace/gallery") },
  { slug: "inspector", title: "Inspector", load: () => import("@/inspector/gallery") },
  { slug: "forms", title: "Forms", load: () => import("@/forms/gallery") },
  { slug: "shell", title: "Shell", load: () => import("@/shell/gallery") },
  { slug: "data", title: "Data", load: () => import("@/data/gallery") },
  { slug: "observability", title: "Observability", load: () => import("@/observability/gallery") },
  { slug: "human", title: "Human", load: () => import("@/human/gallery") },
  { slug: "builder", title: "Builder", load: () => import("@/builder/gallery") },
  { slug: "jev", title: "Jev engineering", load: () => import("@/jev/gallery") },
];
