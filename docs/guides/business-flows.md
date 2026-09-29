# Business flows

Four complete workflows for everyday operations ship with FlowAId. Each runs end to end as soon as
you create it, with only a TypeSafe key: an input form, one TypeSafe decision that answers several
questions at once, plain rules, a person when one is needed, and a clear outcome.

Create one from _Templates → Business flows_ or _New workflow → From a template_. What you get is
your own workflow: rename it, change its settings, edit any step, or use it as the start of
something else.

| Flow                                                  | Area             | Settings you can change                   | Asks a person         |
| ----------------------------------------------------- | ---------------- | ----------------------------------------- | --------------------- |
| [Expense approval](#expense-approval)                 | Finance          | `autoApproveLimit`, `receiptRequiredOver` | Manager, 3 days       |
| [Sales lead qualification](#sales-lead-qualification) | Sales            | `salesScore`                              | No                    |
| [IT help desk routing](#it-help-desk-routing)         | IT operations    | `majorIncidentUsers`                      | No                    |
| [Refund request handling](#refund-request-handling)   | Customer service | `autoRefundLimit`, `returnWindowDays`     | Support agent, 2 days |

## Make it yours

- **Settings.** Click the empty canvas to open the workflow panel. Each setting has a description
  and is checked as you type (a limit cannot go below 0). Steps read settings as
  `$vars.<name>`, so one change applies everywhere it is used. _Add a setting_ creates your own;
  a deployment can still override a setting per environment.
- **Name and description.** Also in the workflow panel, or rename from the title at the top.
- **Wording, options and rules.** Select a step. Decision steps hold the questions and their
  options (the spending policy, the refund policy, the lead categories); transform steps hold the
  formulas (the lead score, the response times); outputs hold what the workflow returns, such as
  the reply to a customer.
- **Who approves.** Select the approval step and set its assignees and how long it waits.
- Every canvas carries a _How to make it yours_ note that points at the parts people change most.

The key: the flows declare `TYPESAFE_API_KEY` as optional, so draft runs use the key set on the
server (`TYPESAFE_API_KEY` in `.env.local`). To use a different key, save it under
_Credentials_ and bind it in the workflow's _Settings → Secrets_.

## Expense approval

Checks an expense claim against the spending policy. Claims that are within policy, low risk,
at or under `autoApproveLimit` and (above `receiptRequiredOver`) have a receipt are approved
automatically; every other claim becomes a manager approval under _Human tasks_.

- **Input:** employee, amount (USD), merchant, business purpose, receipt attached.
- **Decision:** category (travel, meals, software, office, training, other), within policy
  (yes or no, with the policy text in the question), risk (none to very high).
- **Outcomes:** approved by policy, approved by a manager, rejected, or not answered in 3 days.

## Sales lead qualification

Qualifies an inbound lead from a contact form, scores it 0–100 and routes it with the next step.

- **Input:** name, email, company, company size, message.
- **Decision:** intent (buy, evaluating, support, spam), fit (poor to excellent), whether the
  message mentions budget or timing.
- **Score:** fit × 20, plus 10 for budget or timing, plus 10 for buying intent, capped at 100.
- **Outcomes:** sales (buying intent and a score of at least `salesScore`), nurture, support or
  discard, each with the next step.

## IT help desk routing

Categorises a ticket, sets its priority and response time, assigns the team, and escalates
possible security incidents to the security on-call.

- **Input:** requester, subject, description, number of people affected.
- **Decision:** category (access, hardware, software, network, security), priority (P4 to P1),
  possible security incident.
- **Rules:** at least `majorIncidentUsers` people affected makes it P1. Response times are 2, 8,
  24 and 72 hours for P1 to P4.
- **Outcomes:** escalated to security (P1, 1 hour) or assigned to a team queue with its priority
  and response time.

## Refund request handling

Checks a refund request against the refund policy, refunds small clear cases, declines requests
outside the policy, and sends the rest to an agent. Every outcome carries the reply to send the
customer.

- **Input:** customer email, order number, order total (USD), days since delivery, reason.
- **Decision:** reason (damaged, wrong item, not as described, late, changed mind, other),
  eligible under the policy (a change of mind only within `returnWindowDays`), fraud risk.
- **Rules:** eligible, low risk and at or under `autoRefundLimit` refunds automatically;
  ineligible and low risk declines automatically; anything else goes to an agent.
- **Outcomes:** refunded (by policy or an agent), declined (by policy or an agent), or pending
  when no one answered in 2 days.

## Put one to work

1. **Try it** from the builder's Run tab: fill in the form and press _Run draft_. The Output tab
   says how the run ended; the trace shows each answer's probabilities.
2. **Publish** a version and deploy it to an environment.
3. **Call it** from your systems: the REST API, the SDK, a webhook trigger or an MCP tool (see
   [Calling workflows](calling-workflows.md)).
4. **Measure it**: build an evaluation set from real runs and gate the next version on it.
