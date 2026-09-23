import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TooltipProvider } from "@/primitives/Tooltip";
import {
  CalibrationPanel,
  DecisionContractCard,
  DecisionContractEditor,
  DecisionReceiptView,
  EvidencePacketView,
  LiveMenuPreview,
  RoutingPolicyEditor,
  ShadowModeReport,
  TokenBudgetMeter,
  type ContractIssue,
  type JevContractBody,
} from "./index";
import {
  AGENT_DISTRIBUTION,
  AGENT_MENU,
  AGENT_ROUTER_V2,
  FIXTURE_NOW,
  QUEUE_LABELS,
  REPLY_SAFETY_V1,
  ROUTER_ALARMS,
  ROUTER_CALIBRATION,
  ROUTER_DEPLOYMENTS,
  ROUTER_HASH,
  ROUTER_PACKET_IMPROVED,
  ROUTER_PACKET_REPORT,
  ROUTER_RECEIPT,
  ROUTER_RECOMMENDATION,
  SAFETY_RECEIPT,
  SHADOW_ECONOMICS,
  SUPPORT_ROUTER_V4,
  SUPPORT_ROUTER_V5_DRAFT,
  URGENCY_SHADOW_RECEIPT,
  URGENCY_V1,
  buildShadowComparisons,
} from "./fixtures";

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
        {caption ? <p className="max-w-3xl text-xs text-ink-3">{caption}</p> : null}
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

function EditorDemo() {
  const [draft, setDraft] = useState<JevContractBody>(SUPPORT_ROUTER_V5_DRAFT);
  const [issues, setIssues] = useState<ContractIssue[]>([]);
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 font-mono text-2xs text-ink-3">
        onValidate → {errors} error{errors === 1 ? "" : "s"}, {issues.length - errors} warning
        {issues.length - errors === 1 ? "" : "s"}
      </p>
      <DecisionContractEditor
        value={draft}
        defaultValue={SUPPORT_ROUTER_V5_DRAFT}
        onChange={setDraft}
        onValidate={setIssues}
      />
    </div>
  );
}

function RoutingDemo() {
  const [policy, setPolicy] = useState(SUPPORT_ROUTER_V4.routing);
  return <RoutingPolicyEditor value={policy} onChange={setPolicy} probe={0.93} />;
}

/**
 * Jev engineering gallery (JEV_ENGINEERING.md §17): the Intelligent Support
 * Triage workflow after its upgrade. Every colour is a token, so the page
 * reads the same under the playground's light and dark themes.
 */
