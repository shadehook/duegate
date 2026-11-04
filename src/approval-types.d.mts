/** Shared, declaration-only contracts. No provider or execution code enters the browser. */
export type Decision='WAIT'|'EXECUTE'|'REAPPROVAL_REQUIRED'|'ESCALATE'|'BLOCK_DUPLICATE';
export type ClaimSource='t0'|'airwallex'|'duegate'|'payment';
export interface ProtectedClaim {
  claim:string; source:ClaimSource; approvedValue:string;
  policy:'MUST_EQUAL'|'MINIMUM'; threshold?:string;
  units?:'minor_units'|'milliseconds'|'utc'|'ratio'; currency?:string;
  entityRef?:string; periodStart?:string; periodEnd?:string;
}
export interface ChangedField extends ProtectedClaim {currentValue:string}
export interface ApprovalManifest {
  approvalVersion:2;
  paymentIdentity:{payableId:string;supplierId:string};
  protectedClaims:ProtectedClaim[];
}
export interface RevalidationEvidence {
  decision:'REAPPROVAL_REQUIRED'|'ESCALATE'; reasonCode:string;
  approvalVersion:number; changedFields:ChangedField[];
  airwallexWritesAttempted:number;
}
