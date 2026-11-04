# Architecture

## System flow

Finance message → Claude typed facts → schema/domain/temporal validation → deterministic controls → exact human approval → guarded provider adapter → persistent audit evidence.

The demo connects the live interpretation layer to recorded Airwallex proof. Live execution and interpretation have been verified separately; the demo does not submit a new payment.

## Claude interpretation layer

src/claude-funding-interpreter.mts uses the official Anthropic Messages API server-side. It receives only the message, permitted known-inflow fields, reference time and timezone. It has no financial tools, payable authority, beneficiary, approval or execution adapter.

src/claude-response.mts selects exactly one text block, ignores opaque thinking/redacted_thinking and rejects competing text or unsupported blocks. Strict field validation and case-only known-enum normalization precede existing domain/temporal validation. Dates remain full local-day windows; exact times cannot be invented. Refusals, truncation, failures and ambiguity fail closed with code-owned diagnostics.

Live verification passed on claude-haiku-5-5: validated delayed inflow facts led independently to ESCALATE / INFLOW_TOO_LATE. The deterministic interpreter remains available offline; the optional OpenAI adapter is separate and is not the active live demo provider.

## DueGate deterministic control layer

src/decision-engine.mts owns cash/reserve/commitment calculations, inflow timing, cutoff and FX limits, execution-state checks and WAIT / EXECUTE / REAPPROVAL_REQUIRED / ESCALATE / BLOCK_DUPLICATE. Inputs use integer minor units, exact ratios and an injected clock. It imports no model or HTTP implementation.

src/approval-context.mts builds a version-2 multi-source approval manifest from an explicit field projection. Payment identity, Airwallex wallet/quote facts, DueGate funding/reserve/FX/cutoff policy and optional T:0 selected claims are bound. Each claim records source, approved value, comparison, units/currency and relevant entity/report period. src/approval-store.mts persists and fingerprints that manifest. MUST_EQUAL protects existing exact terms; MINIMUM allows a selected accounting measure to move while still meeting its explicit threshold. The original approval fingerprint remains stable during revalidation. A material policy violation invalidates approval. Eligibility, freshness and identity are rechecked; exclusive append-only revisions arbitrate one-use approval.

src/execution-controller.mts orchestrates the gate and locked payloads through the typed adapter. src/execution-ledger.mts durably stores claims and provider IDs; persistent state prevents a second logical execution after restart. Failed/ambiguous submissions require review, not blind automatic retry. Conversion settlement is required before transfer.

## Airwallex execution layer

src/airwallex-adapter.mts defines replaceable operations for balances, beneficiary context, FX quotes, conversion, transfer validation/creation and retrieval. airwallex-sandbox.mts targets only the sandbox; financial writes are disabled by default. Claude cannot invoke it.

Historical proof: one final controlled conversion and one EUR 1.00 transfer, with duplicate/restart protection. Public evidence is sanitized; provider delivery was not proven.

## Application, UI and persistence

DemoService accepts an injected interpreter, validates facts again and applies them only after the operator selects Apply update & reevaluate. Financial decisions and approval/execution controls stay on the server. The UI displays Claude interpretation separately from DueGate's decision.

PresentationService uses a recorded adapter, isolated local state and a fixed clock. Claude mode uses .presentation-claude-state; offline mode uses .presentation-state. Both refuse money-moving operations. Synthetic demo quotes and live model interpretation are explicitly distinguished from recorded execution evidence.

Audit records explain decisions and transitions. Funding diagnostics retain only code-owned reasons, field paths and bounded response metadata, never raw thinking, provider output, input prose or credentials. Raw message text is held temporarily for validation rather than persisted.

## Optional T:0 accounting check

`src/t0-accounting-adapter.mts` is a server-only read client for one explicitly configured supplier bill. It allows only GET `/v1/entities`, `/v1/vendor-bills/{external_id}` and `/v1/vendors/{external_id}` at `https://api.t0.ai`, with bearer authentication from a caller-supplied `T0_API_KEY`. It has no arbitrary URL, listing or write method and makes no retries. These exact-record routes require no pagination. Entity membership and returned record identities must match the configured binding. Bounded response bodies, request/body timeouts and code-owned errors prevent provider prose or credentials from entering logs or UI.

