# Proof and limitations

## Final historical sandbox proof

One controlled final proof converted USD 1.12 to EUR 1.00 and created one EUR 1.00 synthetic supplier transfer. Conversion: SETTLED. Transfer: PROCESSING, funding status FUNDED, observed transfer fee EUR 0.00. Recipient delivery was not proven.

| Wallet | Before | After conversion | After transfer |
| --- | ---: | ---: | ---: |
| USD | 9,999,987.74 | 9,999,986.62 | 9,999,986.62 |
| EUR | 10,000,007.82 | 10,000,008.82 | 10,000,007.82 |

These are sandbox balances. The quoted rate was 1.120465 USD per EUR; the charged source amount rounded to USD 1.12. Duplicate execution and the post-restart attempt were blocked without another conversion or transfer. The EUR 10,000 narrative payment was not executed. Earlier development spikes are not included in these final-proof counts.

Public fixtures/recorded-proof.json contains only selected numerical/status evidence and display aliases. Original provider IDs, payloads, local proof files and persisted live ledger remain private and unchanged. This summary is not independent verification from Airwallex.

## Reproducible offline checks

Run npm test, npm run typecheck and npm run build. Verified: 318 tests passed, 0 failed; strict typecheck PASS; frontend build PASS. Mock integration tests cover guards, approval invalidation, payload mutation, failure states and durable duplicate protection. Presentation tests exercise the full recorded sequence and restart with zero provider writes.

Presentation uses a separate recorded adapter and fixed clock. It cannot create a conversion or transfer, even after human approval. Its visible results are historical evidence, not fresh provider status. The offline mode needs no model provider. Live Claude interpretation is implemented and verified separately: HTTP 200, validated USD 4,000 delayed-inflow facts, date uncertainty preserved, and deterministic ESCALATE / INFLOW_TOO_LATE. See [Claude verification](claude-integration.md).

Repository preparation performed zero conversions and zero transfers. No Airwallex API was called during preparation.
