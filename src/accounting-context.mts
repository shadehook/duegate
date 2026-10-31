import {createHash} from 'node:crypto';
import {decide} from './decision-engine.mts';

export type AccountingStatus = 'open' | 'voided' | 'drafted' | 'paid';
export interface AccountingContext {
  source: 't0'; entityId: string; recordType: 'VendorBill'; recordId: string; vendorId: string | null;
  amountMinor: bigint; currency: string; status: AccountingStatus;
  dueDate: string | null; paidDate: string | null;
  sourceAsOf: string | null; capturedAt: string; sourceRefs: readonly string[];
}
export interface AccountingBinding {
  entityId: string; recordId: string; expectedAmountMinor: bigint; expectedCurrency: 'USD';
}
export type AccountingCode = 'INVALID_IDENTITY' | 'INVALID_CURRENCY' | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_STATUS' | 'INVALID_DATE' | 'INVALID_PROVENANCE' | 'UNEXPECTED_FIELD'
  | 'IDENTITY_MISMATCH' | 'OBLIGATION_MISMATCH' | 'INVALID_RECORDED_EVIDENCE' | 'ENGINE_BLOCK_REQUIRED';
export class AccountingError extends Error {
  readonly code: AccountingCode;
  constructor(code: AccountingCode) { super(code); this.name = 'AccountingError'; this.code = code; }
}
const fail = (code: AccountingCode): never => { throw new AccountingError(code); };
export function accountingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_.\/-]{0,511}$/.test(value)) return fail('INVALID_IDENTITY');
  return value;
}
/** USD only in this narrow demonstration. Never round an accounting amount. */
export function usdMinor(value: unknown): bigint {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(0|[1-9]\d{0,12})(\.\d{1,2})?$/.test(text)) return fail('INVALID_AMOUNT');
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor <= 0n) return fail('INVALID_AMOUNT');
  return minor;
}
function dateOnly(value: unknown): void {
  if (value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('INVALID_DATE');
}
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value.replace(/(\.\d{3})\d+Z$/, '$1Z')) fail('INVALID_PROVENANCE');
}
export function accountingRefs(entityId: string, recordId: string, vendorId: string | null): string[] {
  return ['t0:entity:' + entityId, 't0:VendorBill:' + recordId, ...(vendorId === null ? [] : ['t0:Vendor:' + vendorId])];
}
export function validateAccountingContext(value: unknown): AccountingContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_PROVENANCE');
  const x = value as Record<string, unknown>;
  const fields = ['source','entityId','recordType','recordId','vendorId','amountMinor','currency','status','dueDate','paidDate','sourceAsOf','capturedAt','sourceRefs'];
  if (Object.keys(x).length !== fields.length || Object.keys(x).some(k => !fields.includes(k))) return fail('UNEXPECTED_FIELD');
  if (x.source !== 't0' || x.recordType !== 'VendorBill') return fail('INVALID_PROVENANCE');
  accountingId(x.entityId); accountingId(x.recordId); if (x.vendorId !== null) accountingId(x.vendorId);
  if (x.currency !== 'USD') return fail('INVALID_CURRENCY');
  if (typeof x.amountMinor !== 'bigint' || x.amountMinor <= 0n || x.amountMinor > 999999999999999n) return fail('INVALID_AMOUNT');
  if (typeof x.status !== 'string' || !['open','voided','drafted','paid'].includes(x.status)) return fail('UNSUPPORTED_STATUS');
  dateOnly(x.dueDate); dateOnly(x.paidDate); timestamp(x.capturedAt);
  if (x.sourceAsOf !== null) { timestamp(x.sourceAsOf); if (Date.parse(x.sourceAsOf) > Date.parse(x.capturedAt)) return fail('INVALID_PROVENANCE'); }
  // A paid date supports this demonstration; absent or future evidence requires review.
  if (x.status === 'paid' && (x.paidDate === null || String(x.paidDate) > x.capturedAt.slice(0, 10))) return fail('INVALID_DATE');
  const refs = accountingRefs(x.entityId as string, x.recordId as string, x.vendorId as string | null);
  if (!Array.isArray(x.sourceRefs) || JSON.stringify(x.sourceRefs) !== JSON.stringify(refs)) return fail('INVALID_PROVENANCE');
  return Object.freeze({...x, sourceRefs: Object.freeze(refs)}) as unknown as AccountingContext;
}
export function validateAccountingBinding(value: AccountingBinding): AccountingBinding {
  accountingId(value.entityId); accountingId(value.recordId);
  if (value.expectedCurrency !== 'USD') return fail('INVALID_CURRENCY');
  if (typeof value.expectedAmountMinor !== 'bigint' || value.expectedAmountMinor <= 0n || value.expectedAmountMinor > 999999999999999n) return fail('INVALID_AMOUNT');
  return Object.freeze({entityId:value.entityId, recordId:value.recordId, expectedCurrency:value.expectedCurrency, expectedAmountMinor:value.expectedAmountMinor});
}
export function bindAccountingContext(value: unknown, binding: AccountingBinding): AccountingContext {
  const x = validateAccountingContext(value), b = validateAccountingBinding(binding);
  if (x.entityId !== b.entityId || x.recordId !== b.recordId) return fail('IDENTITY_MISMATCH');
  if (x.currency !== b.expectedCurrency || x.amountMinor !== b.expectedAmountMinor) return fail('OBLIGATION_MISMATCH');
  return x;
}
export interface AccountingCheckResult {
  source: 't0'; evidenceMode: 'recorded' | 'live'; reference: string;
  amount: string; currency: 'USD'; accountingStatus: AccountingStatus;
  dueDate: string | null; paidDate: string | null; capturedAt: string; sourceAsOf: string | null;
  decision: 'BLOCK_DUPLICATE' | 'NOT_EVALUATED'; reason: 'EXECUTION_BLOCKED' | 'ACCOUNTING_STATUS_NOT_PAID';
  canExecute: false; fxQuoteRequests: 0; conversionRequests: 0; transferRequests: 0;
}
/** No controller, provider, approval store or ledger capability enters this function. */
export function evaluateAccountingCheck(value: unknown, binding: AccountingBinding, evidenceMode: 'recorded' | 'live'): AccountingCheckResult {
  const x = bindAccountingContext(value, binding);
  if (evidenceMode !== 'recorded' && evidenceMode !== 'live') return fail('INVALID_PROVENANCE');
  const identity = createHash('sha256').update(JSON.stringify(['t0',x.entityId,x.recordId])).digest('hex');
  let decision: AccountingCheckResult['decision'] = 'NOT_EVALUATED', reason: AccountingCheckResult['reason'] = 'ACCOUNTING_STATUS_NOT_PAID';
  if (x.status === 'paid') {
    // An isolated, permanently closed evaluation envelope. These timestamps are NOT
    // derived from accounting dates. There is no beneficiary mapping or execution intent.
    const closed = '1970-01-01T00:00:00.000Z';
    const result = decide({
      payable:{payable_id:'t0-accounting-'+identity,supplier_id:'accounting-only',beneficiary_id:'unmapped-accounting-only',amount:x.amountMinor,currency:x.currency,due_at:closed,latest_safe_execution_at:closed,status:'paid'},
      treasury:{source_currency:'USD',wallet_balance:0n,fixed_reserve:0n,committed_amount:0n,expected_inflow_id:null,expected_inflow_amount:0n,expected_inflow_eta:null,expected_inflow_status:'none'},
      funding:{source_currency:'USD',required_amount:x.amountMinor},
      fx_policy:{source_currency:'USD',target_currency:'USD',max_acceptable_rate:{numerator:1n,denominator:1n},quote_expiry:null},
      quote:null,execution:{state:'no_execution',transfer_id:null},now:x.capturedAt.slice(0,23)+'Z',
    });
    if (result.decision !== 'BLOCK_DUPLICATE' || result.reason !== 'EXECUTION_BLOCKED') return fail('ENGINE_BLOCK_REQUIRED');
    decision = result.decision; reason = result.reason;
  }
  return Object.freeze({source:'t0',evidenceMode,reference:'accounting-'+identity.slice(0,16),amount:(x.amountMinor/100n)+'.'+(x.amountMinor%100n).toString().padStart(2,'0'),currency:'USD',accountingStatus:x.status,dueDate:x.dueDate,paidDate:x.paidDate,capturedAt:x.capturedAt,sourceAsOf:x.sourceAsOf,decision,reason,canExecute:false,fxQuoteRequests:0,conversionRequests:0,transferRequests:0});
}
export const RECORDED_ACCOUNTING_BINDING: AccountingBinding = Object.freeze({entityId:'recorded-t0-sandbox',recordId:'recorded-bill-57c3e6aecd',expectedAmountMinor:499813n,expectedCurrency:'USD'});
export function recordedAccountingCheck(value: unknown): AccountingCheckResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_RECORDED_EVIDENCE');
  const x = value as Record<string, unknown>;
  if (typeof x.amountMinor !== 'string' || !/^[1-9]\d{0,14}$/.test(x.amountMinor)
    || x.vendorId !== 'recorded-vendor-70c456a0d0') return fail('INVALID_RECORDED_EVIDENCE');
  return evaluateAccountingCheck({...x,amountMinor:BigInt(x.amountMinor)},RECORDED_ACCOUNTING_BINDING,'recorded');
}