export default function JevGallery() {
  const comparisons = useMemo(() => buildShadowComparisons(), []);
  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="m-0 text-xl font-semibold tracking-tight text-ink">Jev engineering</h1>
          <p className="m-0 max-w-3xl text-sm text-ink-2">
            Contracts, packets, routing, receipts, shadow mode and calibration for contract-bound
            decisions. Sample data: Intelligent Support Triage (support.router@4, the reply-safety
            gate and a live agent menu). Switch the theme in the sidebar to review dark mode.
          </p>
        </header>

        <Section
          id="contract-card"
          title="DecisionContractCard"
          caption="One contract version: question shape, outcomes with escape hatches, consequence and authority, zones per class, deployments per environment, 7-day route mix and ECE."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <DecisionContractCard
              contract={SUPPORT_ROUTER_V4}
              status="approved"
              hash={ROUTER_HASH}
              deployments={ROUTER_DEPLOYMENTS}
              stats={{
                volume7d: 21_870,
                routeShare: ROUTER_CALIBRATION.routeShare,
                ece: 0.034,
                openAlarms: 1,
              }}
            />
            <DecisionContractCard
              contract={REPLY_SAFETY_V1}
              status="in_review"
              deployments={[
                {
                  environment: "dev",
                  protected: false,
                  active: { version: 1, stage: "active" },
                  candidate: null,
                },
              ]}
            />
            <DecisionContractCard
              contract={AGENT_ROUTER_V2}
              status="approved"
              onOpen={() => undefined}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <DecisionContractCard contract={URGENCY_V1} status="in_review" />
          </div>
        </Section>

        <Section
          id="contract-editor"
          title="DecisionContractEditor"
          caption="Draft support.router@5: a refund outcome whose high consequence exceeds the low authority ceiling, a four-word description and a missing changelog. Fix them to watch the summary clear."
        >
          <Swatch>
            <EditorDemo />
          </Swatch>
        </Section>

        <Section
          id="routing"
          title="RoutingPolicyEditor"
          caption="Confidence × consequence: which cells act (auto), verify (improve), escalate (human, low confidence) or stay human (consequence). Irreversible is locked; classes without own zones use Table V's illustrative defaults (hatched). The marker is a receipt at 0.93."
        >
          <div className="grid gap-4">
            <Swatch label="support.router@4 (editable)">
              <RoutingDemo />
            </Swatch>
            <Swatch label="support.reply_safety@1 (high, no improve action: the improve zone escalates)">
              <RoutingPolicyEditor
                defaultValue={REPLY_SAFETY_V1.routing}
                probe={0.88}
                matrixOnly
                readOnly
              />
            </Swatch>
          </div>
        </Section>

        <Section
          id="packet"
          title="EvidencePacketView"
          caption="The packet as sent after the improve round: Table IV sections, field descriptions, provenance, data classes, a stale sign-in log and the token budget against maxTokens and the 32k limit."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Swatch>
              <EvidencePacketView
                packet={ROUTER_PACKET_IMPROVED}
                spec={SUPPORT_ROUTER_V4.state}
                report={ROUTER_PACKET_REPORT}
                packetHash={ROUTER_RECEIPT.stateReference.packetHash}
                now={FIXTURE_NOW}
              />
            </Swatch>
            <Swatch label="TokenBudgetMeter">
              <TokenBudgetMeter tokens={412} maxTokens={2000} />
              <TokenBudgetMeter tokens={1810} maxTokens={2000} />
              <TokenBudgetMeter tokens={9400} maxTokens={8000} />
              <TokenBudgetMeter tokens={33_000} maxTokens={30_000} />
            </Swatch>
          </div>
        </Section>

        <Section
          id="receipt"
          title="DecisionReceiptView"
          caption="Judge → policy → execute → record. The router's canary auto route; the reply-safety gate escalated and overridden by a reviewer; a score contract evaluated in shadow."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Swatch>
              <DecisionReceiptView receipt={ROUTER_RECEIPT} labels={QUEUE_LABELS} />
            </Swatch>
            <Swatch>
              <DecisionReceiptView
                receipt={SAFETY_RECEIPT}
                labels={{ true: "Safe to send", false: "Not safe" }}
              />
            </Swatch>
            <Swatch>
              <DecisionReceiptView receipt={URGENCY_SHADOW_RECEIPT} />
            </Swatch>
          </div>
        </Section>

        <Section
          id="shadow"
          title="ShadowModeReport"
          caption="support.ticket_router@1 in shadow beside the LLM classifier for four weeks: agreement, confusion matrix, accuracy of both against human labels, measured cost and latency, disagreement samples."
        >
          <Swatch>
            <ShadowModeReport
              comparisons={comparisons}
              window="Aug 1 – Aug 29, 2026"
              economics={SHADOW_ECONOMICS}
              labels={QUEUE_LABELS}
            />
          </Swatch>
        </Section>

        <Section
          id="calibration"
          title="CalibrationPanel"
          caption="support.router@4 in production, low class, rolling 7 days: reliability, ECE and auto precision, per-outcome breakdown, drift alarms and a threshold recommendation that is never applied automatically."
        >
          <Swatch>
            <CalibrationPanel
              kind="choice"
              metrics={ROUTER_CALIBRATION}
              contract={{
                key: "support.router",
                version: 4,
                hash: ROUTER_HASH,
                origin: "registry",
              }}
              segment={{
                environment: "production",
                consequenceClass: "low",
                language: "en",
                outcome: null,
                resolvedModel: "jev-1.13.0",
                mode: "live",
              }}
              window="rolling 7d · Sep 16 – Sep 23"
              alarms={ROUTER_ALARMS}
              recommendation={ROUTER_RECOMMENDATION}
              onAcceptRecommendation={() => undefined}
              labels={QUEUE_LABELS}
            />
          </Swatch>
        </Section>

        <Section
          id="menu"
          title="LiveMenuPreview"
          caption="support.agent_router@2 over the live roster: 38 candidates filtered by code to 12, keyed o1…o12, with review and none always kept. Options past the visible limit fold into an overflow."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Swatch label="With the decision's distribution">
              <LiveMenuPreview
                optionSet={AGENT_MENU}
                now={FIXTURE_NOW}
                distribution={AGENT_DISTRIBUTION}
                selectedKey="o3"
                visibleLimit={5}
              />
            </Swatch>
            <Swatch label="Stale set (older than maxAgeMs)">
              <LiveMenuPreview optionSet={AGENT_MENU} now={FIXTURE_NOW + 95_000} visibleLimit={3} />
            </Swatch>
          </div>
        </Section>
      </div>
    </TooltipProvider>
  );
}
