# Judge demo: no-write recorded proof

Start with npm ci, then npm run demo:presentation. Open http://127.0.0.1:4311. No .env or provider is required. This mode never instantiates the live Airwallex adapter.

The presentation uses the synthetic EUR 1.00 payable and a fixed clock. The EUR 10,000 narrative obligation is separate and was never executed. Labels distinguish synthetic interaction from historical sandbox results.

| Step | What to show | Meaning |
| --- | --- | --- |
| 1 | Open the payable; inspect reserve, commitments and free cash. | WAIT: confirmed inflow closes the shortfall before cutoff. |
| 2 | Use the supplied funding-update example; interpret, then apply. | Typed delayed timing changes the decision to ESCALATE. No movement. |
| 3 | Restore sufficient funding using the demo control. | Quote and current conditions allow EXECUTE eligibility. |
| 4 | Open human approval, inspect exact amount, beneficiary, quote, reserve and fingerprint; confirm. | Approval records this exact context only. |
| 5 | Use the context/quote-change demonstration. | Approval becomes INVALIDATED. |
| 6 | Show the execution refusal. | Old approval cannot authorize changed context. |
| 7 | Restore conditions/get a new demo quote and approve again. | A fresh exact approval is required. |
| 8 | Show recorded proof. | Prior USD 1.12 conversion and EUR 1.00 transfer; no new execution. |
| 9 | Inspect SETTLED and PROCESSING / FUNDED. | Do not describe this as recipient delivery. |
| 10 | Show duplicate protection/disabled execution. | BLOCK_DUPLICATE; no extra quote or money movement. |
| 11 | Stop and restart the same demo command, retaining .presentation-state; reload. | Protection and interaction history persist. |
| 12 | Inspect timeline and export audit. | Reasons, approval transitions and recorded evidence remain distinguishable. |

Presentation quotes are synthetic at the fixed demo clock, not fresh market quotes. IDs in recorded evidence are public display aliases. Historical execution evidence remains privately preserved.

To rehearse from the start, use a separate checkout with a new presentation state directory. Do not delete or edit live ledgers, approvals or historical evidence. The application may already show the blocked state if a prior rehearsal completed.
