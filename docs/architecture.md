# Architecture

## Components and boundaries

- **Domain:** src/decision-engine.mts defines typed payable, treasury, funding, FX and execution inputs. A supplied clock makes decisions reproducible. Integer minor units and exact ratios avoid floating-point funding decisions.
- **Interpretation:** funding-update, funding-v2 and temporal modules normalize messages into constrained facts. Schema/identity/date-window validation and adversarial tests protect the deterministic state. Irrelevant messages do not change treasury state.
- **Approval:** src/approval-store.mts fingerprints protected payment, treasury, funding, reserve, commitment, FX policy and quote fields. Eligibility/freshness and fingerprint equality are checked again; changed context invalidates approval. Append-only exclusive revisions arbitrate one-use approval.
- **Controller:** src/execution-controller.mts orchestrates gate evaluation, quotes, locked payloads, conversion settlement and transfer creation through the typed adapter. The domain imports no HTTP implementation.
- **Persistence:** src/execution-ledger.mts stores durable claims and provider identifiers. Exclusive file creation and persisted state protect one logical payable across local process restarts. This is a local filesystem guarantee, not a distributed database claim.
- **Provider:** src/airwallex-adapter.mts is replaceable; airwallex-sandbox.mts uses only the fixed sandbox API. Credentials/token stay out of public fixtures. Writes require explicit adapter authorization.
- **UI:** web/ renders views and sends commands to the localhost server. It does not implement financial execution rules. DemoService invokes the controller/approval/ledger layers.
- **Presentation:** PresentationService uses a recorded adapter, sanitized fixture, fixed clock and isolated .presentation-state. Writes throw. Replay shows historical outcomes without contacting Airwallex.

## Trust boundaries

Messages and optional model outputs are untrusted facts, never payment authority. The active demo parser is deterministic. The optional OpenAI interpreter remains replaceable and live-provider behavior is unverified. Claude is planned only. Human approval is required but the current actor label is not enterprise authentication.

The local HTTP server checks host/origin/session for mutations and binds to localhost. A per-process session is not a production identity system. Raw provider responses, local credentials, live ledgers and private audit exports are excluded from the repository.

## Failure handling and evidence

WAIT and ESCALATE cannot execute. Cutoff, stale quote, FX limit, reserve, existing claims/transfers and payload mutation fail closed. A settled conversion is required before transfer. Ambiguous outcomes preserve evidence and require review instead of blind retry. Restart restores persisted protection; never reset a live ledger to bypass it.

Audit events record deterministic reasons and transitions. Public export sanitization is implemented in src/audit-export.mts. Local files are not tamper-proof or externally notarized. The public fixture is a curated historical summary, not a raw provider audit.
