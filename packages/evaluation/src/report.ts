/** A Markdown rendering of a regression report (PR comments, CLI output, the publish dialog's copy). */
import type { RegressionReport } from "./types.js";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number, f: (x: number) => string) => (x > 0 ? `+${f(x)}` : f(x));

export function reportToMarkdown(r: RegressionReport): string {
  const s = r.summary;
  const b = r.baseline;
  const lines: string[] = [];
  lines.push(`## Evaluation: ${r.verdict === "pass" ? "PASS" : "FAIL"}`);
  if (r.gate)
    lines.push(`Gate: pass rate ≥ ${pct(r.gate.minPassRate)} (actual ${pct(s.passRate)})`);
  lines.push("");
  lines.push(`| metric | this version | ${b ? "baseline | Δ |" : ""}`);
  lines.push(`| --- | --- | ${b ? "--- | --- |" : ""}`);
  const row = (name: string, now: number, before: number | undefined, fmt: (x: number) => string) =>
    lines.push(
      `| ${name} | ${fmt(now)} | ${before !== undefined ? `${fmt(before)} | ${signed(now - before, fmt)} |` : ""}`,
    );
  row("pass rate", s.passRate, b?.passRate, pct);
  row("completion", s.completionRate, b?.completionRate, pct);
  row("branch correctness", s.branchCorrectness, b?.branchCorrectness, pct);
  row("schema success", s.schemaSuccess, b?.schemaSuccess, pct);
  row("tool success", s.toolSuccess, b?.toolSuccess, pct);
  row("human review rate", s.humanReviewRate, b?.humanReviewRate, pct);
  row("p95 latency (ms)", s.latency.p95, b?.latency.p95, (x) => String(Math.round(x)));
  row("cost per case (USD)", s.costUsd.perCase, b?.costUsd.perCase, (x) => x.toFixed(5));
  if (s.costUsd.judge > 0 || (b?.costUsd.judge ?? 0) > 0)
    row("judge checks (USD)", s.costUsd.judge, b?.costUsd.judge, (x) => x.toFixed(5));
  for (const [node, acc] of Object.entries(s.accuracy))
    row(`accuracy · ${node}`, acc, b?.accuracy[node], pct);
  for (const [node, cal] of Object.entries(s.calibration))
    row(`ECE · ${node}`, cal.ece, b?.calibration[node]?.ece, (x) => x.toFixed(3));
  if (r.warnings.length) {
    lines.push("", "### Warnings");
    for (const w of r.warnings) lines.push(`- ${w.code}: ${w.message}`);
  }
  if (r.flips.length) {
    lines.push(
      "",
      "### Flips",
      "",
      "| case | field | before | after |",
      "| --- | --- | --- | --- |",
    );
    for (const f of r.flips.slice(0, 50))
      lines.push(
        `| ${f.caseId} | ${f.field} | ${JSON.stringify(f.before)} | ${JSON.stringify(f.after)} |`,
      );
    if (r.flips.length > 50) lines.push(`| … | ${r.flips.length - 50} more | | |`);
  }
  return `${lines.join("\n")}\n`;
}
