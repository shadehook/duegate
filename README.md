# DueGate

DueGate is a pre-execution payment control layer for Airwallex. It revalidates
approved supplier payments against current payment state, execution conditions,
and selected external financial claims immediately before money moves.

Approval is not permanent. DueGate only executes while the conditions behind that
approval are still valid.

DueGate binds payment approval to explicit financial evidence and rechecks that
evidence at the execution boundary it controls.

Built for the Airwallex Agentic Banking Hackathon.
Hackathon prototype / sandbox validated. **Not production ready.**

## Why DueGate exists

A payment can be approved with enough cash, acceptable FX, valid timing and correct
beneficiary details. Before execution, funding may slip, FX may go stale, the cutoff
may pass, details may change—or execution may already have been attempted.

**DueGate revalidates that context before money moves.**

## Core decisions

| Decision | Meaning |
| --- | --- |
| WAIT | Execution conditions are not ready; any existing approval must remain valid. The initial demo waits for a confirmed inflow before approval. |
| EXECUTE | Financial controls and selected claims pass. The execution gate also requires valid human approval and an unused ledger claim. |
| REAPPROVAL_REQUIRED | A protected claim violates its approved policy; the old approval cannot authorize execution. |
| ESCALATE | Required evidence is missing, stale, out of period, ambiguous, malformed, unavailable, or requires investigation. |
| BLOCK_DUPLICATE | Payment is completed or has an attached transfer; no second execution. |

## How it works

Payment obligation → current financial context → **DueGate decision** → exact human
approval → Airwallex execution → audit evidence.

- **T:0:** read-only accounting / financial context.
- **DueGate:** deterministic execution-governance layer.
- **Airwallex:** spendable balance, FX and execution rail.
- **Claude:** interpretation only, never financial authority.

Claude can supply typed context from unstructured updates. It is not required for
DueGate's deterministic controls.

## Approval binding

Approval binds a **versioned multi-source manifest**: selected payment, Airwallex,
DueGate policy and optional T:0 claims. Each claim records its source, normalized
approved value, comparison rule and relevant units/provenance. The fingerprint
covers this manifest, not raw reports or provider metadata.

Only material violations of protected claims require reapproval. Unrelated
accounting changes do not invalidate approval. EXECUTE eligibility alone never
authorizes money movement.

## Airwallex integration

Airwallex is the financial execution layer: balances, beneficiary lookup, FX quotes,
conversion, transfer validation/creation and status reads.

Writes are disabled by default. A persistent ledger prevents duplicate execution
across restart; failed or ambiguous submissions are never blindly retried.

## T:0 accounting context

**Paid-obligation safeguard.** A validated, bound T:0 bill marked PAID produces
BLOCK_DUPLICATE, with no FX quote, conversion or transfer request for that check.
The recorded USD bill is a separate obligation from the EUR demo payable.

**Financial-statement context.** An opted-in approval can bind balance-sheet bank
cash and cash-flow net change, together with entity, currency and report period.
Selected money claims support MUST_EQUAL or an explicitly configured MINIMUM, using
integer minor units. Every selected numeric claim requires an explicit policy. The server explicitly
selects MUST_EQUAL for its statement bindings; the offline
policy example uses a synthetic minimum. Matching context only supports the existing decision; it cannot independently
authorize EXECUTE. Protected context is checked again at approval and execution.

| Statement check | DueGate result |
| --- | --- |
| Protected claim materially violates policy | REAPPROVAL_REQUIRED / FINANCIAL_CONTEXT_CHANGED |
| Explicit capture-freshness limit exceeded | ESCALATE / FINANCIAL_CONTEXT_STALE |
| Required context incomplete | ESCALATE / FINANCIAL_CONTEXT_INCOMPLETE |
| Decision date outside report period | ESCALATE / FINANCIAL_CONTEXT_OUT_OF_PERIOD |

T:0 financial statements are generated from the GL at request time. DueGate records
the report period and local capture time; it does not invent a statement-level
`as_of` field. Capture time is excluded from the fingerprint; it is evaluated only
when an explicit maximum capture-age policy is bound. Raw T:0 reports are never
blindly hashed as approval context. The two report reads are separate observations, not an atomic
cross-system snapshot. Accounting cash does not replace wallet balance.

