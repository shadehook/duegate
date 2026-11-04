import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MockAdapter} from '../fixtures/mock-adapter.mts';
import {DemoService,SANDBOX_PAYABLE,FINAL_PAYABLE} from '../server/demo-service.mts';
import {ApprovalStore} from '../src/approval-store.mts';
import {ExecutionController} from '../src/execution-controller.mts';
import type {Evaluation} from '../src/execution-controller.mts';
import {ExecutionLedger} from '../src/execution-ledger.mts';
import {renderCase} from '../web/view.mts';
import {safeAuditExport} from '../src/audit-export.mts';
async function setup(fn:(c:{s:DemoService;a:MockAdapter;store:ApprovalStore;controller:ExecutionController;dir:string;time:(x:string)=>void;clock:()=>string})=>Promise<void>){
  const dir=mkdtempSync(join(tmpdir(),'duegate-controls-'));let now='2026-10-04T15:00:00.000Z';const clock=()=>now,a=new MockAdapter();
  try{await fn({s:new DemoService(a,dir,clock),a,store:new ApprovalStore(join(dir,'approvals'),clock),controller:new ExecutionController(a,new ExecutionLedger(join(dir,'ledger')),clock),dir,time:x=>{now=x;},clock});}
  finally{const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep+'duegate-controls-'));rmSync(target,{recursive:true});}
}
const zero=(a:MockAdapter)=>{assert.equal(a.conversions,0);assert.equal(a.transfers,0);};
async function approve(s:DemoService){const p=await s.action('funded');const v=await s.action('approve',{fingerprint:p.approval?.execution_fingerprint});assert.equal(v.approval?.status,'APPROVED');return v;}
test('13 quote 1 and approval 10: exact fresh approval executes unchanged quote',()=>setup(async({s,a})=>{const p=await approve(s);const v=await s.action('execute',{confirm:p.preview!.digest});assert.equal(v.error,null);assert.equal(a.quotes,1);assert.equal(a.lastConversion?.quote_id,p.quote!.id);assert.equal(a.conversions,1);assert.equal(a.transfers,1);assert.equal(v.approval?.status,'USED');}));
for(const [name,at] of [['expired','2026-10-04T15:16:00.000Z'],['expiry boundary','2026-10-04T15:15:00.000Z'],['cutoff after approval','2026-10-04T16:00:00.000Z']]){
  test('13 quote/approval: '+name+' invalidates and writes zero',()=>setup(async({s,a,time})=>{const p=await approve(s);time(at);const v=s.view();assert.equal(v.canExecute,false);assert.equal(v.approval?.status,'INVALIDATED');await s.action('execute',{confirm:p.preview!.digest});zero(a);}));
}
for(const name of ['malformed expiry','outside limit','wrong currency','wrong target amount']){
  test('13 quote: '+name+' refuses approval and execution',()=>setup(async({s,a})=>{if(name==='malformed expiry')a.quote.expires_at='not-a-time';if(name==='outside limit')a.quote.source_amount=151n;if(name==='wrong currency')a.quote.target_currency='GBP';if(name==='wrong target amount')a.quote.target_amount=200n;const p=await s.action('funded');assert.equal(p.canApprove,false);assert.equal(p.canExecute,false);await s.action('execute');zero(a);}));
}
const mutations:Record<string,(e:Evaluation)=>void>={
  'quote ID':e=>{e.quote!.quote_id='changed';e.input.quote=e.quote;},
  'payable amount':e=>{e.input.payable.amount=200n;},
  'beneficiary':e=>{e.input.payable.beneficiary_id='different';},
  'reserve':e=>{e.input.treasury.fixed_reserve+=1n;},
  'quote source amount':e=>{e.quote!.source_amount+=1n;e.input.quote=e.quote;},
  'quote expiry':e=>{e.quote!.expires_at='2026-10-04T15:20:00.000Z';e.input.quote=e.quote;e.input.fx_policy.quote_expiry=e.quote!.expires_at;},
  'source currency':e=>{e.input.treasury.source_currency='GBP';},
};
for(const [name,mutate] of Object.entries(mutations))test('13 protected mutation: '+name,()=>setup(async({s,a,store})=>{await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation;mutate(e);assert.throws(()=>store.authorization(e));assert.equal(store.current(SANDBOX_PAYABLE)?.approval.status,'INVALIDATED');zero(a);}));
test('13 approval 9: no approval blocks direct execution request',()=>setup(async({s,a})=>{const p=await s.action('funded');assert.match(renderCase(p),/APPROVAL REQUIRED/);await s.action('execute',{confirm:p.preview!.digest});zero(a);}));
test('13 approval 11: approval USED cannot be replayed',()=>setup(async({s,a,store})=>{const p=await approve(s);await s.action('execute',{confirm:p.preview!.digest});assert.throws(()=>store.authorization(store.current(SANDBOX_PAYABLE)!.evaluation));await s.action('execute',{confirm:p.preview!.digest});assert.equal(a.transfers,1);assert.equal(a.conversions,1);}));
test('13 approval 12: approved intent survives restart and exact execution succeeds',()=>setup(async({s,a,dir,clock})=>{const p=await approve(s),next=new DemoService(a,dir,clock);assert.equal(next.view().approval?.approval_id,p.approval!.approval_id);assert.equal(next.view().approval?.status,'APPROVED');const v=await next.action('execute',{confirm:p.preview!.digest});assert.equal(v.error,null);assert.equal(v.approval?.status,'USED');assert.equal(a.quotes,1);}));
test('13 requote invalidates prior approval and needs another approval',()=>setup(async({s,a,store})=>{const p=await approve(s);const next=await s.action('funded');assert.notEqual(next.approval?.approval_id,p.approval!.approval_id);assert.equal(next.approval?.status,'PENDING');assert.equal(next.canExecute,false);assert.ok(store.history(SANDBOX_PAYABLE).some(x=>x.to==='INVALIDATED'));await s.action('execute',{confirm:p.preview!.digest});zero(a);}));
test('13 controller: expiry during prepare validation causes zero writes',()=>setup(async({s,a,time})=>{const p=await approve(s);a.validateTransfer=async()=>{time(a.quote.expires_at);};await s.action('execute',{confirm:p.preview!.digest});zero(a);}));
test('13 failed requote invalidates old approval before network access',()=>setup(async({s,a,store})=>{await approve(s);a.createFxQuote=async()=>{assert.equal(store.current(SANDBOX_PAYABLE)?.approval.status,'INVALIDATED');throw new Error('Synthetic provider failure');};const v=await s.action('funded');assert.equal(v.approval?.status,'INVALIDATED');assert.equal(v.canExecute,false);zero(a);}));
test('13 controller: protected mutation after approval rejected before conversion',()=>setup(async({s,a,store,controller})=>{await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation;const auth=store.authorization(e);const p=await controller.prepare(e);p.prepared.input.payable.beneficiary_id='changed';assert.throws(()=>auth.check(p.prepared));zero(a);}));
test('13 legacy entry points cannot bypass approval for current payable',()=>setup(async({s,a,store,controller})=>{await s.action('funded');const p=await controller.prepare(store.current(SANDBOX_PAYABLE)!.evaluation);await assert.rejects(controller.continuePrepared(SANDBOX_PAYABLE),/EXACT_HUMAN_APPROVAL_REQUIRED/);await assert.rejects(controller.executeApproved(p,p.digest),/EXACT_HUMAN_APPROVAL_REQUIRED/);zero(a);}));
for(const status of ['FAILED','CANCELLED','RETURNED','UNRECOGNIZED'])test('13 failure 14-17: '+status+' persists and never retries',()=>setup(async({s,a,dir,clock})=>{
  const p=await approve(s);await s.action('execute',{confirm:p.preview!.digest});const ids={c:a.lastConversion!.id,t:a.lastTransfer!.id};a.lastTransfer!.status=status;
  const v=await s.action('refresh-status');assert.equal(v.decision,'ESCALATE');assert.equal(v.reason,'TRANSFER_REVIEW_REQUIRED');assert.equal(v.executionState,'FAILED_REVIEW_REQUIRED');assert.equal(v.result!.transferStatus,status);assert.equal(v.result!.conversionId,ids.c);assert.equal(v.result!.transferId,ids.t);
  const next=new DemoService(a,dir,clock);await next.action('funded');assert.equal(next.view().decision,'ESCALATE');assert.equal(next.view().executionState,'FAILED_REVIEW_REQUIRED');assert.equal(next.view().result!.transferStatus,status);await next.action('execute');assert.equal(a.transfers,1);assert.equal(a.conversions,1);assert.equal(a.quotes,1);
}));
test('13 failure: later PAID observation cannot clear sticky review',()=>setup(async({s,a})=>{const p=await approve(s);await s.action('execute',{confirm:p.preview!.digest});a.lastTransfer!.status='FAILED';await s.action('refresh-status');a.lastTransfer!.status='PAID';const v=await s.action('refresh-status');assert.equal(v.decision,'ESCALATE');assert.equal(v.reason,'TRANSFER_REVIEW_REQUIRED');assert.equal(v.executionState,'FAILED_REVIEW_REQUIRED');assert.equal(v.canExecute,false);assert.equal(a.transfers,1);}));
test('13 failure: immediate failed creation retains IDs even with balance mismatch',()=>setup(async({s,a})=>{const create=a.createTransfer.bind(a);a.createTransfer=async payload=>{const t=await create(payload);a.lastTransfer!.status='FAILED';return {...t,status:'FAILED'};};const p=await approve(s),v=await s.action('execute',{confirm:p.preview!.digest});assert.equal(v.decision,'ESCALATE');assert.equal(v.reason,'TRANSFER_REVIEW_REQUIRED');assert.equal(v.executionState,'FAILED_REVIEW_REQUIRED');assert.ok(v.result!.transferId);assert.ok(v.result!.conversionId);assert.equal(a.transfers,1);}));
test('13 audit 18: export includes exact intent, approval, decisions and IDs',()=>setup(async({s})=>{await s.action('open');await s.action('interpret',{text:'The $4,000 customer payment expected Thursday has been delayed until Monday.'});await s.action('apply');const p=await approve(s);await s.action('execute',{confirm:p.preview!.digest});const exported=JSON.stringify(s.exportAudit());for(const value of ['payable_id','amount','source_currency','beneficiary_reference','wallet_balance','fixed_reserve','committed_amount','expected_inflow','source_text_hash','decision','reason','quote_id','approval_id','USED','synthetic-conversion','synthetic-transfer','BLOCK_DUPLICATE','from','to','parser_version','execution_fingerprint'])assert.ok(exported.includes(value),value);}));
test('13 audit 19: unknown credential/bank/raw fields cannot enter export',()=>{const exported=JSON.stringify(safeAuditExport({history:[{event:'SAFE',data:{api_key:'secret-key',access_token:'secret-token',bank_details:{iban:'secret-bank'},raw_text:'private message',beneficiary_id:'synthetic-beneficiary-12345678'}}]}));assert.doesNotMatch(exported,/secret-|private message|synthetic-beneficiary/);assert.match(exported,/12345678/);});
test('13 audit 20: same stored history yields identical export after restart',()=>setup(async({s,a,dir,clock})=>{await approve(s);const before=JSON.stringify(s.exportAudit());assert.equal(JSON.stringify(s.exportAudit()),before);assert.equal(JSON.stringify(new DemoService(a,dir,clock).exportAudit()),before);}));
test('13 audit: export does not mutate append-only logs',()=>setup(async({s,dir})=>{await approve(s);const path=join(dir,'audit.jsonl'),before=readFileSync(path,'utf8');s.exportAudit();assert.equal(readFileSync(path,'utf8'),before);}));

