# DueGate

**Context-bound execution control for cross-border payments.**

DueGate prevents an approved cross-border payment from executing after the conditions that justified the approval have changed.

Built for the Airwallex Agentic Banking Hackathon. Hackathon prototype / sandbox validated. **Not production ready.**

## Why DueGate exists

Cash, reserves, FX, beneficiary details and timing may be valid when a payment is approved. Funding can then slip, a quote can expire, a cutoff can pass, or execution may already have occurred. DueGate revalidates that context before money moves.

## Core decisions

| Decision | Meaning |
| --- | --- |
| WAIT | Free cash is insufficient, but a confirmed inflow closes the shortfall safely before cutoff. |
| EXECUTE | Deterministic financial controls pass. Exact human approval and the execution ledger must still authorize execution. |
| ESCALATE | Funding, timing, quote or input safety fails; human review is required. |
| BLOCK_DUPLICATE | The payable is paid/completed or already has an attached transfer. No second execution. |

Free cash = wallet balance − fixed reserve − other committed amounts. Money uses integer minor units; FX limits use exact ratios. Date/window uncertainty is evaluated conservatively.

## How it works

Payment obligation → financial context → typed context interpretation → deterministic controls → exact human approval → guarded Airwallex execution → persistent audit evidence.

Checks cover cash, reserve, commitments, expected inflow timing, cutoff, FX freshness and limit, beneficiary, amount, currencies, approval and execution state.

### Approval binding

Approval is bound to a fingerprint of the exact payable, treasury/funding context, reserve, commitments, FX policy and quote. A protected change invalidates approval. Execution fails closed and requires a new approval. EXECUTE eligibility alone does not authorize money movement.

### Agentic architecture and AI boundary

The current demo uses a deterministic funding-message interpreter. Typed facts pass schema, identity and temporal validation before affecting state. A replaceable interpreter interface and optional OpenAI adapter exist; no live model provider is verified in this demo. Claude integration is upcoming, not implemented.

Intended path: unstructured finance message → Claude extracts typed facts → deterministic DueGate controls decide → human approves → Airwallex executes.

**The LLM does not decide whether money moves.** Model output and user-facing text cannot override the execution controls.

## Airwallex integration

The sandbox adapter supports balance context, beneficiary lookup, FX quotes, conversion, transfer validation/creation and status reads. Financial writes are disabled by default. The local ledger protects against duplicate execution across restart, and ambiguous or failed submissions are not blindly retried.

## Demonstrated controls

Stale/out-of-limit FX refusal, reserve protection, cutoff enforcement, exact-context approval and invalidation, durable execution claims, duplicate/restart protection, conservative failure handling and an audit trail are covered by deterministic tests.

## Run the safe judge demo

Requires Node.js 24 or later and npm. From the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run demo:presentation
```

Open http://127.0.0.1:4311. No credentials or live provider are required. Presentation mode uses sanitized recorded evidence and a fixed demo clock; it cannot make financial writes. Stop an existing process on that port before starting another instance.

Follow [the demo walkthrough](docs/demo.md): WAIT → delayed funding → ESCALATE → restored conditions → quote → human approval → changed quote → invalidation/refusal → fresh approval → recorded proof → duplicate block → restart → persistent protection/audit.

The EUR 10,000 narrative obligation was **not executed**. The recorded proof concerns a separate EUR 1.00 synthetic sandbox payable. Presentation mode follows that small payable and does not execute it again.

### Optional sandbox configuration

The judge demo does not need an .env file. For separately authorized sandbox development, copy .env.example to .env and fill values locally. AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY authenticate; DUEGATE_SANDBOX_BENEFICIARY_ID must reference an existing sandbox beneficiary. Never put credentials in Git, screenshots or audit exports. npm run demo and npm run demo:final require local sandbox configuration; neither enables financial writes by default. Do not use production credentials. No new transfer is needed to review this project.

OPENAI_API_KEY, DUEGATE_LLM_PROVIDER and DUEGATE_LLM_MODEL are optional adapter configuration; they are not required by the offline demo. No Anthropic credential is consumed by current code.

## Historical sandbox proof

The final controlled proof produced **one USD → EUR conversion** (SETTLED) and **one EUR 1.00 transfer** (PROCESSING / FUNDED). Duplicate and post-restart attempts were blocked. Recipient delivery was not proven. These counts describe that historical final proof, not all earlier development experiments.

Public evidence uses display aliases instead of provider identifiers. The private original evidence remains local; the checked-in fixture is a sanitized summary, not an independently verifiable provider receipt. See [proof and limitations](docs/proof.md).

## Tech stack and verification

TypeScript, Node.js native HTTP/fetch/filesystem/crypto, a plain HTML/CSS/TypeScript frontend, Node's built-in test runner, and local filesystem persistence. No frontend framework, database service or external font dependency is required.

Verified repository suite: **218 passed, 0 failed**; strict TypeScript typecheck PASS; frontend build PASS. Tests use mock/recorded adapters and make no financial writes.

## Limitations

Local filesystem arbitration is not a distributed production transaction system. Human operator identity is a local demo label, not authenticated enterprise identity. Production custody, permissions, recovery operations, deployment hardening and live-model evaluation remain outside this prototype. Do not delete a live execution ledger to retry a payment.

[Architecture](docs/architecture.md) · [Demo](docs/demo.md) · [Proof](docs/proof.md) · [Repository readiness](docs/github-readiness-report.md)

No open-source license has been selected or granted by this repository.
