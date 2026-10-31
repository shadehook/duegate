# DueGate

**Context-bound execution control for cross-border payments.**

DueGate prevents an approved cross-border payment from executing after the conditions
that justified the approval have changed.

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
| WAIT | Cash is insufficient; a confirmed inflow closes the gap before cutoff. |
| EXECUTE | Financial controls pass; exact approval and the execution ledger must still authorize execution. |
| ESCALATE | Funding, timing, quote or input safety requires human review. |
| BLOCK_DUPLICATE | Payment is completed or has an attached transfer; no second execution. |

## How it works

Payment obligation → current financial context → **DueGate decision** → exact human
approval → Airwallex execution → audit evidence.

Claude can supply typed context from unstructured updates. It is not required for
DueGate's deterministic controls.

## Approval binding

Approval binds the **exact execution context**: amount, beneficiary, FX quote/policy,
reserve/funding context and timing. A fingerprint detects protected changes.

If that context changes, approval becomes invalid, execution fails closed, and a
new approval is required. EXECUTE eligibility alone never authorizes money movement.

## Airwallex integration

Airwallex is the financial execution layer: balances, beneficiary lookup, FX quotes,
conversion, transfer validation/creation and status reads.

Writes are disabled by default. A persistent ledger prevents duplicate execution
across restart; failed or ambiguous submissions are never blindly retried.

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

**394 tests passed · 0 failed.** Strict TypeScript typecheck, frontend build, secret
scan and live Claude interpretation: **PASS**. Historical Airwallex proof preserved;
zero new conversions or transfers during Claude integration.

## Limitations

Local files are not production-grade distributed coordination. Human operator
identity is a demo label; production authentication, custody, permissions and
hardening are not implemented. Broader live-model evaluation remains necessary.
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