for(const [name,mutate] of Object.entries({
 'wallet':(e:Evaluation)=>{e.input.treasury.wallet_balance+=1n;},
 'commitment':(e:Evaluation)=>{e.input.treasury.committed_amount-=1n;},
 'inflow ETA':(e:Evaluation)=>{e.input.treasury.expected_inflow_eta='2026-10-04T15:31:00.000Z';},
 'inflow amount':(e:Evaluation)=>{e.input.treasury.expected_inflow_amount+=1n;},
 'inflow status':(e:Evaluation)=>{e.input.treasury.expected_inflow_status='pending';},
 'target currency':(e:Evaluation)=>{e.input.payable.currency='GBP';},
 'due date':(e:Evaluation)=>{e.input.payable.due_at='2026-10-04T18:00:00.000Z';},
 'cutoff':(e:Evaluation)=>{e.input.payable.latest_safe_execution_at='2026-10-04T16:01:00.000Z';}
}))test('shortlist approval binds '+name,()=>setup(async({s,a,store})=>{await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation;mutate(e);assert.throws(()=>store.authorization(e));zero(a);}));
test('shortlist changed current cash invalidates before a claim even if still sufficient',()=>setup(async({s,a,dir})=>{const p=await approve(s);a.usd+=1n;const v=await s.action('execute',{confirm:p.preview!.digest});zero(a);assert.equal(v.approval?.status,'INVALIDATED');assert.equal(new ExecutionLedger(join(dir,'ledger')).continuationState(SANDBOX_PAYABLE),'MISSING');}));
test('shortlist context refresh visibly invalidates changed cash',()=>setup(async({s,a})=>{await approve(s);a.usd+=1n;const v=await s.action('refresh-context');assert.equal(v.approval?.status,'INVALIDATED');assert.match(renderCase(v),/APPROVAL INVALIDATED/);zero(a);}));
test('shortlist full single EUR1 sequence, invalidation, duplicate, restart and audit',()=>setup(async({a,dir,clock})=>{
 const options={finalProof:true,financialWritesEnabled:true};let s=new DemoService(a,dir,clock,options);
 let v=await s.action('open');assert.equal(v.decision,'WAIT');assert.equal(v.payableId,FINAL_PAYABLE);assert.equal(v.amount,'1.00');assert.equal(a.quotes,0);
 await s.action('interpret',{text:v.fundingExample});v=await s.action('apply');assert.equal(v.decision,'ESCALATE');zero(a);assert.equal(a.quotes,0);
 s=new DemoService(a,dir,clock,options);v=await s.action('open');assert.equal(v.decision,'ESCALATE');
 v=await approve(s);assert.equal(v.payableId,FINAL_PAYABLE);const old=v.preview!.digest;
 v=await s.action('invalidate');assert.equal(v.approval?.status,'INVALIDATED');assert.equal(v.canExecute,false);zero(a);
 s=new DemoService(a,dir,clock,options);assert.equal(s.view().approval?.status,'INVALIDATED');await s.action('execute',{confirm:old});zero(a);
 v=await approve(s);assert.notEqual(v.preview!.digest,old);v=await s.action('execute',{confirm:v.preview!.digest});assert.equal(v.error,null);assert.equal(a.conversions,1);assert.equal(a.transfers,1);assert.equal(v.result?.conversionStatus,'SETTLED');assert.equal(v.result?.transferStatus,'PROCESSING');
 const quotes=a.quotes,usd=a.usd,eur=a.eur;v=await s.action('execute');assert.equal(v.decision,'BLOCK_DUPLICATE');
 s=new DemoService(a,dir,clock,options);v=await s.action('open');assert.equal(v.decision,'BLOCK_DUPLICATE');assert.equal(v.result?.transferId,'synthetic-transfer');await s.action('execute');assert.equal(a.quotes,quotes);assert.equal(a.usd,usd);assert.equal(a.eur,eur);assert.equal(a.transfers,1);assert.equal(a.conversions,1);
 const log=JSON.stringify(s.exportAudit());for(const event of ['DECISION_WAIT','EXPECTED_INFLOW_UPDATED','DECISION_ESCALATE','APPROVAL_APPROVED','APPROVAL_INVALIDATED','CONVERSION_CREATED','TRANSFER_CREATED','BLOCK_DUPLICATE','STATE_RESTORED'])assert.ok(log.includes(event),event);
}));
test('shortlist final demo defaults to financial writes disabled',()=>setup(async({a,dir,clock})=>{const s=new DemoService(a,dir,clock,{finalProof:true});const v=await approve(s);assert.equal(v.canExecute,false);await s.action('execute',{confirm:v.preview!.digest});zero(a);}));
test('shortlist fixed final schedule does not slide on restart',()=>setup(async({a,dir,clock,time})=>{const s=new DemoService(a,dir,clock,{finalProof:true});const v=await s.action('open');time('2026-10-04T16:01:00.000Z');const r=await new DemoService(a,dir,clock,{finalProof:true}).action('open');assert.equal(r.cutoff,v.cutoff);assert.equal(r.decision,'ESCALATE');zero(a);}));

