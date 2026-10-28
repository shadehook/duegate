import { createHash } from 'node:crypto';
import { decide, logicalExecutionKey } from './decision-engine.mts';
import type { DecisionInput, DecisionResult } from './decision-engine.mts';
import type { AirwallexAdapter, QuotedFx, ConversionPayload, TransferPayload, WalletBalance, TransferResult, ConversionResult } from './airwallex-adapter.mts';
import { major, AmbiguousTransferResponse } from './airwallex-adapter.mts';
import { ExecutionLedger } from './execution-ledger.mts';
import type {ExactAuthorization} from './approval-store.mts';

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? { __duegate_bigint: v.toString() } : v);
}
export function deserialize<T>(text: string): T {
  return JSON.parse(text, (_k, v) => v && typeof v === 'object' && Object.keys(v).length === 1 && '__duegate_bigint' in v ? BigInt(v.__duegate_bigint) : v) as T;
}
export const digest = (value: unknown): string => createHash('sha256').update(serialize(value)).digest('hex');
// Deterministic UUIDv5 in the DNS namespace; provider request IDs are independent
// from the full application execution key. Both operations retain stable IDs.
export const providerId = (key: string, operation: string): string => {
  const bytes = createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex')).update(`${key}:${operation}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
export interface Evaluation { input: DecisionInput; decision: DecisionResult; quote: QuotedFx | null; raw_balance: WalletBalance }
export interface PreparedExecution {
  decision: 'EXECUTE'; logical_execution_key: string; input: DecisionInput; quote: QuotedFx;
  conversion: ConversionPayload; transfer: TransferPayload; raw_balance: WalletBalance;
}
export interface Preview { prepared: PreparedExecution; digest: string }
export type ContinuationResult = { decision: 'BLOCK_DUPLICATE'; state: string }
  | { decision: 'EXECUTE'; fingerprint: string; quote: QuotedFx; before: WalletBalance[]; afterConversion: WalletBalance[];
      after: WalletBalance[]; conversion: ConversionResult; transfer: TransferResult };
export class ExecutionController {
  private readonly adapter: AirwallexAdapter;
  private readonly ledger: ExecutionLedger;
  private readonly clock: () => string;
  constructor(adapter: AirwallexAdapter, ledger: ExecutionLedger, clock: () => string) { this.adapter = adapter; this.ledger = ledger; this.clock = clock; }
  private async sourceBalance(currency: string): Promise<WalletBalance> {
    const rows = (await this.adapter.getWalletBalances()).filter(b => b.currency === currency);
    if (rows.length !== 1 || rows[0].available < 0n) throw new Error('Ambiguous source cash balance');
    return rows[0];
  }
  async evaluate(config: DecisionInput): Promise<Evaluation> {
    const input = structuredClone(config);
    const raw = await this.sourceBalance(input.treasury.source_currency);
    input.treasury.wallet_balance = raw.available;
    input.now = this.clock(); input.quote = null; input.fx_policy.quote_expiry = null;
    if (this.ledger.hasClaim(input.payable.payable_id)) input.execution.state = 'executing';
    let result = decide(input), quote: QuotedFx | null = null;
    // Engine asks for a quote only after duplicate/cutoff/cash gates pass.
    if (result.reason === 'QUOTE_MISSING') {
      quote = await this.adapter.createFxQuote({ source_currency: input.treasury.source_currency, target_currency: input.payable.currency, target_amount: input.payable.amount });
      input.quote = quote; input.fx_policy.quote_expiry = quote.expires_at; input.now = this.clock();
      if (Date.parse(quote.valid_from_at) > Date.parse(input.now)) throw new Error('Quote not yet valid');
      result = decide(input);
    }
    return { input, decision: result, quote, raw_balance: raw };
  }
  async prepare(evaluation: Evaluation, authorization?: ExactAuthorization): Promise<Preview> {
    const { input, quote } = structuredClone(evaluation);
    const raw_balance = await this.sourceBalance(input.treasury.source_currency);
    input.treasury.wallet_balance = raw_balance.available;
    input.now = this.clock();
    if (!quote || decide(input).decision !== 'EXECUTE' || this.ledger.hasClaim(input.payable.payable_id)) throw new Error('Preview gate blocked');
    // Reject a caller replacing the domain quote independently from its provider evidence.
    if (serialize(input.quote) !== serialize(quote)) throw new Error('Quote evidence mutated');
    const beneficiary = await this.adapter.getRelevantBeneficiary(input.payable.beneficiary_id);
    if (beneficiary.id !== input.payable.beneficiary_id || beneficiary.country !== 'DE' || beneficiary.currency !== 'EUR' || !beneficiary.transfer_methods.includes('LOCAL')) throw new Error('Beneficiary corridor mismatch');
    if (input.treasury.source_currency !== 'USD' || input.payable.currency !== 'EUR' || input.payable.amount > 1000n) throw new Error('Controlled spike scope exceeded');
    const key = logicalExecutionKey(input.payable.payable_id);
    const conversion: ConversionPayload = { buy_currency: 'EUR', sell_currency: 'USD', buy_amount: major(input.payable.amount), quote_id: quote.quote_id, request_id: providerId(key, 'conversion'), conversion_date: quote.conversion_date };
    const transfer: TransferPayload = { beneficiary_id: beneficiary.id, transfer_amount: major(input.payable.amount), transfer_currency: 'EUR', source_currency: 'EUR', transfer_method: 'LOCAL', reason: 'technical_services', reference: 'DueGate Phase7 sandbox', request_id: providerId(key, 'transfer') };
    await this.adapter.validateTransfer(transfer);
    input.now = this.clock();
    if (decide(input).decision !== 'EXECUTE') throw new Error('Preview expired during validation');
    const prepared: PreparedExecution = { decision: 'EXECUTE', logical_execution_key: key, input, quote, conversion, transfer, raw_balance };
    authorization?.check(prepared);
    const hash = digest(prepared);
    if (!this.ledger.claim(input, hash).accepted) throw new Error('Execution claim already exists');
    this.ledger.savePreparation(input.payable.payable_id, hash, serialize(prepared));
    return { prepared, digest: hash };
  }
  /** Future entry point; Phase 7 runner NEVER calls this. Mock tests only.
   * Resume only the exact claimed preview with its separately approved digest.
   * Any started attempt is non-retriable here; reconcile it externally.
   */
  async executeApproved(preview: Preview, approvedDigest: string): Promise<TransferResult> {
    if(preview.prepared.input.payable.payable_id!=='duegate-phase7-synthetic-eur-001')throw new Error('EXACT_HUMAN_APPROVAL_REQUIRED');
    const supplied = structuredClone(preview);
    if (digest(supplied.prepared) !== approvedDigest || supplied.digest !== approvedDigest) throw new Error('Approved payload mutated');
    const saved = this.ledger.readPreparation(supplied.prepared.input.payable.payable_id);
    if (saved.digest !== approvedDigest || createHash('sha256').update(saved.body).digest('hex') !== approvedDigest) throw new Error('Persisted preparation mutated');
    const p = deserialize<PreparedExecution>(saved.body);
    const current = structuredClone(p.input);
    current.now = this.clock(); current.treasury.wallet_balance = (await this.sourceBalance(current.treasury.source_currency)).available;
    if (decide(current).decision !== 'EXECUTE') throw new Error('Execution recheck blocked');
    await this.adapter.validateTransfer(p.transfer);
    current.now = this.clock();
    if (decide(current).decision !== 'EXECUTE') throw new Error('Execution expired during validation');
    this.ledger.beginSubmission(current.payable.payable_id, approvedDigest);
    const before = await this.adapter.getWalletBalances();
    const targetBefore = before.find(b => b.currency === p.input.payable.currency);
    if (!targetBefore) throw new Error('Target balance unavailable; reconcile claim');
    const sourceBefore = before.filter(b => b.currency === current.treasury.source_currency);
    if (sourceBefore.length !== 1) throw new Error('Source balance unavailable; reconcile claim');
    current.treasury.wallet_balance = sourceBefore[0].available; current.now = this.clock();
    if (decide(current).decision !== 'EXECUTE') throw new Error('Final pre-conversion gate blocked; reconcile claim');
    const conversion = await this.adapter.createConversion(p.conversion);
    this.ledger.recordConversion(current.payable.payable_id, conversion.id);
    if (conversion.status !== 'SETTLED' || conversion.quote_id !== p.quote.quote_id || conversion.request_id !== p.conversion.request_id
      || conversion.source_amount !== p.quote.source_amount || conversion.target_amount !== p.quote.target_amount) throw new Error('Conversion requires reconciliation; transfer not submitted');
    const after = await this.adapter.getWalletBalances();
    const sourceAfter = after.find(b => b.currency === current.treasury.source_currency);
    const targetAfter = after.find(b => b.currency === current.payable.currency);
    if (!sourceAfter || !targetAfter || sourceAfter.available !== current.treasury.wallet_balance - p.quote.source_amount - p.quote.source_fee_amount
      || targetAfter.available !== targetBefore.available + p.quote.target_amount
      || sourceAfter.available < current.treasury.fixed_reserve + current.treasury.committed_amount) throw new Error('Conversion balances require reconciliation; transfer not submitted');
    if (Date.parse(this.clock()) >= Date.parse(current.payable.latest_safe_execution_at)) throw new Error('Cutoff reached after conversion; reconcile');
    const transfer = await this.adapter.createTransfer(p.transfer);
    this.ledger.attachTransfer(current.payable.payable_id, transfer.id);
    this.ledger.observeTransfer(current.payable.payable_id,transfer,this.clock());
    if (transfer.request_id !== p.transfer.request_id || transfer.amount !== current.payable.amount || transfer.currency !== current.payable.currency) throw new Error('Transfer result requires reconciliation');
    return transfer;
  }
  /** Explicit Phase 8 authorization: refresh only the quote of an existing,
   * unsubmitted preparation. No claim creation or replacement exists here. */
  async continuePrepared(payableId: string, authorization?: ExactAuthorization): Promise<ContinuationResult> {
    const audit = (event: string, data: unknown) => this.ledger.audit(payableId, event, this.clock(), data);
    const state = this.ledger.continuationState(payableId);
    if (state === 'TRANSFER_ATTACHED' || state === 'EXECUTING' || state === 'REVIEW' || state === 'FAILED_REVIEW_REQUIRED') {
      audit('DUPLICATE_EXECUTION_BLOCKED', { decision: 'BLOCK_DUPLICATE', state });
      return { decision: 'BLOCK_DUPLICATE', state };
    }
    if (state !== 'PREPARED') throw new Error('No prepared claim; stopped');
    if(!authorization&&payableId!=='duegate-phase7-synthetic-eur-001')throw new Error('EXACT_HUMAN_APPROVAL_REQUIRED');
    const saved = this.ledger.readPreparation(payableId);
    if (createHash('sha256').update(saved.body).digest('hex') !== saved.digest) throw new Error('Original preview corrupted');
    const original = deserialize<PreparedExecution>(saved.body);
    if (digest(original) !== saved.digest || original.input.payable.payable_id !== payableId) throw new Error('Original payable mismatch');
    this.ledger.verifyOriginalClaim(original.input, saved.digest);
    authorization?.check(original);
    const p = structuredClone(original);
    const input = p.input;
    if (input.payable.amount !== 100n || input.payable.currency !== 'EUR' || input.treasury.source_currency !== 'USD'
      || input.execution.state !== 'no_execution' || input.execution.transfer_id !== null
      || p.transfer.beneficiary_id !== input.payable.beneficiary_id || p.transfer.transfer_amount !== '1.00'
      || p.transfer.transfer_currency !== 'EUR' || p.transfer.source_currency !== 'EUR'
      || p.transfer.request_id !== providerId(logicalExecutionKey(payableId), 'transfer')
      || p.conversion.request_id !== providerId(logicalExecutionKey(payableId), 'conversion')) throw new Error('Prepared identity mismatch');
    if (Date.parse(this.clock()) >= Date.parse(input.payable.latest_safe_execution_at)) throw new Error('Prepared cutoff passed');
    const one = (rows: WalletBalance[], currency: string): WalletBalance => {
      const found = rows.filter(b => b.currency === currency);
      if (found.length !== 1) throw new Error('Ambiguous cash balance'); return found[0];
    };
    const before = await this.adapter.getWalletBalances();
    const usd = one(before, 'USD'), eur = one(before, 'EUR');
    input.treasury.wallet_balance = usd.available; input.now = this.clock();
    input.quote = null; input.fx_policy.quote_expiry = null;
    const initial = decide(input);
    audit('PAYABLE_EVALUATED', { decision: initial, input, balances: [usd, eur], reserve: input.treasury.fixed_reserve,
      commitments: input.treasury.committed_amount, free_cash: usd.available - input.treasury.fixed_reserve - input.treasury.committed_amount });
    if (initial.reason !== 'QUOTE_MISSING') throw new Error('Cash or cutoff gate blocks continuation');
    audit('EXECUTE_PROPOSED', { condition: 'Fresh acceptable quote still required', original_digest: saved.digest });
    const quote = authorization ? structuredClone(original.quote) : await this.adapter.createFxQuote({ source_currency: 'USD', target_currency: 'EUR', target_amount: 100n });
    audit(authorization?'APPROVED_QUOTE_REUSED':'QUOTE_CREATED', quote);
    if ((!authorization && quote.quote_id === original.quote.quote_id) || !Number.isFinite(Date.parse(quote.valid_from_at)) || Date.parse(quote.valid_from_at) > Date.parse(this.clock())) throw new Error(authorization ? 'Approved quote must be valid' : 'Quote must be new and valid');
    p.quote = quote; input.quote = quote; input.fx_policy.quote_expiry = quote.expires_at;
    p.raw_balance = usd;
    p.conversion = { ...original.conversion, quote_id: quote.quote_id, conversion_date: quote.conversion_date, buy_currency: 'EUR', sell_currency: 'USD', buy_amount: '1.00' };
    const beneficiary = await this.adapter.getRelevantBeneficiary(input.payable.beneficiary_id);
    if (beneficiary.id !== input.payable.beneficiary_id || beneficiary.country !== 'DE' || beneficiary.currency !== 'EUR' || !beneficiary.transfer_methods.includes('LOCAL')) throw new Error('Existing beneficiary mismatch');
    await this.adapter.validateTransfer(structuredClone(p.transfer));
    const immediate = await this.adapter.getWalletBalances();
    if (one(immediate, 'USD').available !== usd.available || one(immediate, 'EUR').available !== eur.available) throw new Error('Balances changed during preparation');
    input.now = this.clock();
    const decision = decide(input); audit('EXECUTE_RECONFIRMED', { decision, input });
    if (decision.decision !== 'EXECUTE') throw new Error('Fresh quote gate blocked');
    const fingerprint = digest(p), body = serialize(p);
    authorization?.check(p);
    authorization?.consume(p);
    this.ledger.lockContinuation(original.input, saved.digest, fingerprint, body);
    try {
      audit('EXECUTION_LOCKED', { from: 'PREPARED', to: 'EXECUTING', original_digest: saved.digest, fingerprint, approved_execution: p });
      const checkLock = () => {
        if (digest(p) !== fingerprint || serialize(p) !== body) throw new Error('Execution fingerprint mutated');
        this.ledger.verifyLocked(payableId, fingerprint, body);
      };
      checkLock();
      authorization?.check(p,true);
      if (decide({ ...input, now: this.clock() }).decision !== 'EXECUTE') throw new Error('Gate changed before conversion');
      const created = await this.adapter.createConversion(structuredClone(p.conversion));
      this.ledger.recordConversion(payableId, created.id, created.status);
      audit('CONVERSION_CREATED', created);
      const matchesConversion = (c: ConversionResult) => c.id === created.id && c.quote_id === quote.quote_id
        && c.request_id === p.conversion.request_id && c.source_amount === quote.source_amount && c.target_amount === quote.target_amount;
      if (!matchesConversion(created)) throw new Error('Created conversion mismatch');
      let conversion = await this.adapter.getConversion(created.id);
      audit('CONVERSION_STATUS_OBSERVED', conversion);
      if (!matchesConversion(conversion) || conversion.status !== 'SETTLED') throw new Error('Conversion not confirmed settled');
      const afterConversion = await this.adapter.getWalletBalances();
      audit('CONVERSION_SETTLED', { conversion, balances: afterConversion });
      if (one(afterConversion, 'USD').available !== usd.available - quote.source_amount - quote.source_fee_amount
        || one(afterConversion, 'EUR').available !== eur.available + quote.target_amount
        || one(afterConversion, 'USD').available < input.treasury.fixed_reserve + input.treasury.committed_amount) throw new Error('Conversion balance mismatch');
      checkLock();
      await this.adapter.validateTransfer(structuredClone(p.transfer));
      checkLock();
      if (Date.parse(this.clock()) >= Date.parse(input.payable.latest_safe_execution_at)) throw new Error('Cutoff passed before transfer');
      authorization?.check(p,true);
      const transferBalances=await this.adapter.getWalletBalances();
      if(one(transferBalances,'USD').available!==one(afterConversion,'USD').available || one(transferBalances,'EUR').available!==one(afterConversion,'EUR').available)throw new Error('Cash context changed before transfer');
      authorization?.check(p,true);
      const sent = await this.adapter.createTransfer(structuredClone(p.transfer));
      this.ledger.attachTransfer(payableId, sent.id);
      audit('TRANSFER_CREATED', sent);
      this.ledger.observeTransfer(payableId,sent,this.clock());
      const matchesTransfer = (t: TransferResult) => t.id === sent.id && t.request_id === p.transfer.request_id && t.amount === 100n && t.currency === 'EUR';
      if (!matchesTransfer(sent)) throw new Error('Transfer identity mismatch');
      if (this.ledger.continuationState(payableId)==='FAILED_REVIEW_REQUIRED') throw new Error('Transfer failure requires review');
      const transfer = await this.adapter.getTransfer(sent.id);
      audit('TRANSFER_STATUS_OBSERVED', transfer);
      this.ledger.observeTransfer(payableId,transfer,this.clock());
      if (!matchesTransfer(transfer)) throw new Error('Retrieved transfer mismatch');
      if (this.ledger.continuationState(payableId)==='FAILED_REVIEW_REQUIRED') throw new Error('Transfer failure requires review');
      conversion = await this.adapter.getConversion(created.id);
      const after = await this.adapter.getWalletBalances();
      const fee = transfer.fee_amount ?? 0n;
      const feeKnown = transfer.fee_amount !== undefined && (fee === 0n || ['USD', 'EUR'].includes(transfer.fee_currency ?? ''));
      const reconciled = matchesConversion(conversion) && conversion.status === 'SETTLED' && feeKnown
        && one(after, 'USD').available === usd.available - quote.source_amount - quote.source_fee_amount - (transfer.fee_currency === 'USD' ? fee : 0n)
        && one(after, 'EUR').available === eur.available + quote.target_amount - 100n - (transfer.fee_currency === 'EUR' ? fee : 0n);
      audit('BALANCE_RECONCILED', { reconciled, before, afterConversion, after, conversion, transfer });
      if (!reconciled) throw new Error('Final economics require review');
      return { decision: 'EXECUTE', fingerprint, quote, before, afterConversion, after, conversion, transfer };
    } catch (error) {
      if(error instanceof AmbiguousTransferResponse){
        if(error.evidence.id){this.ledger.attachTransfer(payableId,error.evidence.id);this.ledger.observeTransfer(payableId,{...error.evidence,id:error.evidence.id},this.clock());}
        audit('AMBIGUOUS_TRANSFER_RESPONSE',error.evidence);
      }
      this.ledger.markReview(payableId);
      audit('EXECUTION_REVIEW_REQUIRED', { state: 'REVIEW', automatic_retry: false });
      throw new Error('Execution stopped for review; preserve all IDs and do not retry financial writes');
    }
  }
}

