import type { FxQuote } from './decision-engine.mts';

/** Provider boundary: normalized monetary values are minor units. */
export interface WalletBalance { currency: string; available: bigint; pending: bigint; total: bigint }
export interface QuoteRequest { source_currency: string; target_currency: string; target_amount: bigint }
export interface QuotedFx extends FxQuote {
  rate: string;
  currency_pair: string;
  valid_from_at: string;
  conversion_date: string;
  usage: string;
}
export interface Beneficiary { id: string; currency: string; country: string; transfer_methods: string[] }
export interface ConversionPayload {
  buy_currency: string; sell_currency: string; buy_amount: string;
  quote_id: string; request_id: string; conversion_date: string;
}
export interface TransferPayload {
  beneficiary_id: string; transfer_amount: string; transfer_currency: string;
  source_currency: string; transfer_method: 'LOCAL'; reason: 'technical_services'; reference: string; request_id: string;
}
export interface ConversionResult { id: string; status: string; quote_id: string; request_id: string; source_amount: bigint; target_amount: bigint }
export interface TransferResult { id: string; status: string; request_id: string; amount: bigint; currency: string; fee_amount?: bigint; fee_currency?: string; failure_type?: string; failure_reason?: string; failure?: { code?: string; message?: string; details?: { type?: string; reason_codes?: string[] } } }
export interface AirwallexAdapter {
  getWalletBalances(): Promise<WalletBalance[]>;
  createFxQuote(request: QuoteRequest): Promise<QuotedFx>;
  getRelevantBeneficiary(id: string): Promise<Beneficiary>;
  createConversion(payload: ConversionPayload): Promise<ConversionResult>;
  getConversion(id: string): Promise<ConversionResult>;
  validateTransfer(payload: TransferPayload): Promise<void>;
  createTransfer(payload: TransferPayload): Promise<TransferResult>;
  getTransfer(id: string): Promise<TransferResult>;
}

export function minor(value: unknown): bigint {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid two-decimal monetary value');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function major(value: bigint): string {
  if (value < 0n) throw new Error('Negative monetary value');
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function transferFailure(r: Record<string,unknown>): Pick<TransferResult,'failure_type'|'failure_reason'|'failure'> {
  const text=(v:unknown)=>typeof v==='string'?v:undefined;
  const result:Pick<TransferResult,'failure_type'|'failure_reason'|'failure'>={};
  if(text(r.failure_type)!==undefined)result.failure_type=text(r.failure_type);
  if(text(r.failure_reason)!==undefined)result.failure_reason=text(r.failure_reason);
  if(r.failure && typeof r.failure==='object' && !Array.isArray(r.failure)){
    const f=r.failure as Record<string,unknown>,d=f.details as Record<string,unknown>|undefined;
    result.failure={...(text(f.code)!==undefined?{code:text(f.code)}:{}),...(text(f.message)!==undefined?{message:text(f.message)}:{}),
      ...(d&&typeof d==='object'?{details:{...(text(d.type)!==undefined?{type:text(d.type)}:{}),...(Array.isArray(d.reason_codes)&&d.reason_codes.every(x=>typeof x==='string')?{reason_codes:d.reason_codes as string[]}:{})}}:{})};
  }
  return result;
}

/** Whitelisted partial evidence only; never retains a raw provider response. */
export class AmbiguousTransferResponse extends Error {
  readonly evidence:{id?:string;request_id?:string;status:string}&Pick<TransferResult,'failure_type'|'failure_reason'|'failure'>;
  constructor(evidence:AmbiguousTransferResponse['evidence']){super('Ambiguous transfer response; manual review required');this.evidence=evidence;}
}
