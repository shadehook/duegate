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
