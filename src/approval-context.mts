import {createHash} from 'node:crypto';
import type {Evaluation} from './execution-controller.mts';
import type {StatementSnapshot,StatementPolicy,MoneyClaimPolicy} from './financial-statement-context.mts';

export const APPROVAL_VERSION=2 as const;
import type {ClaimSource,ProtectedClaim,ChangedField,ApprovalManifest} from './approval-types.d.mts';
export type {ProtectedClaim,ChangedField,ApprovalManifest,RevalidationEvidence} from './approval-types.d.mts';
export const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?x.toString():x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export const manifestFingerprint=(m:ApprovalManifest)=>{validateClaims(m.protectedClaims);return createHash('sha256').update(canonical(m)).digest('hex');};
/** Invalid definitions must never acquire a usable approval fingerprint. */
export function validateClaims(claims:ProtectedClaim[]):void {
  for(const c of claims){
    if(!c||!['MUST_EQUAL','MINIMUM'].includes(c.policy))throw Error('CLAIM_POLICY_REQUIRED_OR_INVALID');
    if(c.policy==='MINIMUM'&&(c.units!=='minor_units'||typeof c.threshold!=='string'||!/^(-?(0|[1-9]\d*))$/.test(c.threshold)))throw Error('CLAIM_THRESHOLD_INVALID');
    if(c.policy==='MUST_EQUAL'&&c.threshold!==undefined)throw Error('CLAIM_THRESHOLD_INVALID');
  }
}
export function validateStatementPolicy(policy:unknown):asserts policy is StatementPolicy {
  if(!policy||typeof policy!=='object'||Array.isArray(policy))throw Error('CLAIM_POLICY_REQUIRED_OR_INVALID');
  const p=policy as StatementPolicy;
  for(const r of [p.accountingCash,p.netCashChange]){
    if(!r||typeof r!=='object')throw Error('CLAIM_POLICY_REQUIRED_OR_INVALID');
    validateClaims([{claim:'statement',source:'t0',approvedValue:'0',units:'minor_units',...r}]);
  }
  if(p.maxCaptureAgeMs!==undefined&&(!Number.isSafeInteger(p.maxCaptureAgeMs)||p.maxCaptureAgeMs<0))throw Error('CLAIM_POLICY_REQUIRED_OR_INVALID');
}
const integer=(s:string)=>{if(!/^-?(0|[1-9]\d*)$/.test(s))throw Error('INVALID_CLAIM');return BigInt(s);};
/** Compare only selected claims. Policies/provenance cannot be relaxed by a current observation. */
export function changedClaims(approved:ProtectedClaim[],current:ProtectedClaim[]):ChangedField[]{
  validateClaims(approved);validateClaims(current);
  const key=(c:ProtectedClaim)=>c.source+':'+c.claim;
  if(new Set(approved.map(key)).size!==approved.length||new Set(current.map(key)).size!==current.length||approved.length!==current.length)throw Error('CLAIM_SET_INVALID');
  const changes:ChangedField[]=[];
  for(const a of approved){
    const c=current.find(x=>key(x)===key(a));if(!c||typeof a.approvedValue!=='string'||typeof c.approvedValue!=='string')throw Error('CLAIM_MISSING');
    const {approvedValue:av,...ap}=a,{approvedValue:cv,...cp}=c;
    if(!['MUST_EQUAL','MINIMUM'].includes(a.policy))throw Error('CLAIM_POLICY_INVALID');
    let holds=canonical(ap)===canonical(cp);
    if(a.units==='minor_units'){integer(av);integer(cv);}
    if(a.policy==='MINIMUM'){
      if(a.units!=='minor_units'||a.threshold===undefined)throw Error('CLAIM_THRESHOLD_INVALID');
      const threshold=integer(a.threshold);if(integer(av)<threshold)throw Error('APPROVED_CLAIM_OUTSIDE_POLICY');
      holds=holds&&integer(cv)>=threshold;
    }else holds=holds&&av===cv;
    if(!holds)changes.push({...a,currentValue:cv});
  }
  return changes;
}
export function statementClaims(s:StatementSnapshot):ProtectedClaim[]{
  validateStatementPolicy(s.policy);
  const provenance={entityRef:s.entityRef,periodStart:s.periodStart,periodEnd:s.periodEnd,currency:s.reportCurrency};
  const claim=(key:string,value:string,rule:MoneyClaimPolicy):ProtectedClaim=>({claim:key,source:'t0',approvedValue:value,policy:rule.policy,...(rule.policy==='MINIMUM'?{threshold:rule.threshold}:{}),units:'minor_units',...provenance});
  return [claim('accounting_cash',s.accountingCashMinor,s.policy.accountingCash),claim('net_cash_change',s.netCashChangeMinor,s.policy.netCashChange),
    ...(s.policy?.maxCaptureAgeMs===undefined?[]:[{claim:'statement_max_capture_age',source:'duegate' as const,approvedValue:String(s.policy.maxCaptureAgeMs),policy:'MUST_EQUAL' as const,units:'milliseconds' as const}])];
}
/** Explicit projection: never hash provider objects, unknown fields, capturedAt or raw reports. */
export function approvalManifest(p:Pick<Evaluation,'input'|'quote'|'statement'>):ApprovalManifest{
  const i=p.input,t=i.treasury,f=i.fx_policy,q=p.quote;
  const claims:ProtectedClaim[]=[];
  const add=(claim:string,source:ClaimSource,value:unknown,policy:ProtectedClaim['policy'],units?:ProtectedClaim['units'],currency?:string)=>claims.push({claim,source,approvedValue:typeof value==='object'&&value!==null?canonical(value):String(value??'null'),policy,...(units?{units}:{}),...(currency?{currency}:{})});
  for(const key of ['beneficiary_id','currency','status'] as const)add('payment.'+key,'payment',i.payable[key],'MUST_EQUAL');
  add('payment.amount','payment',i.payable.amount,'MUST_EQUAL','minor_units',i.payable.currency);
  for(const key of ['due_at','latest_safe_execution_at'] as const)add('payment.'+key,'duegate',i.payable[key],'MUST_EQUAL','utc');
  add('wallet.available','airwallex',t.wallet_balance,'MUST_EQUAL','minor_units',t.source_currency);
  add('source_currency','airwallex',t.source_currency,'MUST_EQUAL');
  for(const key of ['fixed_reserve','committed_amount','expected_inflow_amount'] as const)add('treasury.'+key,'duegate',t[key],'MUST_EQUAL','minor_units',t.source_currency);
  for(const key of ['expected_inflow_id','expected_inflow_eta','expected_inflow_status'] as const)add('treasury.'+key,'duegate',t[key],'MUST_EQUAL');
  const w=t.expected_inflow_eta_window;
  add('treasury.expected_inflow_window','duegate',w?{start:w.start,end:w.end,date:w.date,timezone:w.timezone,precision:w.precision}:null,'MUST_EQUAL');
  add('funding.required_amount','duegate',i.funding.required_amount,'MUST_EQUAL','minor_units',i.funding.source_currency);
  for(const key of ['source_currency','target_currency','quote_expiry'] as const)add('fx_policy.'+key,'duegate',f[key],'MUST_EQUAL');
  add('fx_policy.max_rate','duegate',{numerator:f.max_acceptable_rate?.numerator,denominator:f.max_acceptable_rate?.denominator},'MUST_EQUAL','ratio');
  add('quote.present','airwallex',q!==null,'MUST_EQUAL');
  if(q){
    for(const key of ['quote_id','source_currency','target_currency','expires_at','rate','currency_pair','valid_from_at','conversion_date','usage'] as const)add('quote.'+key,'airwallex',q[key],'MUST_EQUAL');
    for(const key of ['source_amount','target_amount','source_fee_amount'] as const)add('quote.'+key,'airwallex',q[key],'MUST_EQUAL','minor_units',key==='target_amount'?q.target_currency:q.source_currency);
  }
  if(p.statement)claims.push(...statementClaims(p.statement));
  return {approvalVersion:APPROVAL_VERSION,paymentIdentity:{payableId:i.payable.payable_id,supplierId:i.payable.supplier_id},protectedClaims:claims.sort((a,b)=>(a.source+':'+a.claim).localeCompare(b.source+':'+b.claim))};
}
export function changedManifest(approved:ApprovalManifest,current:ApprovalManifest):ChangedField[]{
  if(approved.approvalVersion!==APPROVAL_VERSION||current.approvalVersion!==APPROVAL_VERSION||canonical(approved.paymentIdentity)!==canonical(current.paymentIdentity))throw Error('APPROVAL_IDENTITY_OR_VERSION_INVALID');
  return changedClaims(approved.protectedClaims,current.protectedClaims);
}
