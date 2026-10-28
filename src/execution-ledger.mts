import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {TransferResult} from './airwallex-adapter.mts';
import {transferFailure} from './airwallex-adapter.mts';
import { decide, logicalExecutionKey } from './decision-engine.mts';
import type { DecisionInput, DecisionResult } from './decision-engine.mts';

export type ClaimResult = { accepted: true; execution_key: string }
  | { accepted: false; reason: 'EXISTING_EXECUTION' | 'DECISION_BLOCKED'; decision?: DecisionResult };

/** Local durable gate, not a payment adapter. Never calls a provider or reads .env.
 * Retain this directory permanently for the lifetime of these payable identities.
 * Atomic exclusive creation lets only one process claim each payable on local disk.
 * No delete/reset/retry API: an ambiguous or failed claim needs reconciliation.
 */
export class ExecutionLedger {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; mkdirSync(directory, { recursive: true }); }
  private path(key: string, suffix: string): string { return join(this.directory, key + suffix); }
  private create(path: string, value: unknown): boolean {
    let fd: number;
    try { fd = openSync(path, 'wx'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    return true;
  }
  hasClaim(payableId: string): boolean {
    const key = logicalExecutionKey(payableId);
    return existsSync(this.path(key, '.claim.json')) || existsSync(this.path(key, '.transfer.json'));
  }
  claim(input: DecisionInput, binding?: string): ClaimResult {
    const decision = decide(input);
    if (decision.decision !== 'EXECUTE' || decision.execution_key === null) return { accepted: false, reason: 'DECISION_BLOCKED', decision };
    const key = decision.execution_key;
    if (existsSync(this.path(key, '.transfer.json'))) return { accepted: false, reason: 'EXISTING_EXECUTION' };
    const accepted = this.create(this.path(key, '.claim.json'), {
      execution_key: key, payable_id: input.payable.payable_id, supplier_id: input.payable.supplier_id,
      beneficiary_id: input.payable.beneficiary_id, amount: String(input.payable.amount), currency: input.payable.currency,
      quote_id: input.quote!.quote_id, required_funding: String(decision.required_funding), claimed_at: input.now, binding,
    });
    return accepted ? { accepted: true, execution_key: key } : { accepted: false, reason: 'EXISTING_EXECUTION' };
  }
  savePreparation(payableId: string, digest: string, serializedPreview: string): void {
    const key = logicalExecutionKey(payableId);
    const claim = JSON.parse(readFileSync(this.path(key, '.claim.json'), 'utf8'));
    if (claim.binding !== digest) throw new Error('Preparation does not match claim');
    if (!this.create(this.path(key, '.preview.json'), { digest, body: serializedPreview })) throw new Error('Preparation already exists');
  }
  readPreparation(payableId: string): { digest: string; body: string } {
    return JSON.parse(readFileSync(this.path(logicalExecutionKey(payableId), '.preview.json'), 'utf8'));
  }
  beginSubmission(payableId: string, digest: string): void {
    const key = logicalExecutionKey(payableId);
    const claim = JSON.parse(readFileSync(this.path(key, '.claim.json'), 'utf8'));
    if (claim.binding !== digest || existsSync(this.path(key, '.transfer.json'))) throw new Error('Claim binding or existing transfer blocks submission');
    if (!this.create(this.path(key, '.submission.json'), { digest, payable_id: payableId })) throw new Error('Submission already started; reconcile original intent');
  }
  recordConversion(payableId: string, conversionId: string, status?: string): void {
    if (!this.create(this.path(logicalExecutionKey(payableId), '.conversion.json'), { conversion_id: conversionId, status })) throw new Error('Conversion already recorded');
  }
  continuationState(payableId: string): 'PREPARED' | 'EXECUTING' | 'TRANSFER_ATTACHED' | 'REVIEW' | 'MISSING' | 'FAILED_REVIEW_REQUIRED' {
    const key = logicalExecutionKey(payableId);
    if (existsSync(this.path(key, '.failed.json'))) return 'FAILED_REVIEW_REQUIRED';
    if (existsSync(this.path(key, '.transfer.json'))) return 'TRANSFER_ATTACHED';
    if (existsSync(this.path(key, '.review.json'))) return 'REVIEW';
    if (existsSync(this.path(key, '.submission.json')) || existsSync(this.path(key, '.conversion.json'))) return 'EXECUTING';
    return existsSync(this.path(key, '.claim.json')) && existsSync(this.path(key, '.preview.json')) ? 'PREPARED' : 'MISSING';
  }
  verifyOriginalClaim(input: DecisionInput, originalDigest: string): void {
    const key = logicalExecutionKey(input.payable.payable_id);
    const c = JSON.parse(readFileSync(this.path(key, '.claim.json'), 'utf8'));
    const p = input.payable;
    if (c.binding !== originalDigest || c.execution_key !== key || c.payable_id !== p.payable_id || c.supplier_id !== p.supplier_id
      || c.beneficiary_id !== p.beneficiary_id || c.amount !== String(p.amount) || c.currency !== p.currency
      || c.quote_id !== input.quote?.quote_id || c.required_funding !== String(input.funding.required_amount)) throw new Error('Original claim mismatch');
  }
  lockContinuation(input: DecisionInput, originalDigest: string, fingerprint: string, body: string): void {
    this.verifyOriginalClaim(input, originalDigest);
    if (this.continuationState(input.payable.payable_id) !== 'PREPARED') throw new Error('Claim cannot continue');
    // Same submission marker used by every execution path. Exclusive creation is
    // the atomic PREPARED -> EXECUTING transition; original claim is never replaced.
    if (!this.create(this.path(logicalExecutionKey(input.payable.payable_id), '.submission.json'), {
      state: 'EXECUTING', original_digest: originalDigest, fingerprint, body,
    })) throw new Error('Execution already locked');
  }
  verifyLocked(payableId: string, fingerprint: string, body: string): void {
    const locked = JSON.parse(readFileSync(this.path(logicalExecutionKey(payableId), '.submission.json'), 'utf8'));
    if (locked.state !== 'EXECUTING' || locked.fingerprint !== fingerprint || locked.body !== body) throw new Error('Locked execution mutation');
  }
  audit(payableId: string, event: string, at: string, data: unknown): void {
    const fd = openSync(this.path(logicalExecutionKey(payableId), '.audit.jsonl'), 'a');
    try { writeFileSync(fd, JSON.stringify({ event, at, payable_id: payableId, data }, (_k, v) => typeof v === 'bigint' ? v.toString() : v) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
  markReview(payableId: string): void {
    this.create(this.path(logicalExecutionKey(payableId), '.review.json'), { state: 'REVIEW', reason: 'Execution interrupted; reconcile persisted evidence before any further action' });
  }
  observeTransfer(payableId:string,transfer:{id:string;status:string}&Partial<TransferResult>,at:string):void {
    const key=logicalExecutionKey(payableId);
    const saved=JSON.parse(readFileSync(this.path(key,'.transfer.json'),'utf8'));
    if(saved.transfer_id!==transfer.id)throw new Error('Observed transfer identity mismatch');
    const evidence={transfer_id:transfer.id,status:transfer.status,...(transfer.request_id?{request_id:transfer.request_id}:{}),...transferFailure(transfer)};
    this.audit(payableId,'TRANSFER_OBSERVED',at,evidence);
    // Unknown statuses also fail closed; RETURNED is a defensive application input,
    // not an assertion that this API version emits that status.
    const knownNonFailure=['CREATED','IN_APPROVAL','OVERDUE','SCHEDULED','PROCESSING','SENT','PAID'];
    if(!knownNonFailure.includes(transfer.status)||transfer.failure_type||transfer.failure_reason||transfer.failure){
      if(this.create(this.path(key,'.failed.json'),{state:'FAILED_REVIEW_REQUIRED',...evidence,at}))
        this.audit(payableId,'FAILED_REVIEW_REQUIRED',at,{from:'TRANSFER_ATTACHED',to:'FAILED_REVIEW_REQUIRED',...evidence,automatic_retry:false});
    }
  }
  observedTransferStatus(payableId:string):string|null {
    const key=logicalExecutionKey(payableId),path=this.path(key,'.audit.jsonl');
    if(!existsSync(path))return null;
    const rows=readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
    return rows.filter(r=>['TRANSFER_OBSERVED','TRANSFER_STATUS_OBSERVED','TRANSFER_CREATED'].includes(r.event)).at(-1)?.data?.status??null;
  }
  attachTransfer(payableId: string, transferId: string): void {
    if (!transferId || transferId.trim() !== transferId || transferId.length > 200) throw new Error('Invalid transfer identity');
    const key = logicalExecutionKey(payableId);
    const claim = JSON.parse(readFileSync(this.path(key, '.claim.json'), 'utf8'));
    if (claim.payable_id !== payableId || claim.execution_key !== key) throw new Error('Corrupt claim; reconcile manually');
    const target = this.path(key, '.transfer.json');
    if (!this.create(target, { payable_id: payableId, execution_key: key, transfer_id: transferId })) {
      const existing = JSON.parse(readFileSync(target, 'utf8'));
      if (existing.transfer_id !== transferId || existing.payable_id !== payableId) throw new Error('Refusing replacement transfer');
    }
  }
}