`src/accounting-context.mts` validates the normalized identity, provenance, USD amount, status and dates. Numeric total tokens are preserved before JSON number rounding and converted to integer cents without rounding. Date-only due/paid dates remain date-only. The single-record endpoint does not supply `as_of`; capture time is not a source freshness guarantee. Record reads can lag a nightly export, unlike GL reports. See [T:0 API](https://docs.t0.ai/api/t0-api) and [supplier bill lookup](https://docs.t0.ai/api/t0-api/get/v1/vendor-bills/external_id).

Only the explicitly bound paid obligation is passed to an isolated evaluation of the existing engine. Its existing `payable.status === "paid"` rule yields `BLOCK_DUPLICATE / EXECUTION_BLOCKED`. The evaluation has a code-owned, permanently closed cutoff, zero synthetic funding and an explicitly unmapped beneficiary; none is inferred from accounting dates or treated as current wallet data. This input and its execution key never leave the accounting function. Non-paid records return `NOT_EVALUATED`, never execution permission. The function has no provider, approval or ledger capabilities; it cannot attach transfer IDs, replace wallet cash or create an execution claim.

The optional `--t0-recorded` panel is a separate USD 4,998.13 accounting check. It is not the EUR payable. It reads only `fixtures/t0-paid-bill.json`, which records sanitized facts observed on 2026-10-31: paid status, due date 2026-10-20, paid date 2026-10-26 and a verified vendor link. It is restricted to offline presentation, exposes only a hashed reference, and does not alter the EUR story or its audit history. Its safe result is included separately in the optional audit export. There is no live T:0 browser action; live adapter verification is server-side only.

## Trust boundaries and limits

**Optional financial-statement veto.** T:0 financial statements are generated from the general ledger at request time. DueGate does not invent a statement-level `as_of` timestamp; it records the report period and local evidence capture time. The server-side `--t0-statements` option uses only the documented [balance sheet](https://docs.t0.ai/api/t0-api/get/v1/reports/balance-sheet) and [cash flow](https://docs.t0.ai/api/t0-api/get/v1/reports/cash-flow) GETs. Each pins the configured entity and the same inclusive window. This implementation supports one USD monthly column, 100 atoms per dollar. It selects the asset section's `type_group_bank` group and the `net_change` subtotal by exact structural identifiers. Absent or null protected cells, ambiguous rows, wrong currency/scale or an unexpected response fail closed. The two GETs are separate observations, not an atomic GL snapshot.

For an opted-in payment, DueGate snapshots the UTC month through the proposal date, includes the entity reference, currency, both period boundaries and both signed atom values in the human approval fingerprint, and re-reads the **same window** at approval and before submission. Numeric claims require an explicit policy at definition time; missing or unsupported policies fail validation before fingerprinting or statement reads. The server deliberately configures MUST_EQUAL for bank-group cash and net cash change. An explicitly supplied StatementPolicy can instead bind a MINIMUM for either measure; no threshold is inferred from T:0 or Claude. Raw reports, unrelated rows, report metadata, unprotected totals and capture timestamps are not fingerprinted. Unrelated accounting changes do not invalidate approval. `FINANCIAL_CONTEXT_OK` grants no permission. Material protected violations return `REAPPROVAL_REQUIRED / FINANCIAL_CONTEXT_CHANGED`, with only changed protected fields, approved/current values, policy, threshold and integer minor units. Missing/malformed/unavailable context returns ESCALATE / FINANCIAL_CONTEXT_INCOMPLETE. An uncovered decision date returns ESCALATE / FINANCIAL_CONTEXT_OUT_OF_PERIOD. If a maximum capture age is explicitly bound, expired or future-dated capture evidence returns ESCALATE / FINANCIAL_CONTEXT_STALE; capture time is not a provider as_of or a cross-system freshness guarantee. A bound approval cannot be used with the reader removed after restart. Every non-EXECUTE gate prevents the next financial write. If a new failure is discovered after conversion, the existing ledger/review protections remain in force: top-level ESCALATE, no supplier transfer, retained conversion evidence and a truthful nonzero write-attempt count. No already-performed conversion is represented as zero movement. Reads do not lock the external ledger against later postings.

The LLM cannot approve payments, select beneficiaries, change policy or decide whether money moves. Schema validation does not prove every financial assertion is true; unknown/ambiguous context still needs human review. Broader live-language evaluation remains future validation work.

The localhost HTTP service checks host/origin/session for mutations; the operator is a demo label, not enterprise authentication. File persistence provides local process/restart arbitration, not distributed transaction guarantees or tamper-proof evidence. Credentials, raw audit exports and live ledgers remain outside Git. Production access control, deployment and recovery operations remain outside this prototype.

## Canonical decisions and compatibility

WAIT means execution conditions are not ready while any existing approval remains valid; the initial story has no approval yet. EXECUTE is eligibility until the independent human-approval and ledger gates also pass. REAPPROVAL_REQUIRED means a material selected-claim violation. ESCALATE means unusable evidence or an investigation/review condition. BLOCK_DUPLICATE preserves the executed/paid-obligation block. FAILED_REVIEW_REQUIRED remains an internal execution state; its top-level decision is ESCALATE.

New approval records persist manifest version 2. Legacy pending/approved records without a verifiable manifest fail closed for fresh review; no historical records are rewritten. USED approvals, execution keys, provider request identifiers and persisted transfer protection retain their semantics. The manifest is the approval contract; the separate execution digest still locks the exact submitted payload. Selected-claim revalidation does not relax payload mutation guards.

The UI and sanitized audit expose structured changed-field evidence and approval version, not whole provider reports. Statement veto evidence survives restart. Provider write-attempt counts distinguish an untouched execution from a stopped execution after conversion. Claude remains fact extraction only, T:0 remains read-only, and accounting cash never replaces Airwallex spendable wallet cash.
