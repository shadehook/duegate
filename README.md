# DueGate

**Approval is not permanent permission.** DueGate is an execution-time authorization layer that checks whether the financial conditions supporting an approved action still hold before execution.

## Demo Day walkthrough

**Final walkthrough, 3:53:**  
https://www.youtube.com/watch?v=XObPhGLYD1A

This is the recommended starting point for reviewing DueGate.

Its first demonstrated application is cross-border supplier payments through Airwallex. A treasurer may approve a payment in the morning, then see funding slip, a quote expire, or a protected cash balance fall before the payment is sent. DueGate checks whether that specific approval still authorizes execution. Choosing which bills to pay is outside its scope.

Immediately before submitting a payment to Airwallex, DueGate revalidates the selected facts and rules that the human approved. If a protected fact violates its approved terms, DueGate blocks execution and requires fresh approval.

[Original submission demo (2:24)](https://youtu.be/vrOg0cmH8Tc) · [Try the offline walkthrough](docs/demo.md) · [Inspect the recorded sandbox proof](docs/proof.md)

Built for the Airwallex Agentic Banking Hackathon. This is a sandbox-validated prototype.

## When does a payment need fresh approval?

In the **synthetic policy example**, a human approved a payment while protected accounting cash was **USD 310,000**. The approval required cash to stay at or above **USD 250,000**. At execution time the selected balance is **USD 218,000**.

| Decision | Reason | Airwallex writes attempted |
| --- | --- | ---: |
| `REAPPROVAL_REQUIRED` | `FINANCIAL_CONTEXT_CHANGED` | 0 |

A change that stays within the approved minimum can satisfy the rule. A change to an unrelated accounting row leaves the approval intact. The demo values illustrate this policy. The separate recorded T:0 statement reads and their report period are available in the walkthrough.

## Decisions

| Decision shown to the operator | Meaning |
| --- | --- |
| EXECUTE READY | Current policy checks pass. The payment is eligible to proceed through human approval and execution. No money has moved at this step. |
| WAIT | Free cash is insufficient, but a confirmed inflow can cover the shortfall before the safe execution cutoff. |
| REAPPROVAL_REQUIRED | A protected term violates its approved rule. A human must approve the new context before execution. |
| ESCALATE | The payment needs review, for example because funding arrives too late or required evidence is missing, stale or ambiguous. |
| BLOCK_DUPLICATE | An existing payment or transfer record blocks another execution of the same obligation. |

## Architecture and authority

| Participant | Responsibility |
| --- | --- |
| T:0 | Supplies read-only accounting context for explicitly selected claims, such as bank-group cash for a specified entity, currency and report period. Accounting cash is distinct from the spendable Airwallex wallet balance. |
| Claude (optional) | Turns an unstructured funding update into typed facts. DueGate validates identity, amounts and timing before applying them. Claude has no authority to approve, choose beneficiaries, override policy, decide EXECUTE READY or call Airwallex execution. |
| DueGate | Applies deterministic funding, reserve, FX, cutoff, approval and duplicate checks. It records which rule allowed or blocked the next action. |
| Human approver | Authorizes the exact payment terms and protected context. A material violation requires a fresh human approval. |
| Airwallex | Supplies spendable wallet balances, beneficiary information and FX quotes. Its sandbox conversion and transfer APIs form the execution rail. |

An approval records the selected payment, FX, policy and optional accounting fields together with their comparison rules. DueGate compares those fields at approval and again before submission. An exact quote term must still match. A balance bound to a minimum must still meet it. Missing evidence requires investigation and has a different outcome from a confirmed policy violation.

The execution controller locks the approved payload and persists request and provider identifiers in a local ledger. It requires a settled conversion before submitting the supplier transfer. An ambiguous submission goes to review. If a failure occurs after conversion, the ledger retains the conversion evidence and the controller stops before the transfer. [Architecture and safety model](docs/architecture.md)

## FAQ and Failure Handling

**Why isn’t this just Airwallex approval?** Airwallex approval authorizes the payment workflow and terms. DueGate adds a separate execution-time check of selected external financial and accounting conditions that supported that approval before DueGate submits the payment.

**What if the payment details stay the same but the financial context changes?** An invoice can still match its approval while a protected balance falls below its approved minimum. If a protected claim violates its rule, DueGate invalidates the approval and requires fresh human approval.

**What if accounting evidence is missing or stale?** When a rule depends on accounting evidence that is missing or too old, DueGate escalates for review. Execution stays on hold until the required evidence can be verified.

**What if the same obligation is attempted twice?** DueGate uses persisted execution records and request/provider identifiers to block duplicate execution. Separately, explicitly bound accounting evidence can block an obligation already recorded as paid. The sandbox demonstration shows that execution duplicate protection survives a local restart.

**Does Claude decide whether money moves?** No. Claude can optionally interpret funding updates. It cannot approve payments, select beneficiaries, override policy, decide EXECUTE READY or call Airwallex execution.

**What happens if Airwallex times out or the submission outcome is uncertain?** Airwallex may already have accepted the original request, so DueGate does not blindly retry. If a failure is discovered after FX conversion has already settled, DueGate retains the conversion evidence, stops before the supplier transfer, and sends the case to review rather than implying that nothing moved.

**Can DueGate stop any Airwallex payment after it has already been scheduled?** No. DueGate can block a payment at the submission boundary it controls. It cannot guarantee cancellation of a payment independently scheduled at Airwallex.

**Is DueGate production ready?** No. DueGate is a sandbox-validated prototype. Production use still requires enterprise identity, distributed coordination, monitoring, operational recovery and stronger deployment controls.

## Recorded Airwallex proof

The historical sandbox run sold **USD 1.12**, received **EUR 1.00**, and created one **EUR 1.00** supplier transfer.

| Observation | Recorded result |
| --- | --- |
| FX conversion status | SETTLED |
| Supplier transfer status | PROCESSING |
| Transfer funding status | FUNDED |
| Duplicate execution attempt | Blocked, including after restart |

Recipient delivery is not claimed. The EUR 10,000 narrative obligation was never executed. The public fixture contains sanitized results from the separate EUR 1.00 run. [Balance changes and proof limitations](docs/proof.md) · [Recorded fixture](fixtures/recorded-proof.json)

## Run locally

Use Node.js 24+ and npm. From the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run demo:presentation -- --presentation-run=judge-demo --t0-recorded
```

Open [the local demo](http://127.0.0.1:4311/). Presentation mode uses a fixed clock, synthetic quotes, an offline interpreter and recorded provider evidence. It requires no credentials and performs no financial writes. A new run name starts the supplier payable at WAIT. Restart with the same name to inspect its persisted decision and audit history. [Step-by-step walkthrough](docs/demo.md)

The project uses TypeScript, Node.js, a plain HTML/CSS/TypeScript frontend and local file persistence. The verification suite has **457 passing automated tests**.

## Scope and limits

Human identity is a local demo label. The ledger demonstrates duplicate protection across local restarts. Production identity, distributed coordination and operational recovery are outside this prototype. DueGate controls the submission boundary it owns and makes no guarantee about cancelling a payment independently scheduled at a provider.

The recorded demo uses no live Claude calls. A separate live interpretation check preserved a delayed inflow's date uncertainty and led DueGate to escalate before the payment cutoff. [Claude verification and optional setup](docs/claude-integration.md)

No open-source license has been selected or granted.
