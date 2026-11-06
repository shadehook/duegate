# Demo walkthrough

[Watch the DueGate demo (2:24)](https://youtu.be/vrOg0cmH8Tc) or follow the same decisions locally. The opening cash example is synthetic. The EUR 1.00 execution evidence comes from a separate, historical Airwallex sandbox payment.

## Start the offline demo

With Node.js 24+ installed, run these commands from the repository root:

```sh
npm ci
npm run demo:presentation -- --presentation-run=judge-demo --t0-recorded
```

Open [DueGate locally](http://127.0.0.1:4311/). The server needs port 4311. Presentation mode uses a fixed demo clock, synthetic quotes, an offline interpreter and recorded evidence. It needs no credentials and makes no live provider calls or financial writes.

A previously unused run name starts a separate supplier payable at WAIT. Use the same name after restarting to recover that payable and its audit history. Named runs are stored in `.presentation-runs/<name>`. Names may contain letters, numbers, underscores and hyphens up to 64 characters.

## Inspect the approval

Start with the **Approval validity check**. In this synthetic example, accounting cash was **USD 310,000** when approved. The protected minimum was **USD 250,000**. The current value of **USD 218,000** violates that rule. DueGate shows **REAPPROVAL_REQUIRED**, gives **FINANCIAL_CONTEXT_CHANGED** as the reason, and reports **0 Airwallex writes attempted**. This example is independent of the supplier payable below it.

Open the claim details to see the selected field, approved value and comparison rule. Only claims bound to the approval take part in revalidation. Accounting cash describes the books. The Airwallex wallet supplies the spendable balance for execution.

## Follow the supplier payable

| Action | Expected result |
| --- | --- |
| Inspect the payable's funding and deadline. | **WAIT**. Free cash is insufficient, but a confirmed inflow is expected before cutoff. |
| Select **Interpret update** on the supplied funding message, review the extracted facts, then select **Apply update & reevaluate**. | **ESCALATE**, reason **INFLOW_TOO_LATE**. DueGate determines that the updated arrival falls outside the safe execution window. |
| Select **Load funded scenario** and inspect the synthetic FX quote. | **EXECUTE READY**. Current policy checks pass and the payment is eligible for human approval. No money has moved. |
| Select **Approve exact payment**, review the beneficiary, amount, FX terms and protected context, then confirm. | The human approval binds those terms. |
| Select **Change protected quote context**, then inspect the refusal. | **REAPPROVAL_REQUIRED**. The old approval cannot authorize execution with the changed quote. |
| Load funded conditions again, approve the fresh context, then select **Show recorded proof**. | Historical evidence shows USD 1.12 sold for EUR 1.00. Conversion status **SETTLED**. Supplier transfer status **PROCESSING**. Funding status **FUNDED**. Recipient delivery is not claimed. |
| Inspect duplicate protection, restart the server with the same command and reload the page. | **BLOCK_DUPLICATE** persists with the existing transfer reference. The audit history retains the approval, invalidation and recorded proof events. |

The EUR 10,000 narrative obligation was never executed. The recorded proof concerns one EUR 1.00 sandbox transfer. [Inspect the balances before and after execution](proof.md).

## Inspect the recorded T:0 context

The `--t0-recorded` option loads two separate pieces of read-only accounting evidence:

- **Statement period.** Expand the statement disclosure in the [approval validity panel](http://127.0.0.1:4311/#t0-financial-context). The recorded October 1–30 USD reports showed bank-group cash of **216,444.33** and net cash change of **−17,554.43**. The October 30 evaluation is within the report period. Replaying the evaluation for October 31 produces **ESCALATE** with reason **FINANCIAL_CONTEXT_OUT_OF_PERIOD**. These recorded figures are separate from the synthetic minimum-cash example.
- **Already-paid bill.** The [accounting check](http://127.0.0.1:4311/#t0-accounting-check) shows a separately bound **USD 4,998.13** supplier bill recorded as paid. DueGate returns **BLOCK_DUPLICATE** for that USD obligation without requesting a quote, conversion or transfer. It has no beneficiary mapping to the EUR payable. Its accounting status does not establish recipient delivery.

The audit export keeps the accounting check and statement results distinct from execution evidence. [Adapter scope and validation rules](architecture.md)

## Optional live interpretation

The video and offline walkthrough use the deterministic interpreter. To try **Claude interpretation** separately, copy `.env.example` to the ignored `.env`, set `ANTHROPIC_API_KEY` locally, stop the previous server, and run `npm run demo:claude`. Use this mode without a named presentation run or `--t0-recorded`. It uses its own isolated state and recorded execution evidence.

In the verified example, “The $4,000 customer payment expected Thursday has been delayed until Monday” yields a delayed USD 4,000 inflow with Monday retained as a calendar day. DueGate independently returns **ESCALATE** with reason **INFLOW_TOO_LATE** against the Friday cutoff. Only an explicit **Interpret update** action can make a paid Claude request. Human approval and all payment controls remain with the application and its operator. [Verification and configuration](claude-integration.md)