import {transferFailure,AmbiguousTransferResponse} from '../src/airwallex-adapter.mts';
test('shortlist projects legacy and current failure metadata only',()=>{assert.deepEqual(transferFailure({failure_type:'BANK',failure_reason:'Synthetic reason',failure:{code:'BANK_REJECTED',message:'Synthetic message',details:{type:'BANK',reason_codes:['TEST'],bank_account:'never-copy'}},email:'never-copy'}),{failure_type:'BANK',failure_reason:'Synthetic reason',failure:{code:'BANK_REJECTED',message:'Synthetic message',details:{type:'BANK',reason_codes:['TEST']}}});});
for(const metadata of [true,false])test('shortlist CANCELLED preserves request and failure evidence '+metadata,()=>setup(async({s,a,dir,clock})=>{const p=await approve(s);await s.action('execute',{confirm:p.preview!.digest});a.lastTransfer!.status='CANCELLED';if(metadata){a.lastTransfer!.failure_type='BANK';a.lastTransfer!.failure_reason='Synthetic rejection';a.lastTransfer!.failure={code:'BANK_REJECTED',message:'Synthetic bank message'};}const v=await s.action('refresh-status');assert.equal(v.decision,'ESCALATE');assert.equal(v.reason,'TRANSFER_REVIEW_REQUIRED');assert.equal(v.executionState,'FAILED_REVIEW_REQUIRED');const evidence=readFileSync(join(dir,'ledger',v.preview?.key??(await import('../src/decision-engine.mts')).logicalExecutionKey(SANDBOX_PAYABLE))+'.failed.json','utf8');assert.ok(evidence.includes(a.lastTransfer!.request_id));if(metadata){assert.match(evidence,/Synthetic rejection/);assert.match(JSON.stringify(s.exportAudit()),/provider text retained locally/);}const next=new DemoService(a,dir,clock);await next.action('funded');await next.action('execute');assert.equal(a.transfers,1);assert.equal(a.conversions,1);}));
for(const knownId of [true,false])test('shortlist ambiguous transfer persists and blocks across restart '+knownId,()=>setup(async({s,a,dir,clock})=>{a.createTransfer=async payload=>{a.transfers++;throw new AmbiguousTransferResponse({...(knownId?{id:'ambiguous-known-id'}:{}),request_id:payload.request_id,status:'UNKNOWN_RESPONSE'});};const p=await approve(s);const v=await s.action('execute',{confirm:p.preview!.digest});assert.equal(v.canExecute,false);if(knownId)assert.equal(v.result?.transferId,'ambiguous-known-id');const next=new DemoService(a,dir,clock);await next.action('funded');await next.action('execute');assert.equal(a.transfers,1);assert.equal(a.conversions,1);assert.ok(JSON.stringify(next.exportAudit()).includes('AMBIGUOUS_TRANSFER_RESPONSE'));}));

