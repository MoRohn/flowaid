/** Allow CSS custom properties (`--label-w`) in React style objects without casts. */
import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
