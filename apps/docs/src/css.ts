/** Layout styles for the docs site; colors and type come from brand/tokens.css. */
export const SITE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; }
header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 24px; background: var(--surface); border-bottom: 1px solid var(--border); }
header a { color: var(--ink); text-decoration: none; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; letter-spacing: var(--tracking-tight); }
.brand span { color: var(--ink-2); font-weight: 500; }
.repo { font-size: var(--text-sm); color: var(--ink-2); }
.shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); max-width: 1180px; margin: 0 auto; }
nav { position: sticky; top: 49px; align-self: start; max-height: calc(100vh - 49px); overflow-y: auto; padding: 20px 16px 40px 24px; border-right: 1px solid var(--border); font-size: var(--text-sm); }
nav h3 { margin: 18px 0 6px; font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: var(--tracking-caps); color: var(--ink-2); }
nav ul { list-style: none; margin: 0; padding: 0; }
nav li a { display: block; padding: 3px 8px; border-radius: var(--radius-sm); color: var(--ink); text-decoration: none; }
nav li a:hover { background: var(--surface-2); }
nav li.current a { background: var(--accent-soft); color: var(--accent-text); font-weight: 600; }
main { min-width: 0; padding: 28px 40px 80px; }
main h1 { font-size: var(--text-xl); letter-spacing: var(--tracking-display); line-height: var(--leading-tight); margin: 0 0 16px; }
main h2 { font-size: var(--text-lg); margin: 32px 0 10px; letter-spacing: var(--tracking-tight); }
main h3 { font-size: var(--text-md); margin: 24px 0 8px; }
main a { color: var(--accent-text); }
.lead { font-size: 1.05rem; color: var(--ink-2); }
.meta { font-size: var(--text-sm); color: var(--ink-2); }
.warn { padding: 8px 12px; border-left: 3px solid var(--warn); background: var(--surface-2); }
.edit { margin-top: 48px; font-size: var(--text-sm); }
code { font-family: var(--font-mono); font-size: 0.86em; background: var(--surface-2); padding: 1px 4px; border-radius: var(--radius-xs); }
pre { overflow-x: auto; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); }
pre code { background: none; padding: 0; }
table { display: block; overflow-x: auto; border-collapse: collapse; margin: 12px 0; font-size: var(--text-sm); }
th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid var(--border); }
th { font-weight: 600; color: var(--ink-2); }
blockquote { margin: 16px 0; padding: 4px 16px; border-left: 3px solid var(--border); color: var(--ink-2); }
img { max-width: 100%; }
@media (max-width: 800px) {
  header { padding: 10px 16px; }
  .shell { grid-template-columns: 1fr; }
  nav { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--border); padding: 8px 16px; }
  main { padding: 20px 16px 60px; }
}
`;
