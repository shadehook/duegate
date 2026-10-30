# Claude integration

**Integration: COMPLETE** for the scoped fact extraction → local validation → deterministic decision flow. **Live verification: PASS.**

## Verified live example

Input: “The $4,000 customer payment expected Thursday has been delayed until Monday.”

| Evidence | Observed result |
| --- | --- |
| Model | claude-haiku-5-5 |
| HTTP status | 200 |
| Latency | 4,121 ms |
| Stop reason | end_turn |
| Content block types | thinking, text |
| Schema/domain validation | PASS |
| Inflow | INFLOW-001, USD 4,000 (400000 minor units) |
| Change | DELAYED |
| Previous known arrival | Thursday, October 8, 2026; supplied application context |
| New timing | DATE: Monday, October 12, 2026; exact arrival null |
| Normalized window | [2026-10-12T04:00:00.000Z, 2026-10-13T04:00:00.000Z), America/New_York |
| Configured cutoff | 2026-10-09T16:00:00.000Z |
| Application outcome | APPLIED |
| Independent DueGate result | ESCALATE / INFLOW_TOO_LATE |
| Financial writes | conversions 0, transfers 0 |

Exactly one request was made in the successful authorized verification, without retry or an Airwallex call. Thinking content was ignored and is not published. Earlier diagnostic attempts informed the nullable-enum and content-selection fixes; they are not presented as successful extraction. This result proves one synthetic example, not production reliability across all finance messages.

## Responsibility boundary and contract

Claude extracts facts only. It cannot approve, choose a beneficiary, override reserve/FX/cutoff policy, invoke a provider or return an authoritative financial decision. DueGate owns WAIT / EXECUTE / ESCALATE / BLOCK_DUPLICATE; human approval and persistent execution guards remain required.

The existing FundingCandidate contract uses classification, expected_inflow_id, amount_minor, currency, eta_precision, new_eta_exact, new_eta_date, eta_window_start, eta_window_end and ambiguities. All fields are required; nullable fields must be explicit. eventType/changeType aliases, confidence, sourceText and action fields are rejected. Amounts are integer cents, not major-unit numbers.

The provider-specific currency schema is anyOf of a USD/EUR string enum and null. Existing local validation checks every constraint, including known identity, currency, safe integer amount, precision, chronology and source evidence. Only case-equivalent known enum values are normalized; IDs, amounts, spelling and timestamp precision are never guessed. DATE becomes the full local calendar day; TIME_WINDOW retains its bounds. UNKNOWN/AMBIGUOUS requires review.

## API and content handling

The server calls the official POST https://api.anthropic.com/v1/messages directly using native fetch, API version 2023-06-01 and server-side x-api-key authentication. No Anthropic SDK dependency is installed. The request uses output_config.format with type json_schema, one user message, a system fact-extraction instruction and max_tokens 1200. ANTHROPIC_MODEL configures the model; claude-haiku-5-5 is the verified default.

The parser accepts exactly one text block alongside zero or more thinking/redacted_thinking blocks. Thinking payloads, signatures and encrypted data are never interpreted, logged, persisted or shown. Multiple text blocks are rejected, even if one is empty; they are never concatenated. Unknown/tool blocks, refusal, max_tokens and unexpected stop reasons fail closed before facts can apply.

