# Architecture

## System flow

Finance message → Claude typed facts → schema/domain/temporal validation → deterministic controls → exact human approval → guarded provider adapter → persistent audit evidence.

The demo connects the live interpretation layer to recorded Airwallex proof. Live execution and interpretation have been verified separately; the demo does not submit a new payment.

## Claude interpretation layer

src/claude-funding-interpreter.mts uses the official Anthropic Messages API server-side. It receives only the message, permitted known-inflow fields, reference time and timezone. It has no financial tools, payable authority, beneficiary, approval or execution adapter.

src/claude-response.mts selects exactly one text block, ignores opaque thinking/redacted_thinking and rejects competing text or unsupported blocks. Strict field validation and case-only known-enum normalization precede existing domain/temporal validation. Dates remain full local-day windows; exact times cannot be invented. Refusals, truncation, failures and ambiguity fail closed with code-owned diagnostics.

Live verification passed on claude-haiku-5-5: validated delayed inflow facts led independently to ESCALATE / INFLOW_TOO_LATE. The deterministic interpreter remains available offline; the optional OpenAI adapter is separate and is not the active live demo provider.

## DueGate deterministic control layer

src/decision-engine.mts owns cash/reserve/commitment calculations, inflow timing, cutoff and FX limits, execution-state checks and WAIT / EXECUTE / ESCALATE / BLOCK_DUPLICATE. Inputs use integer minor units, exact ratios and an injected clock. It imports no model or HTTP implementation.

src/approval-store.mts binds approval to payable, treasury/funding context, reserve, commitments, FX policy and quote fingerprints. A protected change invalidates approval. Eligibility, freshness and identity are rechecked; exclusive append-only revisions arbitrate one-use approval.

src/execution-controller.mts orchestrates the gate and locked payloads through the typed adapter. src/execution-ledger.mts durably stores claims and provider IDs; persistent state prevents a second logical execution after restart. Failed/ambiguous submissions require review, not blind automatic retry. Conversion settlement is required before transfer.

## Airwallex execution layer

src/airwallex-adapter.mts defines replaceable operations for balances, beneficiary context, FX quotes, conversion, transfer validation/creation and retrieval. airwallex-sandbox.mts targets only the sandbox; financial writes are disabled by default. Claude cannot invoke it.

Historical proof: one final controlled conversion and one EUR 1.00 transfer, with duplicate/restart protection. Public evidence is sanitized; provider delivery was not proven.

## Application, UI and persistence

DemoService accepts an injected interpreter, validates facts again and applies them only after the operator selects Apply update & reevaluate. Financial decisions and approval/execution controls stay on the server. The UI displays Claude interpretation separately from DueGate's decision.

PresentationService uses a recorded adapter, isolated local state and a fixed clock. Claude mode uses .presentation-claude-state; offline mode uses .presentation-state. Both refuse money-moving operations. Synthetic demo quotes and live model interpretation are explicitly distinguished from recorded execution evidence.

Audit records explain decisions and transitions. Funding diagnostics retain only code-owned reasons, field paths and bounded response metadata, never raw thinking, provider output, input prose or credentials. Raw message text is held temporarily for validation rather than persisted.

## Trust boundaries and limits

The LLM cannot approve payments, select beneficiaries, change policy or decide whether money moves. Schema validation does not prove every financial assertion is true; unknown/ambiguous context still needs human review. Broader live-language evaluation remains future validation work.

The localhost HTTP service checks host/origin/session for mutations; the operator is a demo label, not enterprise authentication. File persistence provides local process/restart arbitration, not distributed transaction guarantees or tamper-proof evidence. Credentials, raw audit exports and live ledgers remain outside Git. Production access control, deployment and recovery operations remain outside this prototype.
