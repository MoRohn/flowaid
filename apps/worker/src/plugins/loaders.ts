/**
 * The plugin packages this worker image can load, by name (never an arbitrary specifier). Shared
 * by the worker (manifests, schemas) and the plugin host process (execution).
 */
export type Loader = () => Promise<{ module: Record<string, unknown>; version: string }>;

export const BUNDLED_LOADERS: Readonly<Record<string, Loader>> = {
  "@flowaid/nodes-langchain": async () => {
    const module = (await import("@flowaid/nodes-langchain")) as unknown as Record<string, unknown>;
    const version = typeof module.PACKAGE_VERSION === "string" ? module.PACKAGE_VERSION : "0.0.0";
    return { module, version };
  },
};
