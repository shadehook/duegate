import type {Decision,RevalidationEvidence,ChangedField} from '../src/approval-types.d.mts';
export interface CaseView {
  contextRevalidation?:RevalidationEvidence;
  statementScene?:StatementScene;
  statementTerms?:{start:string;end:string;cash:string;net:string};
  accountingCheck?:AccountingCheckView;
  interpreterProvider?:'claude'|'deterministic';
  fundingPreviousEta?:string;
  presentationMode?:boolean;recordedAttached?:boolean;connectionLabel?:string;approvalReason?:string;recordedFunding?:string;recordedFee?:string;
  finalProof?:boolean;financialWritesEnabled?:boolean;quoteLimit?:string;fundingExample?:string;
  approval:null|{actor_type?:'HUMAN';actor_display_label?:string;approval_id:string;payable_id:string;approved_at:string|null;approved_by:string|null;execution_fingerprint:string;quote_id:string;expires_at:string;status:'PENDING'|'APPROVED'|'INVALIDATED'|'USED'};
  canApprove:boolean;quoteFreshness:'NONE'|'FRESH'|'EXPIRED'|'INVALID';
  mode:'dry'|'sandbox';caseId:string;payableId:string;supplier:string;amount:string;due:string;cutoff:string;clock:string;
  source:'USD';target:'EUR';beneficiary:string;connected:boolean;balanceAsOf:string|null;
  treasury:{balance:string;reserve:string;committed:string;free:string;required:string;inflow:string;eta:string};
  decision:Decision|'UNAVAILABLE';reason:string;transition:string|null;canExecute:boolean;canApply:boolean;review:boolean;
  facts:null|{classification:string;inflow:string;amount:string;precision:string;date:string|null;exact:string|null;windowStart:string|null;windowEnd:string|null;hash:string};
  quote:null|{id:string;rate:string;expires:string;sourceAmount:string;targetAmount:string};
  preview:null|{key:string;digest:string;reserveRemaining:string};
  result:null|{conversionId:string;conversionStatus:string;transferId:string;transferStatus:string;usdBefore:string;usdAfter:string;eurBefore:string;eurAfter:string};
  executionState:string;financialWrites:number|null;conversionCount:number;transferCount:number;error:string|null;
  audit:{at:string;event:string;detail:string}[];
}
interface StatementCheckView {
  decisionDate:string;coversDecisionDate:boolean|null;decision:'ESCALATE'|'REAPPROVAL_REQUIRED'|null;
  approvalVersion:number;changedFields:ChangedField[];
  result:'FINANCIAL_CONTEXT_OK'|'FINANCIAL_CONTEXT_CHANGED'|'FINANCIAL_CONTEXT_INCOMPLETE'|'FINANCIAL_CONTEXT_OUT_OF_PERIOD'|'FINANCIAL_CONTEXT_STALE';
}
export interface StatementScene {
  mode:'recorded'; periodStart:string|null;periodEnd:string|null;capturedAt:string|null;currency:string|null;
  cash:string|null;net:string|null;fingerprint:string;sourceRefs:readonly string[];
  initial:StatementCheckView;later:StatementCheckView;
  materialChange?:RevalidationEvidence;
}
/** Sanitized read model; contains no provider IDs, credentials or execution input. */
export interface AccountingCheckView {
  source:'t0';evidenceMode:'recorded'|'live';reference:string;amount:string;currency:'USD';
  accountingStatus:'open'|'voided'|'drafted'|'paid';dueDate:string|null;paidDate:string|null;
  capturedAt:string;sourceAsOf:string|null;
  decision:'BLOCK_DUPLICATE'|'NOT_EVALUATED';reason:'EXECUTION_BLOCKED'|'ACCOUNTING_STATUS_NOT_PAID';
  canExecute:false;fxQuoteRequests:0;conversionRequests:0;transferRequests:0;
}
