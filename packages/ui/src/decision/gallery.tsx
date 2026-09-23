import { useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { TooltipProvider } from "@/primitives/Tooltip";
import type { ConfidenceThresholds } from "@/types";
import {
  failoverAttempts,
  makeBooleanDecision,
  makeChoiceDecision,
  makeScoreDecision,
} from "@/lib/decisionBuilders";
import { scoreLegend } from "./distribution";
import {
  CalibrationChart,
  ConfidenceGateEditor,
  ConfidenceMeter,
  ConfidenceSparkbar,
  DecisionBadge,
  DecisionBundle,
  DecisionCard,
  DistributionList,
  FailoverNotice,
  NoulGauge,
  ProbabilityRuler,
  ScoreScale,
  type CalibrationBin,
  type DecisionBundleItem,
} from "./index";

// ---------------------------------------------------------------------------
// Gallery scaffolding
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Swatch({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1",
        className,
      )}
    >
      {label ? <p className="m-0 text-2xs font-medium text-ink-3">{label}</p> : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sample data: support-triage workflow
// ---------------------------------------------------------------------------

const GATE: ConfidenceThresholds = { review: 0.6, auto: 0.9 };

const INTENT_QUESTION = "Which team should handle this ticket?";
const INTENT = makeChoiceDecision({
  probabilities: { security: 0.81, technical: 0.12, billing: 0.04, sales: 0.03 },
  model: "jev-latest",
  latencyMs: 84,
  usage: { inputTokens: 412, outputTokens: 6 },
  costUsd: 0.00021,
});

const INTENT_WIDE_QUESTION = "Which product area does this ticket concern?";
const INTENT_WIDE = makeChoiceDecision({
  probabilities: {
    auth: 0.44,
    billing: 0.21,
    api: 0.13,
    dashboard: 0.09,
    mobile: 0.06,
    integrations: 0.04,
    docs: 0.02,
    other: 0.01,
  },
  model: "jev-latest",
  latencyMs: 91,
  usage: { inputTokens: 412, outputTokens: 6 },
  costUsd: 0.00021,
});

const URGENCY_LEVELS = ["Minimal", "Low", "Moderate", "High", "Critical"];
const URGENCY_QUESTION = "How urgent is this request?";
const URGENCY = makeScoreDecision({
  levels: URGENCY_LEVELS,
  value: 3.72,
  confidence: 0.77,
  probabilities: [0.01, 0.03, 0.08, 0.42, 0.46],
  model: "jev-latest",
  latencyMs: 61,
  usage: { inputTokens: 398, outputTokens: 4 },
  costUsd: 0.00019,
});

const ESCALATION_QUESTION = "Does this ticket need a human before any reply is sent?";
const ESCALATION = makeBooleanDecision({
  pYes: 0.96,
  model: "jev-latest",
  latencyMs: 52,
  usage: { inputTokens: 380, outputTokens: 2 },
  costUsd: 0.00018,
});

const SAFETY_QUESTION = "Is the drafted reply safe to send without edits?";
const SAFETY = makeBooleanDecision({
  pYes: 0.09,
  provider: "openai",
  model: "gpt-5-mini",
  latencyMs: 1240,
  usage: { inputTokens: 1210, outputTokens: 3 },
  costUsd: 0.00092,
  attempts: failoverAttempts([
    { provider: "typesafe", model: "jev-latest", latencyMs: 2000, errorCode: "TIMEOUT_ERROR" },
    { provider: "openai", model: "gpt-5-mini", latencyMs: 1240 },
  ]),
});

const SENTIMENT_QUESTION = "What is the customer's tone?";
const SENTIMENT = makeChoiceDecision({
  probabilities: { frustrated: 0.67, neutral: 0.22, angry: 0.09, positive: 0.02 },
  model: "jev-latest",
  latencyMs: 58,
  usage: { inputTokens: 388, outputTokens: 5 },
  costUsd: 0.0002,
});

const FRAUD_QUESTION = "How likely is this account takeover?";
const FRAUD = makeScoreDecision({
  levels: ["Unlikely", "Possible", "Likely", "Confirmed"],
  value: 1.2,
  confidence: 0.88,
  probabilities: [0.31, 0.52, 0.14, 0.03],
  model: "jev-latest",
  latencyMs: 73,
  usage: { inputTokens: 402, outputTokens: 4 },
  costUsd: 0.0002,
});

const BUNDLE: DecisionBundleItem[] = [
  { id: "urgency", name: "Urgency", result: URGENCY, question: URGENCY_QUESTION },
  { id: "sentiment", name: "Sentiment", result: SENTIMENT, question: SENTIMENT_QUESTION },
  { id: "fraud", name: "Fraud risk", result: FRAUD, question: FRAUD_QUESTION },
  { id: "escalation", name: "Escalation", result: ESCALATION, question: ESCALATION_QUESTION },
];

const INTENT_SAMPLES: Array<Record<string, number>> = [
  INTENT.probabilities ?? {},
  { security: 0.22, technical: 0.61, billing: 0.11, sales: 0.06 },
  { security: 0.05, technical: 0.07, billing: 0.86, sales: 0.02 },
  { security: 0.34, technical: 0.31, billing: 0.2, sales: 0.15 },
];

/** Deterministic pseudo-random generator so the gallery renders the same data every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleConfidences(n: number): number[] {
  const rnd = mulberry32(20260922);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = rnd();
    const g = (rnd() + rnd() + rnd() - 1.5) / 1.5; // approx. normal in [-1, 1]
    const v = u < 0.68 ? 0.91 + g * 0.06 : u < 0.9 ? 0.7 + g * 0.1 : 0.45 + g * 0.15;
    out.push(Math.min(0.999, Math.max(0.02, v)));
  }
  return out;
}

const CALIBRATION: CalibrationBin[] = [
  { lower: 0.0, upper: 0.1, predicted: 0.07, observed: 0.11, count: 9 },
  { lower: 0.1, upper: 0.2, predicted: 0.16, observed: 0.19, count: 14 },
  { lower: 0.2, upper: 0.3, predicted: 0.25, observed: 0.3, count: 22 },
  { lower: 0.3, upper: 0.4, predicted: 0.35, observed: 0.33, count: 31 },
  { lower: 0.4, upper: 0.5, predicted: 0.46, observed: 0.41, count: 48 },
  { lower: 0.5, upper: 0.6, predicted: 0.55, observed: 0.49, count: 73 },
  { lower: 0.6, upper: 0.7, predicted: 0.65, observed: 0.58, count: 121 },
  { lower: 0.7, upper: 0.8, predicted: 0.75, observed: 0.71, count: 188 },
  { lower: 0.8, upper: 0.9, predicted: 0.86, observed: 0.83, count: 297 },
  { lower: 0.9, upper: 1.0, predicted: 0.95, observed: 0.94, count: 437 },
];

const TABLE_ROWS = [
  { id: "tk_48213", node: "Intent", value: "security", c: 0.81 },
  { id: "tk_48214", node: "Intent", value: "billing", c: 0.94 },
  { id: "tk_48215", node: "Urgency", value: "High", c: 0.77 },
  { id: "tk_48216", node: "Escalation", value: "yes", c: 0.96 },
  { id: "tk_48217", node: "Intent", value: "technical", c: 0.52 },
  { id: "tk_48218", node: "Sentiment", value: "angry", c: 0.6 },
];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function RulerSection() {
  const [i, setI] = useState(0);
  const dist = INTENT_SAMPLES[i] ?? INTENT_SAMPLES[0] ?? {};
  return (
    <Section
      id="ruler"
      title="Probability ruler"
      caption="The signature strip. Segments are proportional to the distribution with a 3px gap; the chosen option is --p-1 and the rest descend the ramp. Widths animate on change and hold still under reduced motion."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch label="Sizes xs · sm · md · lg">
          <ProbabilityRuler distribution={INTENT.probabilities} size="xs" />
          <ProbabilityRuler distribution={INTENT.probabilities} size="sm" />
          <ProbabilityRuler distribution={INTENT.probabilities} size="md" />
          <ProbabilityRuler distribution={INTENT.probabilities} size="lg" />
        </Swatch>
        <Swatch label="Labels under every segment wide enough to hold one">
          <ProbabilityRuler distribution={INTENT.probabilities} size="md" showLabels />
          <ProbabilityRuler
            distribution={INTENT_WIDE.probabilities}
            chosen="auth"
            size="md"
            showLabels
          />
          <ProbabilityRuler
            distribution={URGENCY.probabilities}
            labels={scoreLegend(URGENCY.levels)}
            chosen="4"
            sort={false}
            size="md"
            showLabels
          />
        </Swatch>
        <Swatch label="Animated on change" className="md:col-span-2">
          <div className="flex items-center gap-3">
            <ProbabilityRuler distribution={dist} size="lg" showLabels className="max-w-xl" />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<RefreshCw />}
              onClick={() => setI((v) => (v + 1) % INTENT_SAMPLES.length)}
            >
              Next sample
            </Button>
          </div>
        </Swatch>
      </div>
    </Section>
  );
}

function DistributionSection() {
  return (
    <Section
      id="distribution"
      title="Distribution list"
      caption="Option rows sorted by probability. The winner is ink over a --p-1 bar, the rest tertiary over --p-2. Past maxRows the tail folds into a disclosure with its summed probability."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Swatch label="Regular">
          <DistributionList distribution={INTENT.probabilities} />
        </Swatch>
        <Swatch label="Compact · maxRows 3 · +N more">
          <DistributionList
            distribution={INTENT_WIDE.probabilities}
            density="compact"
            maxRows={3}
          />
        </Swatch>
        <Swatch label="Legend labels · keys shown">
          <DistributionList
            distribution={URGENCY.probabilities}
            labels={scoreLegend(URGENCY.levels)}
            showKeys
            maxRows={4}
            defaultExpanded
          />
        </Swatch>
      </div>
    </Section>
  );
}

function MeterSection() {
  return (
    <Section
      id="meter"
      title="Confidence meter"
      caption="0 to 1 with the three gate zones as bands: human below review, review up to auto, auto at or above. The active zone is tinted; the marker is ink; the outcome is a Badge."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch label="Outcomes · gate 0.60 / 0.90">
          <ConfidenceMeter confidence={0.42} thresholds={GATE} />
          <ConfidenceMeter confidence={0.78} thresholds={GATE} />
          <ConfidenceMeter confidence={0.94} thresholds={GATE} />
        </Swatch>
        <Swatch label="Edge cases · exactly at thresholds">
          <ConfidenceMeter confidence={0.6} thresholds={GATE} />
          <ConfidenceMeter confidence={0.9} thresholds={GATE} />
          <ConfidenceMeter confidence={0.599} thresholds={GATE} />
        </Swatch>
        <Swatch label="Sizes sm · md · lg">
          <ConfidenceMeter confidence={0.81} thresholds={GATE} size="sm" />
          <ConfidenceMeter confidence={0.81} thresholds={GATE} size="md" />
          <ConfidenceMeter confidence={0.81} thresholds={GATE} size="lg" />
        </Swatch>
        <Swatch label="Without zones · without outcome · narrow gate">
          <ConfidenceMeter confidence={0.81} thresholds={GATE} showZones={false} />
          <ConfidenceMeter confidence={0.81} thresholds={GATE} showOutcome={false} />
          <ConfidenceMeter confidence={0.81} thresholds={{ review: 0.8, auto: 0.85 }} />
        </Swatch>
      </div>
    </Section>
  );
}

function SparkbarSection() {
  return (
    <Section
      id="sparkbar"
      title="Confidence sparkbar"
      caption="Inline bar for tables: filled to the value in the outcome colour, with the two thresholds as faint ticks."
    >
      <Swatch className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] border-collapse text-xs">
          <thead>
            <tr className="text-left text-2xs text-ink-3">
              <th className="border-b border-border px-4 py-2 font-medium">Ticket</th>
              <th className="border-b border-border px-4 py-2 font-medium">Node</th>
              <th className="border-b border-border px-4 py-2 font-medium">Decision</th>
              <th className="border-b border-border px-4 py-2 font-medium">Confidence</th>
              <th className="border-b border-border px-4 py-2 text-right font-medium">
                Neutral fill
              </th>
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map((r) => (
              <tr key={r.id} className="h-8 even:bg-surface-2">
                <td className="px-4 font-mono text-2xs text-ink-2">{r.id}</td>
                <td className="px-4">{r.node}</td>
                <td className="px-4 font-mono text-2xs">{r.value}</td>
                <td className="px-4">
                  <ConfidenceSparkbar value={r.c} thresholds={GATE} />
                </td>
                <td className="px-4 text-right">
                  <ConfidenceSparkbar
                    value={r.c}
                    thresholds={GATE}
                    toneByOutcome={false}
                    width={64}
                    showValue={false}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Swatch>
    </Section>
  );
}

function NoulSection() {
  return (
    <Section
      id="noul"
      title="Noul gauge"
      caption="P(yes) on a bipolar bar centred at 0.5. Yes fills toward the right in the decision hue, no toward the left in graphite; the band around the middle is undecided."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Swatch label="yes 0.96">
          <NoulGauge probability={0.96} />
        </Swatch>
        <Swatch label="no 0.91">
          <NoulGauge probability={0.09} />
        </Swatch>
        <Swatch label="undecided 0.53">
          <NoulGauge probability={0.53} />
        </Swatch>
        <Swatch label="Inline, for cards and rows" className="md:col-span-3">
          <div className="flex flex-wrap items-center gap-6">
            <NoulGauge probability={0.96} inline />
            <NoulGauge probability={0.09} inline />
            <NoulGauge probability={0.53} inline />
            <NoulGauge probability={0.71} inline />
            <NoulGauge probability={0.3} inline hideReadout />
          </div>
        </Swatch>
      </div>
    </Section>
  );
}

function ScoreSection() {
  const levels = ["Minimal", "Low", "Moderate", "High", "Critical"];
  return (
    <Section
      id="score"
      title="Score scale"
      caption="Ordered levels from the legend with a fractional pointer at the score. Per-level probabilities are the bar heights above the scale; the level the score rounds to is ink."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch label="Urgency 3.72 · between High and Critical">
          <ScoreScale
            levels={levels}
            score={3.72}
            probabilities={URGENCY.probabilities}
            confidence={0.77}
          />
        </Swatch>
        <Swatch label="Fraud risk 1.20 · four levels · sm">
          <ScoreScale
            levels={["Unlikely", "Possible", "Likely", "Confirmed"]}
            score={1.2}
            probabilities={FRAUD.probabilities}
            confidence={0.88}
            size="sm"
          />
        </Swatch>
        <Swatch label="Without probabilities">
          <ScoreScale levels={levels} score={0.4} confidence={0.91} />
        </Swatch>
        <Swatch label="Seven levels · pointer at the top end">
          <ScoreScale
            levels={["1", "2", "3", "4", "5", "6", "7"]}
            score={6}
            probabilities={[0.01, 0.01, 0.02, 0.05, 0.1, 0.29, 0.52]}
            confidence={0.69}
          />
        </Swatch>
      </div>
    </Section>
  );
}

function BadgeSection() {
  return (
    <Section
      id="badge"
      title="Decision badge"
      caption="Compact pill formatted by kind. A button: click, Enter or Space opens the full distribution; the last one is a plain badge (distribution={false})."
    >
      <Swatch>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge result={INTENT} question={INTENT_QUESTION} />
          <DecisionBadge result={ESCALATION} question={ESCALATION_QUESTION} />
          <DecisionBadge result={SAFETY} question={SAFETY_QUESTION} />
          <DecisionBadge result={URGENCY} question={URGENCY_QUESTION} />
          <DecisionBadge result={FRAUD} question={FRAUD_QUESTION} />
          <DecisionBadge result={INTENT_WIDE} question={INTENT_WIDE_QUESTION} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DecisionBadge result={INTENT} size="sm" />
          <DecisionBadge result={ESCALATION} size="sm" tone="neutral" />
          <DecisionBadge result={URGENCY} size="sm" tone="outline" />
          <DecisionBadge result={SENTIMENT} tone="neutral" distribution={false} />
        </div>
      </Swatch>
    </Section>
  );
}

function FailoverSection() {
  return (
    <Section
      id="failover"
      title="Failover notice"
      caption="Shown on a decision when a fallback provider answered. Names the fallback, the primary and the cause."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch label="Regular">
          <FailoverNotice
            provider="openai"
            model="gpt-5-mini"
            failover={{ from: "typesafe", reason: "timed out after 2.0 s" }}
          />
        </Swatch>
        <Swatch label="Compact">
          <FailoverNotice
            compact
            provider="anthropic"
            model="claude-haiku"
            failover={{ from: "typesafe", reason: "returned 503" }}
          />
        </Swatch>
      </div>
    </Section>
  );
}

function CardSection() {
  return (
    <Section
      id="card"
      title="Decision card"
      caption="One card for any DecisionResult: question, the kind-specific visual, an optional gate, the failover notice and a mono footer with provider, tokens, cost and latency."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DecisionCard title="Intent" result={INTENT} question={INTENT_QUESTION} thresholds={GATE} />
        <DecisionCard title="Escalation" result={ESCALATION} question={ESCALATION_QUESTION} />
        <DecisionCard
          title="Urgency"
          result={URGENCY}
          question={URGENCY_QUESTION}
          thresholds={GATE}
        />
        <DecisionCard title="Safety" result={SAFETY} question={SAFETY_QUESTION} thresholds={GATE} />
        <DecisionCard
          title="Product area"
          result={INTENT_WIDE}
          question={INTENT_WIDE_QUESTION}
          thresholds={GATE}
          maxRows={4}
        />
        <DecisionCard
          title="Fraud risk"
          result={FRAUD}
          question={FRAUD_QUESTION}
          compact
          hideFooter
        />
      </div>
    </Section>
  );
}

function BundleSection() {
  return (
    <Section
      id="bundle"
      title="Decision bundle"
      caption="Several decisions from one request: a shared header with the request id, batch latency and cost, and a responsive grid of compact cards."
    >
      <DecisionBundle
        title="Triage batch"
        requestId="req_01J8Q4M7X2"
        provider="typesafe:jev-latest"
        latencyMs={118}
        items={BUNDLE}
        thresholds={GATE}
      />
    </Section>
  );
}

function GateEditorSection() {
  const samples = useMemo(() => sampleConfidences(1240), []);
  const [t, setT] = useState<ConfidenceThresholds>(GATE);
  return (
    <Section
      id="gate"
      title="Confidence gate editor"
      caption="Two-thumb slider with the zones above it and live range labels, mono inputs stepping by 0.01, and validation. With a histogram of historical confidences the header shows the share each outcome would receive."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch label="With histogram (1,240 recent decisions)">
          <ConfidenceGateEditor value={t} onChange={setT} histogram={samples} />
        </Swatch>
        <Swatch label="Plain">
          <ConfidenceGateEditor defaultValue={{ review: 0.5, auto: 0.8 }} />
        </Swatch>
        <Swatch label="Invalid: review is not below auto">
          <ConfidenceGateEditor defaultValue={{ review: 0.9, auto: 0.7 }} />
        </Swatch>
        <Swatch label="Disabled · slider only">
          <ConfidenceGateEditor defaultValue={GATE} histogram={samples} hideInputs disabled />
        </Swatch>
      </div>
    </Section>
  );
}

function CalibrationSection() {
  return (
    <Section
      id="calibration"
      title="Calibration chart"
      caption="Reliability diagram: predicted confidence against observed accuracy per bin, with the diagonal a perfectly calibrated model sits on. Red stubs are overconfident bins, green underconfident. Hover or tab to a bin for its numbers."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Swatch label="Bars: width is bin size">
          <CalibrationChart bins={CALIBRATION} />
        </Swatch>
        <Swatch label="Dots: size is bin size">
          <CalibrationChart bins={CALIBRATION} countMode="dots" />
        </Swatch>
      </div>
    </Section>
  );
}

export default function DecisionGallery() {
  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-6 sm:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Decision</h1>
          <p className="max-w-2xl text-xs text-ink-3">
            Typed decisions made visible. Every component here draws real probabilities: the
            distribution behind a choice, P(yes) behind a boolean, the level probabilities behind a
            score, and the confidence that routes a run to auto, review or a person.
          </p>
        </header>
        <RulerSection />
        <DistributionSection />
        <MeterSection />
        <SparkbarSection />
        <NoulSection />
        <ScoreSection />
        <BadgeSection />
        <FailoverSection />
        <CardSection />
        <BundleSection />
        <GateEditorSection />
        <CalibrationSection />
      </div>
    </TooltipProvider>
  );
}
