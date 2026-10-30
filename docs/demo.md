# Judge demo

## Setup

Use Node.js 24+ and run npm ci. Copy .env.example to .env locally, set ANTHROPIC_API_KEY and optionally ANTHROPIC_MODEL (default: claude-haiku-5-5). Keep the key out of chat, screenshots and Git. Run npm run demo:claude and open http://127.0.0.1:4311. Stop any prior server on that port first.

This mode combines live Claude interpretation with recorded Airwallex proof. It uses .presentation-claude-state, a fixed October 7, 2026 clock and a synthetic USD 4,000 expected inflow. The displayed payable is EUR 1.00. The EUR 10,000 narrative obligation was never executed. No Airwallex credential is required for this demo; no financial write is available.

## Walkthrough

| Step | What the judge sees | What it proves |
| --- | --- | --- |
| 1 | Active supplier payable; DueGate shows WAIT. | Insufficient free cash, confirmed inflow expected before cutoff. |
| 2 | Paste “The $4,000 customer payment expected Thursday has been delayed until Monday.” Click Interpret update. | One live Claude request extracts context; no payment action. |
| 3 | Interpreted by Claude: USD 4,000, stored Thursday arrival → Monday calendar day, DELAYED. | Typed facts and temporal uncertainty are visible. |
| 4 | Click Apply update & reevaluate. The separate DueGate decision shows ESCALATE; details show INFLOW_TOO_LATE. | DueGate independently compares the Monday window with the Friday cutoff. Claude did not make the financial decision. |
| 5 | Restore sufficient funding with the existing demo control; inspect the new synthetic FX quote. | Deterministic controls permit EXECUTE eligibility. No real quote or conversion is requested. |
| 6 | Open human approval, review exact terms and confirm. | Human approval binds the exact context. |
| 7 | Demonstrate protected quote change; show invalidation and refusal. | Old approval cannot authorize changed context. |
| 8 | Restore valid conditions and approve the fresh context. | New approval is required. |
| 9 | Show recorded sandbox proof: USD 1.12 conversion, EUR 1.00 transfer; SETTLED and PROCESSING / FUNDED. | Historical evidence only. Do not claim recipient delivery or new execution. |
| 10 | Show duplicate block, then restart the same command and reload without clearing state. | Recorded transfer, protection and audit history persist. |
| 11 | Inspect the audit timeline/export. | Interpretation, deterministic decisions, approval transitions and historical proof are distinct. |

Only Interpret update invokes Claude; startup, rendering and refresh do not. Each click makes at most one request, without retries. Refusal, truncation, invalid facts or ambiguity require human review; never narrate a failed interpretation as successful.

## Verified result and offline alternative

The authorized live example passed: claude-haiku-5-5, HTTP 200, 4,121 ms, end_turn, thinking + text. Thinking was ignored. Validated facts retained DATE precision and produced ESCALATE / INFLOW_TOO_LATE. This is one successful synthetic example, not a reliability claim for arbitrary messages.

npm run demo:presentation runs the offline deterministic interpretation variant without a key, using its own supplied funding example and .presentation-state. Both presentation modes use a fixed clock and synthetic quotes. Recorded proof never gets resubmitted. To rehearse from the start, use a separate checkout; never erase live ledgers or historical evidence to bypass duplicate protection.

## Fresh presentation takes and video automation

Start a new named offline take with npm run demo:presentation -- --presentation-run=take-01. Choose a new name for each fresh recording; allowed names use letters, numbers, underscore and hyphen, up to 64 characters. Stop the existing local server on port 4311 first. A new name starts at WAIT using the existing deterministic fixtures. State is stored in ignored .presentation-runs/<name>. No files are reset or deleted. Restart the same name to preserve its state, recorded-transfer attachment and audit history. This option is restricted to offline presentation, not Claude or live execution. Default demo:presentation still restores .presentation-state.

Use the supplied fundingExample (pre-filled by the UI) rather than the USD 4,000 Claude story in this small offline payable. Interpret → Apply update & reevaluate produces ESCALATE. Load funded scenario → Approve exact payment/confirmation → Change protected quote context produces APPROVAL INVALIDATED. Load funded scenario again → approve/confirm → Show recorded proof produces evidence and BLOCK_DUPLICATE. Test refusal remains no-write. Restart the same take and reload to demonstrate persistent protection.

Stable data-testid values: payment-amount, duegate-decision (data-decision has the exact gate value), funding-context, fx-context, deadline, human-approval-state, approval-invalidated, execution-evidence, duplicate-blocked, audit-timeline, airwallex-status and demo-mode. Existing button data-action values remain unchanged. Audit entries have data-testid=audit-event, data-event=<event code> and unique id=audit-event-<index>. Use [data-event="DECISION_WAIT"], [data-event="DECISION_ESCALATE"], [data-event="APPROVAL_INVALIDATED"], [data-event="RECORDED_PROOF_SHOWN"] and [data-event="BLOCK_DUPLICATE"] with scrollIntoView; select .last() for repeated event types. Existing #execution-evidence and #audit-history anchors are retained.