test('shortlist cash movement during post-conversion validation blocks supplier transfer',()=>setup(async({s,a})=>{const validate=a.validateTransfer.bind(a);a.validateTransfer=async()=>{await validate();if(a.conversions)a.usd+=1n;};const p=await approve(s),v=await s.action('execute',{confirm:p.preview!.digest});assert.equal(a.conversions,1);assert.equal(a.transfers,0);assert.equal(v.canExecute,false);await s.action('execute');assert.equal(a.conversions,1);}));
import {AirwallexSandbox} from '../src/airwallex-sandbox.mts';
import type {TransferPayload} from '../src/airwallex-adapter.mts';
test('shortlist actual HTTP mapper retains partial transfer ID without retaining raw body',()=>setup(async({dir})=>{
 const env=join(dir,'.env');writeFileSync(env,'AIRWALLEX_CLIENT_ID=synthetic\nAIRWALLEX_API_KEY=synthetic\n');const original=globalThis.fetch;
 try{globalThis.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/authentication/login')?{token:'synthetic-token'}:{id:'known-provider-id',request_id:'known-request',status:'CANCELLED',failure_reason:'Synthetic reason',bank_details:'never-retain'}),{status:200});
 const a=new AirwallexSandbox(env,{financialWritesEnabled:true});await assert.rejects(a.createTransfer({request_id:'known-request'} as TransferPayload),(error:unknown)=>{assert.ok(error instanceof AmbiguousTransferResponse);assert.equal(error.evidence.id,'known-provider-id');assert.equal(error.evidence.request_id,'known-request');assert.equal(error.evidence.failure_reason,'Synthetic reason');assert.doesNotMatch(JSON.stringify(error),/never-retain|synthetic-token/);return true;});
 }finally{globalThis.fetch=original;}
}));

test('audit snapshots remain immutable after clock/context refresh and restart',()=>setup(async({s,a,dir,clock,time})=>{await approve(s);const original=s.exportAudit() as {history:Array<{stream:string;sequence:number}>};const preview=original.history.find(x=>x.stream==='case'&&JSON.stringify(x).includes('EXECUTION_PREVIEW'));assert.ok(preview);time('2026-10-04T15:01:00.000Z');await s.action('refresh-context');const current=s.exportAudit() as typeof original;assert.deepEqual(current.history.find(x=>x.stream===preview.stream&&x.sequence===preview.sequence),preview);assert.deepEqual(new DemoService(a,dir,clock).exportAudit(),s.exportAudit());}));
