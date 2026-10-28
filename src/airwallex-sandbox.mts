import { readFileSync } from 'node:fs';
import type { AirwallexAdapter, WalletBalance, QuoteRequest, QuotedFx, Beneficiary, ConversionPayload, TransferPayload, ConversionResult, TransferResult } from './airwallex-adapter.mts';
import { minor, major, transferFailure, AmbiguousTransferResponse } from './airwallex-adapter.mts';

type Json = Record<string, unknown>;
function object(v: unknown): Json { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Unexpected API object'); return v as Json; }
function str(v: unknown): string { if (typeof v !== 'string' || !v) throw new Error('Missing API string'); return v; }
function utc(v: unknown): string { const date = new Date(str(v)); if (!Number.isFinite(date.getTime())) throw new Error('Invalid API timestamp'); return date.toISOString(); }
function isoCurrency(v: unknown): string { const s = str(v); if (!/^[A-Z]{3}$/.test(s)) throw new Error('Invalid currency'); return s; }
function safeId(v: unknown): string { const s = str(v); if (!/^[a-zA-Z0-9_-]{1,100}$/.test(s)) throw new Error('Invalid provider identifier'); return s; }

/** Fixed sandbox origin, no redirects, no retries, no raw response/credential logging.
 * Financial writes require an explicit constructor opt-in; the demo defaults to reads/quotes only.
 */
export class AirwallexSandbox implements AirwallexAdapter {
  private token: string | null = null;
  private readonly client: string;
  private readonly key: string;
  private readonly writes: boolean;
  readonly calls: { operation: string; method: string; status: number }[] = [];
  constructor(envFile: string, options: { financialWritesEnabled?: boolean } = {}) {
    const env: Record<string, string> = {};
    for (const line of readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = line.match(/^\s*(AIRWALLEX_CLIENT_ID|AIRWALLEX_API_KEY)\s*=\s*(.*?)\s*$/);
      if (!match) { if (/^\s*AIRWALLEX_/.test(line)) throw new Error('Invalid local credential configuration'); continue; }
      if (Object.hasOwn(env, match[1])) throw new Error('Invalid local credential configuration');
      env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    if (!env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY) throw new Error('Missing local credentials');
    this.client = env.AIRWALLEX_CLIENT_ID; this.key = env.AIRWALLEX_API_KEY;
    this.writes = options.financialWritesEnabled === true;
  }
  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const login = path === '/authentication/login';
    if (!login && !this.token) {
      const auth = object(await this.request('POST', '/authentication/login'));
      this.token = str(auth.token);
    }
    let response: Response;
    try {
      response = await fetch('https://api.sandbox.airwallex.com/api/v1' + path, {
        method, headers: { 'Content-Type': 'application/json', 'x-api-version': '2026-08-21',
          ...(login ? { 'x-client-id': this.client, 'x-api-key': this.key } : { Authorization: `Bearer ${this.token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000),
      });
    } catch { throw new Error('Sandbox network failure; no automatic retry'); }
    this.calls.push({ operation: path, method, status: response.status });
    if (!response.ok) {
      // Expose only schema diagnostics, never a raw error body or submitted values.
      const failure = await response.text();
      const fields = ['request_id', 'reference', 'transfer_amount', 'beneficiary_id', 'reason', 'transfer_date'].filter(field => failure.includes(field));
      const constraints = ['length', 'maximum', 'minimum', 'required', 'invalid', 'characters'].filter(word => failure.toLowerCase().includes(word));
      throw new Error(`Sandbox HTTP ${response.status}; fields=${fields.join(',')}; constraints=${constraints.join(',')}`);
    }
    const text = await response.text();
    if (text.trim() === 'OK') return 'OK';
    try { return JSON.parse(text) as unknown; } catch { throw new Error('Unexpected sandbox response'); }
  }
  async getWalletBalances(): Promise<WalletBalance[]> {
    const rows = await this.request('GET', '/balances/current');
    if (!Array.isArray(rows)) throw new Error('Unexpected balances shape');
    return rows.map(object).filter(r => r.account_type === 'cash').map(r => ({ currency: isoCurrency(r.currency), available: minor(r.available_amount), pending: minor(r.pending_amount), total: minor(r.total_amount) }));
  }
  async createFxQuote(request: QuoteRequest): Promise<QuotedFx> {
    if (request.source_currency !== 'USD' || request.target_currency !== 'EUR' || request.target_amount <= 0n || request.target_amount > 1000n) throw new Error('Spike quote scope exceeded');
    const q = object(await this.request('POST', '/fx/quotes/create', { buy_currency: 'EUR', sell_currency: 'USD', buy_amount: Number(major(request.target_amount)), validity: 'MIN_15' }));
    // No application fees configured. A nonempty returned fee list needs explicit mapping.
    if (q.application_fees !== undefined && (!Array.isArray(q.application_fees) || q.application_fees.length !== 0)) throw new Error('Quote fee mapping unverified');
    const quote: QuotedFx = { quote_id: safeId(q.quote_id), source_currency: isoCurrency(q.sell_currency), target_currency: isoCurrency(q.buy_currency),
      source_amount: minor(q.sell_amount), target_amount: minor(q.buy_amount), source_fee_amount: 0n,
      expires_at: utc(q.valid_to_at), valid_from_at: utc(q.valid_from_at), rate: String(q.client_rate), currency_pair: str(q.currency_pair),
      conversion_date: str(q.conversion_date), usage: str(q.usage) };
    if (quote.source_currency !== request.source_currency || quote.target_currency !== request.target_currency || quote.target_amount !== request.target_amount
      || !/^\d+(\.\d+)?$/.test(quote.rate) || Number(quote.rate) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(quote.conversion_date)) throw new Error('Quote does not match request');
    return quote;
  }
  async getRelevantBeneficiary(id: string): Promise<Beneficiary> {
    const r = object(await this.request('GET', '/beneficiaries/' + safeId(id)));
    const bank = object(object(r.beneficiary).bank_details);
    if (!Array.isArray(r.transfer_methods) || !r.transfer_methods.every(x => typeof x === 'string')) throw new Error('Unexpected beneficiary methods');
    return { id: safeId(r.id), currency: isoCurrency(bank.account_currency), country: str(bank.bank_country_code), transfer_methods: r.transfer_methods as string[] };
  }
  private allowWrite(): void { if (!this.writes) throw new Error('FINANCIAL_WRITES_DISABLED'); }
  async createConversion(payload: ConversionPayload): Promise<ConversionResult> {
    this.allowWrite();
    const r = object(await this.request('POST', '/fx/conversions/create', payload));
    return this.conversion(r);
  }
  private conversion(r: Json): ConversionResult {
    return { id: safeId(r.conversion_id), status: str(r.status), quote_id: safeId(r.quote_id), request_id: safeId(r.request_id), source_amount: minor(r.sell_amount), target_amount: minor(r.buy_amount) };
  }
  async getConversion(id: string): Promise<ConversionResult> {
    return this.conversion(object(await this.request('GET', '/fx/conversions/' + safeId(id))));
  }
  async validateTransfer(payload: TransferPayload): Promise<void> {
    if (await this.request('POST', '/transfers/validate', payload) !== 'OK') throw new Error('Transfer validation not OK');
  }
  private transfer(r: Json): TransferResult { return { ...transferFailure(r), id: safeId(r.id), status: str(r.status), request_id: safeId(r.request_id), amount: minor(r.transfer_amount), currency: isoCurrency(r.transfer_currency),
    ...(r.fee_amount === undefined ? {} : { fee_amount: minor(r.fee_amount), fee_currency: isoCurrency(r.fee_currency) }) }; }
  async createTransfer(payload: TransferPayload): Promise<TransferResult> {
    this.allowWrite(); const r=object(await this.request('POST','/transfers/create',payload));
    try{return this.transfer(r);}catch{
      const id=typeof r.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)?r.id:undefined;
      const request_id=typeof r.request_id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(r.request_id)?r.request_id:payload.request_id;
      throw new AmbiguousTransferResponse({id,request_id,status:'UNKNOWN_RESPONSE',...transferFailure(r)});
    }
  }
  async getTransfer(id: string): Promise<TransferResult> { return this.transfer(object(await this.request('GET', '/transfers/' + safeId(id)))); }
}
