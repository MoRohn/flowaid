# FlowAId identity

This directory is the source of truth for how FlowAId looks. The web app imports `tokens.css` unchanged and uses the SVGs here verbatim. `preview.html` is the living style guide; open it in a browser (it works from the file system).

## Idea

FlowAId's difference is that intelligence is typed: a decision returns a value **and** its probability distribution, and confidence drives what happens next. The identity is built from that one fact.

- **The mark** is a weighted fork. One path in, three paths out. Each branch's opacity is its probability (1.0 / 0.42 / 0.18) and the filled dot marks the branch that was taken. It is the silhouette of every TypeSafe node on the canvas, drawn with one stroke so it survives at 16 px.
- **The wordmark** sets the odd capitalisation to work: "Flow" and "d" in ink, "AI" in the accent. Instrument Sans SemiBold, tracked −0.035 em, glyphs converted to paths so it renders identically everywhere.
- **The probability ruler** is the signature element: a horizontal strip whose segments are proportional to a distribution (0.81 / 0.12 / 0.04 / 0.03). It appears under the hero, inside decision nodes, and in the trace. It is never decoration; it always shows real numbers.

## Files

| file                                                                    | use                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `logo-mark.svg`                                                         | monochrome mark, `currentColor`; use in the top bar, docs, README |
| `logo-mark-accent.svg`                                                  | mark with the accent dot; default for app chrome                  |
| `logo-wordmark.svg`                                                     | wordmark with accent "AI" (paths, `currentColor` for ink)         |
| `logo-wordmark-mono.svg`                                                | single-color wordmark for tinted backgrounds                      |
| `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png` | browser and PWA icons (ink tile, white stroke, accent dot)        |
| `tokens.css`                                                            | every design token, light and dark                                |
| `fonts/`                                                                | Instrument Sans 400–700, JetBrains Mono 400–600 (OFL)             |
| `preview.html`                                                          | the style guide                                                   |

Clear space around the mark: one stroke width (2.5 units of the 32-unit grid) on all sides. Minimum sizes: mark 16 px, wordmark 14 px tall. Never recolor the branches individually, never rotate the mark, never place the accent dot on any branch but the top one.

## Color

Cool graphite neutrals; one accent; separate status and category palettes. Purple, pink and teal are excluded by decision.

| role             | light     | dark      |
| ---------------- | --------- | --------- |
| canvas           | `#f5f5f7` | `#0e0e11` |
| surface          | `#ffffff` | `#151519` |
| border           | `#e3e3e8` | `#26262d` |
| ink              | `#17171c` | `#ededf0` |
| ink 3 (tertiary) | `#7c7c88` | `#7f7f8a` |
| accent (cobalt)  | `#2f5be8` | `#6b93ff` |

Rules:

- **Cobalt means decision.** The accent is spent on decision intelligence and the primary action. Nothing else is blue. Purple, pink and teal are never used anywhere in the product.
- **Status is not category.** Running is blue, waiting is amber, completed is green, failed is red. Node categories have their own hues (`--cat-*`) and never reuse status hues except Human = amber, which is deliberate: a human node is where runs wait.
- **State is a border, not a fill.** A node's fill stays neutral; running/waiting/failed change its outline.
- Probability ramps use one hue (`--p-1` … `--p-4`), chosen option darkest.

## Type

- **Instrument Sans** for everything a person reads. UI text 13 px/400, labels 12 px/500, headings 20 px/600 tracked −0.02 em, display 40 px/600 tracked −0.035 em.
- **JetBrains Mono** with tabular numerals for everything a machine produced: probabilities, durations, tokens, cost, identifiers, node kinds. 11–12 px in the app.
- A line mixes the two faces only when it pairs a label with a value.

Web loading: use `next/font/google` for both families in the app (weights 400/500/600/700 and 400/500/600); the TTFs in `fonts/` are for the style guide and any offline rendering.

## Components (see preview.html)

- **Controls**: 28 px tall, 5 px radius, 1 px border, 12 px medium text. Focus is the two-ring `--focus` outline. Primary button is accent-filled and the only filled button on a screen.
- **Nodes**: 232 px wide, 8 px radius, category dot + name + mono kind in the header, one-line purpose, mono meta row, footer with provider/status and duration. Decision nodes render their distribution inline. Ports are 8 px circles on the border, tinted by category when typed.
- **Chips**: 22 px pills with a leading dot, soft background of the status color.
- **Trace rows**: 30 px, mono timestamps right-aligned, span bar in the category color, decision distribution expanded under the row.

## Voice

Sentence case. Plain verbs. A control names what happens ("Publish" → "Published"). Errors name the node, the cause and the next step, and never apologize. Empty states offer the next action.
