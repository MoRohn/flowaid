import {
  forwardRef,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
  type RefAttributes,
} from "react";

/**
 * The code and template editors are built on CodeMirror (about 150 KB gzip with its languages).
 * Their public components load it on demand: the first editor on a page renders `fallback` (a box
 * the editor's size) behind Suspense while the chunk arrives, and once it has loaded every editor
 * renders at once, without a fallback. `preload()` fetches it ahead of time (tests, the builder).
 */
export function lazyEditor<P extends object, H>(
  displayName: string,
  load: () => Promise<ComponentType<P & RefAttributes<H>>>,
  fallback: (props: P) => ReactNode,
) {
  let loaded: ComponentType<P & RefAttributes<H>> | undefined;
  let pending: Promise<void> | undefined;
  const preload = (): Promise<void> =>
    (pending ??= load().then(
      (component) => {
        loaded = component;
      },
      (error: unknown) => {
        pending = undefined; // a failed chunk can be fetched again
        throw error;
      },
    ));
  type Module = { default: ComponentType<P & RefAttributes<H>> };
  const Lazy = lazy<ComponentType<P & RefAttributes<H>>>(() => {
    // already loaded: a thenable that answers at once, so React renders without suspending
    if (loaded) {
      const module: Module = { default: loaded };
      return {
        then: (resolve: (m: Module) => void) => resolve(module),
      } as unknown as Promise<Module>;
    }
    return preload().then(() => ({ default: loaded as ComponentType<P & RefAttributes<H>> }));
  });
  const Editor = forwardRef<H, P>(function LazyEditor(props, ref) {
    return (
      <Suspense fallback={fallback(props as P)}>
        <Lazy {...(props as P & RefAttributes<H>)} ref={ref} />
      </Suspense>
    );
  });
  Editor.displayName = displayName;
  return Object.assign(Editor, { preload });
}

/** Height of `rows` lines of 20 px plus the editor's 8 px of padding, as the editors size them. */
export function rowsHeight(text: string | undefined, minRows: number, maxRows: number): string {
  const lines = (text ?? "").split("\n").length;
  return `${Math.min(Math.max(lines, minRows), maxRows) * 20 + 8}px`;
}
