# Judge demo

## Setup for judging and V3

Use Node.js 24+ and run `npm ci`. Stop any existing server on port 4311, then start
an offline presentation with the recorded T:0 panels and a fresh run name:

```sh
npm run demo:presentation -- --presentation-run=v3-take-01 --t0-recorded
```

Open [DueGate locally](http://127.0.0.1:4311/). No credentials or live provider calls
are needed. This mode uses recorded evidence, synthetic quotes and a fixed demo
clock. No financial write is available. The displayed payable is EUR 1.00; the
EUR 10,000 narrative obligation was never executed. Use a new name for each fresh
take, and the same name for the restart scene. Do not delete historical state.

## Walkthrough

| Step | What the judge sees | What it proves |
| --- | --- | --- |
| 1 | Immediately after the introduction: Protected approval context. accounting_cash · t0: approved USD 310,000.00, current USD 218,000.00, policy MINIMUM USD 250,000.00. | **Synthetic policy demonstration, not live T:0 observations.** The selected claim violates its bound minimum. |
| 2 | REAPPROVAL_REQUIRED; reason FINANCIAL_CONTEXT_CHANGED; Airwallex writes attempted: 0. | DueGate decides whether approval still holds. This separate example does not execute or change the EUR demo payable. |
| 3 | Explain the selected-claim boundary beneath the story. | Approval is bound to selected claims across payment state, Airwallex context, optional T:0 context, and DueGate policy. Only those selected claims are revalidated. An unrelated accounting change does not invalidate approval. |
| 4 | Continue to the supplier payable below: WAIT, with cash/funding/FX/deadline details. | The secondary example shows insufficient free cash and a confirmed inflow expected before cutoff. Accounting cash does not replace Airwallex spendable balance. |
| 5 | Click Interpret update using the pre-filled funding example, then inspect the facts. | The offline deterministic interpreter extracts facts only. Optional live-Claude mode is separate; never imply Claude activity in this offline take. |
| 6 | Click Apply update & reevaluate: ESCALATE / INFLOW_TOO_LATE. | DueGate independently evaluates funding timing against the cutoff. |
| 7 | Load funded scenario; inspect the synthetic FX quote. | Restored execution conditions permit EXECUTE eligibility. No real quote or conversion is requested. |
| 8 | Open human approval, review the bound terms and confirm. | Human approval is required for financial execution; eligibility alone never authorizes money movement. |
| 9 | Change protected quote context; show approval invalidated, REAPPROVAL_REQUIRED, and Test refusal. | The old approval cannot authorize changed exact quote terms. A protected claim change requires reapproval when it violates the bound policy. |
| 10 | Load funded scenario again and approve the fresh context. | Fresh context requires fresh human approval. |
| 11 | Show recorded sandbox proof: USD 1.12 → EUR 1.00, conversion SETTLED, transfer PROCESSING / FUNDED. | Historical evidence only, not new execution. Recipient delivery is not proven. |
| 12 | Show BLOCK_DUPLICATE; restart the same named command and reload without clearing state. | Recorded transfer, duplicate protection and audit history persist. |
| 13 | Inspect audit history/export and the secondary accounting disclosures. | Synthetic policy evidence, interpretation, approval transitions and historical execution remain distinct. The recorded paid USD T:0 bill is not the EUR demo payable; the recorded statement/period check remains expandable. |

T:0 supplies read-only accounting context; it does not authorize payment. DueGate
makes deterministic decisions. Airwallex supplies spendable balance and the financial
execution rail. No new financial write is needed for judging.

## V3 recording guide

Target **2:15–2:45**; the following plan totals **2:30**. Keep the synthetic,
recorded and live boundaries visible in narration as well as on screen.

| Scene | Time | Screen / narration |
| --- | --- | --- |
| 1 — Problem | 0:00–0:12 | “This payment was approved earlier. Before execution, one protected financial fact changed.” Introduce this as the synthetic policy example. |
| 2 — Hero proof | 0:12–0:40 | Approved USD 310,000; current USD 218,000; MINIMUM USD 250,000. Show REAPPROVAL_REQUIRED / FINANCIAL_CONTEXT_CHANGED and Airwallex writes attempted: 0. These are not live T:0 observations. |
| 3 — Architecture boundary | 0:40–0:55 | T:0 → current accounting context; DueGate → approval validity decision; Airwallex → financial execution. This recording uses offline evidence; accounting cash is not Airwallex spendable balance. |
| 4 — Secondary WAIT example | 0:55–1:15 | Briefly show WAIT and funding/timing controls, then the supplied delayed-funding update and ESCALATE. Use the deterministic interpreter; no live Claude request is needed. |
| 5 — Human approval / changed terms | 1:15–1:45 | Load funded scenario, approve, change protected quote context, show invalidation/refusal, then load fresh conditions and approve again. |
| 6 — Recorded Airwallex proof | 1:45–2:03 | USD 1.12 → EUR 1.00; conversion SETTLED; transfer PROCESSING / FUNDED. Historical proof, no new execution; recipient delivery not proven. |
| 7 — Duplicate / restart / audit | 2:03–2:20 | BLOCK_DUPLICATE, restart the same run name, reload, and show the persisted protection and audit evidence. |
| 8 — Close | 2:20–2:30 | “Airwallex moves the money. DueGate verifies that the approval to move it is still valid.” |

For a clean audit timeline, use the existing command pattern:

```sh
npm run demo:presentation -- --presentation-run=<fresh-name> --t0-recorded
```

Replace `<fresh-name>` with a new name such as `v3-take-02`. Never delete or reset
historical ledgers, proof files or V1/V2 recordings. Restart with that **same** name
only when demonstrating persistence. This guide does not require UI changes.

## Optional live-Claude walkthrough

This is a separate mode, not part of the offline V3 take. Copy `.env.example` to
`.env` locally, set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`
(default: claude-haiku-5-5). Keep credentials out of chat, screenshots and Git.
Stop the previous server, run `npm run demo:claude`, and open the local demo.
Do not combine this mode with `--t0-recorded` or a named presentation run.

It uses `.presentation-claude-state`, a fixed October 7, 2026 clock and a synthetic
USD 4,000 expected inflow. Paste “The $4,000 customer payment expected Thursday has
been delayed until Monday.” Interpret update makes at most one live Claude request,
without retries. The facts show USD 4,000, stored Thursday arrival → Monday calendar
day, DELAYED. Apply update produces the independent DueGate result
ESCALATE / INFLOW_TOO_LATE against the Friday cutoff, preserving temporal uncertainty.
Continue through the same funding restoration, approval, recorded proof and restart
controls. Claude interprets facts only; it never approves or executes payments.

Only Interpret update invokes Claude; startup, rendering and refresh do not.
Refusal, truncation, invalid facts or ambiguity require human review; never narrate
a failed interpretation as successful. Airwallex evidence remains recorded, and no
financial write is available.

## Verified result and offline alternative

The authorized live example passed: claude-haiku-5-5, HTTP 200, 4,121 ms, end_turn, thinking + text. Thinking was ignored. Validated facts retained DATE precision and produced ESCALATE / INFLOW_TOO_LATE. This is one successful synthetic example, not a reliability claim for arbitrary messages.

npm run demo:presentation runs the offline deterministic interpretation variant without a key, using its own supplied funding example and .presentation-state. Both presentation modes use a fixed clock and synthetic quotes. Recorded proof never gets resubmitted. For a fresh offline rehearsal, use a new named presentation run; never erase live ledgers or historical evidence to bypass duplicate protection.

## Fresh presentation takes and video automation

Start a new named offline take with npm run demo:presentation -- --presentation-run=take-01 --t0-recorded. Choose a new name for each fresh recording; allowed names use letters, numbers, underscore and hyphen, up to 64 characters. Stop the existing local server on port 4311 first. The selected-claim panel leads the page; the separate payable starts at WAIT using the existing deterministic fixtures. State is stored in ignored .presentation-runs/<name>. No files are reset or deleted. Restart the same name to preserve its state, recorded-transfer attachment and audit history. This option is restricted to offline presentation, not Claude or live execution. Default demo:presentation still restores .presentation-state.

Use the supplied fundingExample (pre-filled by the UI) rather than the USD 4,000 Claude story in this small offline payable. Interpret → Apply update & reevaluate produces ESCALATE. Load funded scenario → Approve exact payment/confirmation → Change protected quote context produces APPROVAL INVALIDATED and REAPPROVAL_REQUIRED. Load funded scenario again → approve/confirm → Show recorded proof produces evidence and BLOCK_DUPLICATE. Test refusal remains no-write. Restart the same take and reload to demonstrate persistent protection.

Stable data-testid values: payment-amount, duegate-decision (data-decision has the exact gate value), funding-context, fx-context, deadline, human-approval-state, approval-invalidated, execution-evidence, duplicate-blocked, audit-timeline, airwallex-status and demo-mode. Existing button data-action values remain unchanged. Audit entries have data-testid=audit-event, data-event=<event code> and unique id=audit-event-<index>. Use [data-event="DECISION_WAIT"], [data-event="DECISION_ESCALATE"], [data-event="APPROVAL_INVALIDATED"], [data-event="RECORDED_PROOF_SHOWN"] and [data-event="BLOCK_DUPLICATE"] with scrollIntoView; select .last() for repeated event types. Existing #execution-evidence and #audit-history anchors are retained.

## Optional T:0 already-paid obligation check

Run `npm run demo:presentation -- --presentation-run=t0-take-01 --t0-recorded` with a new take name. The selected-claim story appears first; the EUR story below it still starts at WAIT. Open `http://127.0.0.1:4311/#t0-accounting-check` for the separate, optional accounting panel. Commands without --t0-recorded omit the accounting panels and retain their behavior. Combining `--t0-recorded` with Claude or a non-presentation mode is rejected.

The panel shows **recorded T:0 sandbox evidence**, not live activity: a USD 4,998.13 supplier bill marked paid, due 2026-10-20 and paid 2026-10-26. DueGate validates the explicit recorded binding and independently invokes its existing paid-payable duplicate rule. The result is `BLOCK_DUPLICATE / EXECUTION_BLOCKED`, with no FX quote, conversion or transfer request for this check. No approval, beneficiary mapping or execution claim is created. Accounting status does not prove recipient delivery or an Airwallex transfer. This is a different obligation from the EUR demo.

The entire T:0 presentation path is offline and needs no credentials. Selectors are `t0-accounting-check`, `t0-evidence-mode`, `t0-obligation-amount` and `t0-decision`; the latter has `data-decision`. The selected-claim panel follows the introduction; the already-paid obligation panel remains above the audit timeline. The optional audit export contains separate sanitized `accounting_check` and `statement_scene` results. Original financial evidence and video files are unchanged.

For a separately authorized server-side live read, configure `T0_API_KEY`, `T0_ENTITY_ID` and `T0_VENDOR_BILL_ID` only in ignored `.env`. The username is not used by the bearer API. Construct `T0AccountingAdapter` with those exact IDs, `expectedAmountMinor: 499813n` and `expectedCurrency: 'USD'`; call `loadBill()` once, then `evaluateAccountingCheck(context, binding, 'live')`. Log only the latter's sanitized result or code-owned errors, never the raw context or credentials. A missing/wrong entity or record, changed amount/currency, invalid dates or unsupported status fails validation. An open bill grants no execution permission. There is no automatic bill search or live T:0 UI mode.

Accounting records can lag a nightly export. All 14 bills observed during discovery were paid USD records; none was an open EUR obligation matching the existing demo. Do not use this evidence to claim broader ERP integration, real-time settlement confirmation or T:0-backed funding for the EUR story.

### Selected-claim reapproval and statement period recheck

Run `npm run demo:presentation -- --t0-recorded --presentation-run=statement-demo` with a fresh take name and open [the protected-context panel](http://127.0.0.1:4311/#t0-financial-context). The hero is explicitly synthetic: approved accounting cash USD 310,000.00, MINIMUM USD 250,000.00, current USD 218,000.00. The actual deterministic claim comparator returns REAPPROVAL_REQUIRED / FINANCIAL_CONTEXT_CHANGED, names only accounting_cash, and reports Airwallex writes attempted: 0. These are demonstration values, not a new live T:0 observation. The manifest also binds synthetic payment/Airwallex terms and DueGate policy; no claim authorizes a live payment.

The same panel keeps the original recorded statement in an expandable disclosure: on October 30 its protected values match; October 31 is outside its period and returns ESCALATE / FINANCIAL_CONTEXT_OUT_OF_PERIOD. Missing/stale/ambiguous evidence also escalates; it is never relabeled as a material change. The separate paid USD bill still returns BLOCK_DUPLICATE and is not mapped to the EUR payable.

The required unrelated-change test is named **UNRELATED ACCOUNTING CHANGE DOES NOT INVALIDATE APPROVAL OR CHANGE ITS FINGERPRINT** in tests/selected-claims.test.mts. It changes unbound accounting rows, totals, metadata and capture time while preserving the selected claims.

Automation selectors: `t0-financial-context`, `reapproval-evidence`, `changed-claim`, plus the existing `duegate-decision` and `approval-invalidated`. Current approval and execution safeguards are exercised with mocked adapters only. The V1/V2 recordings retain their historical copy and are not regenerated.

Recorded on November 2, 2026 at 23:05:53 UTC: `GET /v1/reports/balance-sheet` and `GET /v1/reports/cash-flow` both returned HTTP 200 for October 1–30 (one monthly USD column). Bank-group cash **216,444.33**; total assets **133,050.90**; total liabilities **2,808.06**; operating cash flow and net cash change both **−17,554.43**. Only bank-group cash and net change are protected money fields. These are accounting figures, not Airwallex spendable balances. The subsequent date is a replay, not evidence of any new T:0 posting. The live server policy is opt-in via `--t0-statements`, separate from offline presentation; it neither enables financial writes nor changes the existing authorization requirement.

Implementation verification on 2026-10-31 passed: 394/394 tests, strict typecheck and frontend build. One bounded live verification used five GETs, all HTTP 200: two to resolve and pin the previously observed sanitized record reference in local configuration, then three through the adapter (entity, exact bill, linked vendor). The adapter returned USD 4,998.13 / paid and the existing engine returned `BLOCK_DUPLICATE / EXECUTION_BLOCKED`. No T:0 writes, Airwallex calls or Claude calls occurred. Subsequent adapter reads use only the configured exact IDs; the one-time mapping lookup is not part of the application.
