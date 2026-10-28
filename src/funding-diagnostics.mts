/** Only code-owned labels are retained; exception messages and input values are never logged. */
export const diagnosticCatalog={
  "CONFIGURATION_REQUIRED": {
    "stage": "configuration",
    "path": "config",
    "reason": "configuration required"
  },
  "INVALID_CONTEXT": {"stage":"configuration","path":"context","reason":"invalid reference, timezone or known inflow context"},
  "INVALID_INPUT": {
    "stage": "configuration",
    "path": "input",
    "reason": "invalid input"
  },
  "INVALID_REFERENCE": {
    "stage": "configuration",
    "path": "reference",
    "reason": "invalid reference"
  },
  "INVALID_KNOWN_INFLOWS": {
    "stage": "configuration",
    "path": "known",
    "reason": "invalid known inflows"
  },
  "TIMEZONE_REQUIRED": {
    "stage": "configuration",
    "path": "timezone",
    "reason": "timezone required"
  },
  "NETWORK_FAILURE": {
    "stage": "transport",
    "path": "$",
    "reason": "network failure"
  },
  "REQUEST_TIMEOUT": {
    "stage": "transport",
    "path": "$",
    "reason": "request timeout"
  },
  "HTTP_ERROR": {
    "stage": "transport",
    "path": "$",
    "reason": "http error"
  },
  "RESPONSE_JSON_FAILED": {
    "stage": "transport",
    "path": "$",
    "reason": "response json failed"
  },
  "CLAUDE_REFUSAL": {
    "stage": "content",
    "path": "stop_reason",
    "reason": "claude refusal"
  },
  "CLAUDE_MAX_TOKENS": {
    "stage": "content",
    "path": "stop_reason",
    "reason": "claude max tokens"
  },
  "UNSUPPORTED_STOP_REASON": {
    "stage": "content",
    "path": "stop_reason",
    "reason": "unsupported stop reason"
  },
  "INVALID_RESPONSE_ENVELOPE": {
    "stage": "content",
    "path": "$",
    "reason": "invalid response envelope"
  },
  "NO_TEXT_CONTENT": {
    "stage": "content",
    "path": "content",
    "reason": "no text content"
  },
  "EMPTY_CONTENT": {
    "stage": "content",
    "path": "content",
    "reason": "empty content"
  },
  "MULTIPLE_CONTENT_BLOCKS": {
    "stage": "content",
    "path": "content",
    "reason": "multiple content blocks"
  },
  "UNSUPPORTED_CONTENT_BLOCK": {
    "stage": "content",
    "path": "content",
    "reason": "unsupported content block"
  },
  "JSON_PARSE_FAILED": {
    "stage": "json",
    "path": "$",
    "reason": "json parse failed"
  },
  "SCHEMA_VALIDATION_FAILED": {
    "stage": "schema",
    "path": "$",
    "reason": "schema validation failed"
  },
  "UNEXPECTED_FIELD": {
    "stage": "schema",
    "path": "$",
    "reason": "unexpected field"
  },
  "MISSING_FIELD": {
    "stage": "schema",
    "path": "$",
    "reason": "missing field"
  },
  "UNSUPPORTED_EVENT_TYPE": {
    "stage": "schema",
    "path": "classification",
    "reason": "unsupported event type"
  },
  "UNSUPPORTED_CURRENCY": {
    "stage": "schema",
    "path": "currency",
    "reason": "unsupported currency"
  },
  "INVALID_SOURCE_AMOUNT": {"stage":"domain","path":"amount_minor","reason":"invalid source amount"},
  "INVALID_AMOUNT": {
    "stage": "schema",
    "path": "amount_minor",
    "reason": "invalid amount"
  },
  "INVALID_SCHEMA_FIELDS": {
    "stage": "schema",
    "path": "$",
    "reason": "invalid schema fields"
  },
  "INVALID_SCHEMA_VALUE": {
    "stage": "schema",
    "path": "$",
    "reason": "invalid schema value"
  },
  "INVALID_TEMPORAL_TYPE": {
    "stage": "schema",
    "path": "$",
    "reason": "invalid temporal type"
  },
  "INVALID_INFLOW_ID": {
    "stage": "schema",
    "path": "expected_inflow_id",
    "reason": "invalid inflow id"
  },
  "INVALID_AMBIGUITIES": {
    "stage": "schema",
    "path": "ambiguities",
    "reason": "invalid ambiguities"
  },
  "NORMALIZATION_FAILED": {
    "stage": "normalization",
    "path": "$",
    "reason": "normalization failed"
  },
  "UNKNOWN_INFLOW": {
    "stage": "domain",
    "path": "expected_inflow_id",
    "reason": "unknown inflow"
  },
  "CURRENCY_MISMATCH": {
    "stage": "domain",
    "path": "currency",
    "reason": "currency mismatch"
  },
  "UNKNOWN_SOURCE_INFLOW": {
    "stage": "domain",
    "path": "expected_inflow_id",
    "reason": "unknown source inflow"
  },
  "SOURCE_CURRENCY_MISMATCH": {
    "stage": "domain",
    "path": "currency",
    "reason": "source currency mismatch"
  },
  "IRRELEVANT_HAS_FACTS": {
    "stage": "domain",
    "path": "$",
    "reason": "irrelevant has facts"
  },
  "AMBIGUITY_MISSING": {
    "stage": "domain",
    "path": "$",
    "reason": "ambiguity missing"
  },
  "INCOMPLETE_FACTS": {
    "stage": "domain",
    "path": "$",
    "reason": "incomplete facts"
  },
  "UNEXPECTED_AMOUNT_CHANGE": {
    "stage": "domain",
    "path": "amount_minor",
    "reason": "unexpected amount change"
  },
  "UNSUPPORTED_AMOUNT_CHANGE": {
    "stage": "domain",
    "path": "amount_minor",
    "reason": "unsupported amount change"
  },
  "DOMAIN_VALIDATION_FAILED": {
    "stage": "domain",
    "path": "$",
    "reason": "domain validation failed"
  },
  "UNKNOWN_HAS_ETA": {
    "stage": "temporal",
    "path": "eta",
    "reason": "unknown has eta"
  },
  "INVALID_EXACT": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid exact"
  },
  "INVENTED_EXACT_TIME": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invented exact time"
  },
  "INVALID_DATE_PRECISION": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid date precision"
  },
  "INVALID_DAY_WINDOW": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid day window"
  },
  "INVALID_WINDOW_PRECISION": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid window precision"
  },
  "INCOMPLETE_ETA": {
    "stage": "temporal",
    "path": "eta",
    "reason": "incomplete eta"
  },
  "ETA_NOT_FULLY_FUTURE": {
    "stage": "temporal",
    "path": "eta",
    "reason": "eta not fully future"
  },
  "CONTRADICTORY_DELAY": {
    "stage": "temporal",
    "path": "eta",
    "reason": "contradictory delay"
  },
  "ALTERNATIVE_DATES_NOT_SINGLE_DATE": {
    "stage": "temporal",
    "path": "eta",
    "reason": "alternative dates not single date"
  },
  "SOURCE_DATE_MISMATCH": {
    "stage": "temporal",
    "path": "eta",
    "reason": "source date mismatch"
  },
  "INVALID_LOCAL_TIME": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid local time"
  },
  "NON_UNIQUE_LOCAL_TIME": {
    "stage": "temporal",
    "path": "eta",
    "reason": "non unique local time"
  },
  "INVALID_DATE": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid date"
  },
  "UNSUPPORTED_DAY": {
    "stage": "temporal",
    "path": "eta",
    "reason": "unsupported day"
  },
  "INVALID_WINDOW": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid window"
  },
  "INVALID_DAY_BOUNDARIES": {
    "stage": "temporal",
    "path": "eta",
    "reason": "invalid day boundaries"
  },
  "UNSUPPORTED_TIME_WINDOW": {
    "stage": "temporal",
    "path": "eta",
    "reason": "unsupported time window"
  },
  "CLOCK_MISMATCH": {
    "stage": "application",
    "path": "$",
    "reason": "clock mismatch"
  },
  "INVALID_PROVENANCE": {
    "stage": "application",
    "path": "$",
    "reason": "invalid provenance"
  },
  "INVALID_FACTS": {
    "stage": "application",
    "path": "$",
    "reason": "invalid facts"
  },
  "AMBIGUOUS_UPDATE": {
    "stage": "application",
    "path": "$",
    "reason": "ambiguous update"
  },
  "APPLICATION_IDENTITY_MISMATCH": {
    "stage": "application",
    "path": "expected_inflow_id",
    "reason": "application identity mismatch"
  },
  "APPLICATION_CURRENCY_MISMATCH": {
    "stage": "application",
    "path": "currency",
    "reason": "application currency mismatch"
  },
  "INFLOW_NOT_APPLICABLE": {
    "stage": "application",
    "path": "$",
    "reason": "inflow not applicable"
  },
  "INFLOW_CONTEXT_MISMATCH": {
    "stage": "application",
    "path": "amount_minor",
    "reason": "inflow context mismatch"
  },
  "ON_TIME_CONTEXT_MISMATCH": {
    "stage": "application",
    "path": "$",
    "reason": "on time context mismatch"
  },
  "APPLICATION_REJECTED": {
    "stage": "application",
    "path": "$",
    "reason": "application rejected"
  }
} as const;
export type DiagnosticCode=keyof typeof diagnosticCatalog;
export interface FundingDiagnostic {parser_stage:string;diagnostic_code:DiagnosticCode;field_path:string;reason:string}
export function diagnostic(code:DiagnosticCode,path?:string):FundingDiagnostic{return {parser_stage:diagnosticCatalog[code].stage,diagnostic_code:code,field_path:path??diagnosticCatalog[code].path,reason:diagnosticCatalog[code].reason};}
export class FundingDiagnosticError extends Error {readonly detail:FundingDiagnostic;constructor(detail:FundingDiagnostic){super('INTERPRETATION_REVIEW_REQUIRED');this.detail=detail;}}
export function reject(code:DiagnosticCode,path?:string):never{throw new FundingDiagnosticError(diagnostic(code,path));}
export function safeDiagnostic(error:unknown,fallback:DiagnosticCode='DOMAIN_VALIDATION_FAILED'):FundingDiagnostic {if(error instanceof FundingDiagnosticError)return error.detail;const code=error instanceof Error?error.message:'';return diagnostic(Object.hasOwn(diagnosticCatalog,code)?code as DiagnosticCode:fallback);}