T:0 supplies read-only accounting context. DueGate determines whether that context
remains acceptable for execution. Airwallex remains the source of spendable balance
and the execution rail. [Scope and validation details](docs/architecture.md).

## Demonstrated controls

- Stale/out-of-limit FX refusal, reserve protection and cutoff enforcement
- Exact-context approval and approval invalidation
- Duplicate and restart protection
- Failure/ambiguity handling and audit evidence

## Live Claude context interpretation

> The $4,000 customer payment expected Thursday has been delayed until Monday.

Claude extracts a **USD 4,000 inflow**, **Thursday → Monday**, **delayed**.
DueGate validates the facts, preserves Monday as a date/window, and independently
applies its controls. Verified live result: **ESCALATE / INFLOW_TOO_LATE**.

Claude cannot approve, execute, select beneficiaries, override reserve/FX/cutoff
policy or decide financial actions. **DueGate owns payment decisions.**
[Claude integration details](docs/claude-integration.md).

## Run the judge demo

Requires Node.js 24+ and npm. From the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run demo:presentation
```

Open [the local demo](http://127.0.0.1:4311). No credentials are required.
Presentation mode uses recorded Airwallex proof, synthetic quotes and a fixed demo
clock. **No financial writes.**

[Walkthrough](docs/demo.md): WAIT → delayed funding → ESCALATE → restored conditions
→ quote → human approval → protected change → approval invalidated → fresh approval
→ recorded Airwallex proof → duplicate blocked → restart protection → audit evidence.

**The EUR 10,000 narrative obligation was NOT executed.** The recorded historical
proof concerns a separate **EUR 1.00 synthetic Airwallex sandbox transfer**.

With `--t0-recorded`, the [offline walkthrough](docs/demo.md#statement-period-recheck) also shows a separate synthetic minimum-cash claim crossing its policy boundary and a recorded statement becoming out of period. T:0 supplies read-only accounting context. DueGate determines whether the context remains acceptable for execution. Airwallex remains the source of spendable balance and the execution rail.

## Historical sandbox proof

- One final controlled USD → EUR conversion: **SETTLED**
- One EUR 1.00 transfer: **PROCESSING / FUNDED**
- Duplicate and post-restart duplicate attempts blocked
- **Recipient delivery not proven**

Counts describe the final controlled proof, not all development activity. Public
fixtures use sanitized provider aliases; private original evidence stays local.
They are summaries, not independently verifiable provider receipts. [Proof](docs/proof.md).

## Tech stack and verification

TypeScript, Node.js, plain HTML/CSS/TypeScript frontend, Node's built-in test runner
and local filesystem persistence.

**450 tests passed · 0 failed.** Strict TypeScript typecheck, frontend build, secret
scan and live Claude interpretation: **PASS**. Historical Airwallex proof preserved;
zero new conversions or transfers during Claude integration.

## Limitations

Local files are not production-grade distributed coordination. Human operator
identity is a demo label; production authentication, custody, permissions and
hardening are not implemented. Broader live-model evaluation remains necessary.
New approvals use manifest version 2. Older pending/approved records cannot silently
be reused under the new schema; they require fresh review. Existing executed claims
and duplicate protection remain intact. A failure discovered after conversion
preserves review and the already-attempted write count; no supplier transfer follows.
DueGate does not guarantee cancellation of an independently scheduled Airwallex
transfer or claim to have invented approval revocation.
**Not production ready.** Never erase a live ledger to retry a payment.

## Local / sandbox configuration

Presentation mode needs no secrets. For live interpretation, copy .env.example to
.env, set ANTHROPIC_API_KEY locally and optionally ANTHROPIC_MODEL
(default: claude-haiku-5-5), then run:

```sh
npm run demo:claude
```

Each Interpret update click can make one paid request; execution evidence remains
recorded. Stop any existing server on port 4311 before switching modes.

Separately authorized sandbox development requires AIRWALLEX_CLIENT_ID,
AIRWALLEX_API_KEY and an existing DUEGATE_SANDBOX_BENEFICIARY_ID in .env.
Never commit credentials or use production credentials. No new transfer is needed
for judging. See [setup and demo details](docs/demo.md).

## Technical docs

[Architecture](docs/architecture.md) · [Demo](docs/demo.md) · [Proof](docs/proof.md) ·
[Claude integration](docs/claude-integration.md) ·
[Repository readiness](docs/github-readiness-report.md)

No open-source license has been selected or granted.