References: [Messages API](https://platform.claude.com/docs/en/api/messages/create), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [thinking blocks](https://platform.claude.com/docs/en/build-with-claude/thinking).

## Failure, privacy and cost controls

One explicit interpretation action produces at most one request, with a 30-second timeout, no redirects, no tools and no retries. Startup, rendering and polling never invoke Claude. Only the message and permitted inflow context are sent; no wallet, beneficiary, approval or ledger data is sent. Use synthetic messages for this demo.

Rejected output clears pending facts, retains prior financial state and shows “Funding update could not be interpreted safely. Human review required.” There is no silent offline fallback. Safe diagnostics contain HTTP status, model, stop reason, bounded block types, parser stage, code, field path, static sanitized reason and latency. No raw model/HTTP error bodies, thinking, headers, environment or API keys are retained. Unknown strings are mapped to code-owned labels.

## Setup and demo

Set ANTHROPIC_API_KEY locally in .env and optionally ANTHROPIC_MODEL. Run npm run demo:claude. The isolated synthetic story has a USD 4,000 inflow and fixed October 7 clock; its EUR 1.00 payment evidence is recorded only. Interpret, review facts, then Apply update & reevaluate. Continue the existing human approval/invalidation/proof sequence without any new financial execution. See [the demo guide](demo.md).

npm run demo:presentation remains offline and requires no credentials. The two modes use separate ignored state directories. Do not reset a live ledger to retry a payment.

## Tests and diagnostics

319 tests pass; strict typecheck, frontend build and secret scan pass. Fixtures claude-success.json and claude-thinking-success.json are synthetic expected shapes, not raw live responses. They prove parsing, normalization, temporal windows and deterministic ESCALATE. Tests also cover failure modes, unchanged state on rejection, opaque thinking, injection, UI/audit privacy and zero-write restart protection. No live API request runs in npm test.

| Stage | Codes |
| --- | --- |
| configuration | `CONFIGURATION_REQUIRED`, `INVALID_CONTEXT`, `INVALID_INPUT`, `INVALID_REFERENCE`, `INVALID_KNOWN_INFLOWS`, `TIMEZONE_REQUIRED` |
| transport | `NETWORK_FAILURE`, `REQUEST_TIMEOUT`, `HTTP_ERROR`, `RESPONSE_JSON_FAILED` |
| content | `CLAUDE_REFUSAL`, `CLAUDE_MAX_TOKENS`, `UNSUPPORTED_STOP_REASON`, `INVALID_RESPONSE_ENVELOPE`, `NO_TEXT_CONTENT`, `EMPTY_CONTENT`, `MULTIPLE_CONTENT_BLOCKS`, `UNSUPPORTED_CONTENT_BLOCK` |
| json | `JSON_PARSE_FAILED` |
| schema | `SCHEMA_VALIDATION_FAILED`, `UNEXPECTED_FIELD`, `MISSING_FIELD`, `UNSUPPORTED_EVENT_TYPE`, `UNSUPPORTED_CURRENCY`, `INVALID_AMOUNT`, `INVALID_SCHEMA_FIELDS`, `INVALID_SCHEMA_VALUE`, `INVALID_TEMPORAL_TYPE`, `INVALID_INFLOW_ID`, `INVALID_AMBIGUITIES` |
| domain | `INVALID_SOURCE_AMOUNT`, `UNKNOWN_INFLOW`, `CURRENCY_MISMATCH`, `UNKNOWN_SOURCE_INFLOW`, `SOURCE_CURRENCY_MISMATCH`, `IRRELEVANT_HAS_FACTS`, `AMBIGUITY_MISSING`, `INCOMPLETE_FACTS`, `UNEXPECTED_AMOUNT_CHANGE`, `UNSUPPORTED_AMOUNT_CHANGE`, `DOMAIN_VALIDATION_FAILED` |
| normalization | `NORMALIZATION_FAILED` |
| temporal | `UNKNOWN_HAS_ETA`, `INVALID_EXACT`, `INVENTED_EXACT_TIME`, `INVALID_DATE_PRECISION`, `INVALID_DAY_WINDOW`, `INVALID_WINDOW_PRECISION`, `INCOMPLETE_ETA`, `ETA_NOT_FULLY_FUTURE`, `CONTRADICTORY_DELAY`, `ALTERNATIVE_DATES_NOT_SINGLE_DATE`, `SOURCE_DATE_MISMATCH`, `INVALID_LOCAL_TIME`, `NON_UNIQUE_LOCAL_TIME`, `INVALID_DATE`, `UNSUPPORTED_DAY`, `INVALID_WINDOW`, `INVALID_DAY_BOUNDARIES`, `UNSUPPORTED_TIME_WINDOW` |
| application | `CLOCK_MISMATCH`, `INVALID_PROVENANCE`, `INVALID_FACTS`, `AMBIGUOUS_UPDATE`, `APPLICATION_IDENTITY_MISMATCH`, `APPLICATION_CURRENCY_MISMATCH`, `INFLOW_NOT_APPLICABLE`, `INFLOW_CONTEXT_MISMATCH`, `ON_TIME_CONTEXT_MISMATCH`, `APPLICATION_REJECTED` |

Detailed static reasons and paths are defined in src/funding-diagnostics.mts. MULTIPLE_CONTENT_BLOCKS means multiple output text blocks, not thinking plus one text block. Historical Airwallex proof remains unchanged; zero conversions and zero transfers were created during Claude integration. Production identity, distributed persistence, operational recovery and broad live-model evaluation remain outside this prototype.
