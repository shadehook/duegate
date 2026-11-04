import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {DemoService,SANDBOX_PAYABLE} from '../server/demo-service.mts';
import {ApprovalStore,intentFingerprint} from '../src/approval-store.mts';
import {approvalManifest,changedManifest,manifestFingerprint} from '../src/approval-context.mts';
import {parseStatements,statementSnapshot,checkStatements,requireStatements,statementFingerprint} from '../src/financial-statement-context.mts';
import type {StatementPolicy,FinancialStatementContext} from '../src/financial-statement-context.mts';
import {MockAdapter} from '../fixtures/mock-adapter.mts';
import {logicalExecutionKey} from '../src/decision-engine.mts';
import {recordedStatementScene} from '../server/statement-scene.mts';
import {PresentationService} from '../server/presentation-service.mts';
import {renderCase} from '../web/view.mts';

const policy:StatementPolicy={accountingCash:{policy:'MINIMUM',threshold:'25000000'},netCashChange:{policy:'MUST_EQUAL'}};
const load=()=>{const f=JSON.parse(readFileSync('fixtures/t0-statement-october.json','utf8'));return parseStatements(f.balanceSheet,f.cashFlow,f,f.entityRef,f.capturedAt);};
async function setup(fn:(x:{s:DemoService;a:MockAdapter;store:ApprovalStore;context:FinancialStatementContext;dir:string;restart:()=>DemoService;time:(s:string)=>void;unavailable:()=>void})=>Promise<void>,p=policy){
 const dir=mkdtempSync(join(tmpdir(),'duegate-selected-claims-'));
 let now='2026-10-30T12:00:00.000Z',missing=false;
 const context=load();context.balanceSheet.accountingCashMinor=31000000n;context.capturedAt=now;
 const a=new MockAdapter();a.quote.valid_from_at=now;a.quote.expires_at='2026-10-30T12:15:00.000Z';a.quote.conversion_date='2026-10-30';
 const restart=()=>new DemoService(a,dir,()=>now,{statements:async()=>{if(missing)throw Error('synthetic-unavailable');return structuredClone(context);},statementPolicy:p});
 try{await fn({s:restart(),a,store:new ApprovalStore(join(dir,'approvals'),()=>now),context,dir,restart,time:x=>{now=x;},unavailable:()=>{missing=true;}});}
 finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'duegate-selected-claims-'));rmSync(dir,{recursive:true});}
}
async function approve(s:DemoService){let v=await s.action('funded');assert.equal(v.decision,'EXECUTE');v=await s.action('approve',{fingerprint:v.approval!.execution_fingerprint});assert.equal(v.approval?.status,'APPROVED');return v;}
const zero=(a:MockAdapter)=>assert.deepEqual([a.conversions,a.transfers],[0,0]);

test('selected claim remains within MINIMUM policy: approval and original fingerprint remain valid',()=>setup(async({s,store,context})=>{
 await approve(s);const old=store.current(SANDBOX_PAYABLE)!,fp=old.approval.execution_fingerprint;
 context.balanceSheet.accountingCashMinor=28000000n;
 const current=structuredClone(old.evaluation);current.statement=statementSnapshot(context,policy);
 assert.equal(store.inspect(current)?.status,'APPROVED');assert.equal(store.inspect(current)?.execution_fingerprint,fp);
 assert.deepEqual(changedManifest(old.approval.manifest!,approvalManifest(current)),[]);
 context.balanceSheet.accountingCashMinor=25000000n;current.statement=statementSnapshot(context,policy);
 assert.equal(store.inspect(current)?.status,'APPROVED','MINIMUM includes the exact threshold');
}));
test('protected financial claim crosses MINIMUM: exact changed field, REAPPROVAL_REQUIRED, zero writes and restart evidence',()=>setup(async({s,a,store,context,restart})=>{
 const v=await approve(s);context.balanceSheet.accountingCashMinor=21800000n;context.balanceSheet.totalAssetsMinor=1n;
 const result=await s.action('execute',{confirm:v.preview!.digest});
 assert.equal(result.decision,'REAPPROVAL_REQUIRED');assert.equal(result.reason,'FINANCIAL_CONTEXT_CHANGED');assert.equal(result.approval?.status,'INVALIDATED');zero(a);
 assert.deepEqual(result.contextRevalidation,{decision:'REAPPROVAL_REQUIRED',reasonCode:'FINANCIAL_CONTEXT_CHANGED',approvalVersion:2,changedFields:[{claim:'accounting_cash',source:'t0',approvedValue:'31000000',currentValue:'21800000',policy:'MINIMUM',threshold:'25000000',units:'minor_units',currency:'USD',entityRef:context.entityRef,periodStart:context.periodStart,periodEnd:context.periodEnd}],airwallexWritesAttempted:0});
 assert.equal(a.quotes,1);const next=restart();assert.equal(next.view().decision,'REAPPROVAL_REQUIRED');assert.deepEqual(next.view().contextRevalidation,result.contextRevalidation);
 assert.match(JSON.stringify(next.exportAudit()),/changedFields/);assert.match(JSON.stringify(next.exportAudit()),/21800000/);
 const bound=store.current(SANDBOX_PAYABLE)!.approval.manifest!;assert.equal(manifestFingerprint(bound),v.approval!.execution_fingerprint);
}));
test('protected MUST_EQUAL claim changes: only net cash change requires reapproval',()=>setup(async({s,a,context})=>{
 const v=await approve(s);context.cashFlow.netCashChangeMinor!-=1n;
 const result=await s.action('execute',{confirm:v.preview!.digest});assert.equal(result.decision,'REAPPROVAL_REQUIRED');
 assert.deepEqual(result.contextRevalidation?.changedFields.map(c=>[c.claim,c.policy]),[['net_cash_change','MUST_EQUAL']]);zero(a);
}));
test('UNRELATED ACCOUNTING CHANGE DOES NOT INVALIDATE APPROVAL OR CHANGE ITS FINGERPRINT',()=>setup(async({s,store,context})=>{
 await approve(s);const before=store.current(SANDBOX_PAYABLE)!.evaluation,fp=intentFingerprint(before);
 const f=JSON.parse(readFileSync('fixtures/t0-statement-october.json','utf8'));f.balanceSheet.sections[0].children.push({account_id:'unrelated-depreciation',balances:{'2026-10':8123}});
 f.balanceSheet.sections[0].children[0].balances['2026-10']=31000000;f.balanceSheet.sections[0].balances['2026-10']=999;
 f.balanceSheet.metadata={unrelatedSupplier:'synthetic-other',journal:'synthetic-unrelated'};f.cashFlow.sections.push({key:'unbound-row',balances:{'2026-10':123}});
 const current=parseStatements(f.balanceSheet,f.cashFlow,f,f.entityRef,'2026-10-30T12:00:30.000Z');
 const next={...structuredClone(before),statement:statementSnapshot(current,policy)};
 assert.equal(intentFingerprint(next),fp);assert.equal(store.inspect(next)?.status,'APPROVED');assert.equal(checkStatements(before.statement!,current,'2026-10-30').result,'FINANCIAL_CONTEXT_OK');
 context.balanceSheet.totalAssetsMinor=999n;context.capturedAt=current.capturedAt;
}));
test('unknown provider metadata and local capture time never enter the multi-source manifest',()=>setup(async({s,store})=>{
 await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation,fp=intentFingerprint(e);
 Object.assign(e.raw_balance,{metadata:'unrelated'});Object.assign(e.input.treasury,{unbound:'ignore'});Object.assign(e.quote!,{metadata:'ignore'});e.input.quote=e.quote;
 if(e.statementEvidence)e.statementEvidence.capturedAt='2026-10-30T12:01:00.000Z';
 assert.equal(intentFingerprint(e),fp);assert.equal(store.inspect(e)?.status,'APPROVED');
 const m=approvalManifest(e);assert.deepEqual([...new Set(m.protectedClaims.map(c=>c.source))].sort(),['airwallex','duegate','payment','t0']);assert.doesNotMatch(JSON.stringify(m),/capturedAt|metadata|unbound/);
}));
for(const kind of ['missing','malformed','wrong-entity','out-of-period','stale'] as const)test('unusable '+kind+' context escalates, never reapproval or financial writes',()=>setup(async({s,a,context,unavailable,time})=>{
 const v=await approve(s);
 if(kind==='missing')unavailable();if(kind==='malformed')context.balanceSheet.accountingCashMinor=undefined;
 if(kind==='wrong-entity')context.entityRef='sha256:'+'0'.repeat(64);
 if(kind==='out-of-period')context.periodEnd='2026-10-29';if(kind==='stale')time('2026-10-30T12:02:00.000Z');
 const r=await s.action('execute',{confirm:v.preview!.digest});assert.equal(r.decision,'ESCALATE');assert.equal(r.contextRevalidation?.changedFields.length,0);zero(a);
 assert.equal(r.reason,kind==='stale'?'FINANCIAL_CONTEXT_STALE':'FINANCIAL_CONTEXT_INCOMPLETE');
}, {...policy,maxCaptureAgeMs:60000}));
test('elapsed report period remains ESCALATE / FINANCIAL_CONTEXT_OUT_OF_PERIOD',()=>setup(async({s,a,time})=>{
 const v=await approve(s);time('2026-10-31T00:01:00.000Z');const r=await s.action('approve',{fingerprint:v.approval!.execution_fingerprint});
 assert.equal(r.decision,'ESCALATE');assert.equal(r.reason,'FINANCIAL_CONTEXT_OUT_OF_PERIOD');zero(a);
}));
test('policy tampering cannot relax an approved threshold',()=>setup(async({s,store,a})=>{
 await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation;e.statement!.policy!.accountingCash={policy:'MINIMUM',threshold:'1'};
 assert.throws(()=>store.authorization(e));assert.equal(store.current(SANDBOX_PAYABLE)!.approval.status,'INVALIDATED');zero(a);
}));
test('valid protected claims preserve EXECUTE and duplicate protection after restart (mock adapter only)',()=>setup(async({s,a,context,restart})=>{
 const v=await approve(s);context.balanceSheet.accountingCashMinor=28000000n;
 const r=await s.action('execute',{confirm:v.preview!.digest});assert.equal(r.error,null);assert.equal(r.decision,'BLOCK_DUPLICATE');assert.deepEqual([a.quotes,a.conversions,a.transfers],[1,1,1]);
 const next=restart();assert.equal((await next.action('funded')).decision,'BLOCK_DUPLICATE');assert.equal((await next.action('execute')).decision,'BLOCK_DUPLICATE');assert.deepEqual([a.quotes,a.conversions,a.transfers],[1,1,1]);
}));
test('change after conversion preserves review and truthfully reports one attempted write, no supplier transfer',()=>setup(async({s,a,context,restart})=>{
 const v=await approve(s),convert=a.createConversion.bind(a);a.createConversion=async p=>{const r=await convert(p);context.balanceSheet.accountingCashMinor=21800000n;return r;};
 const r=await s.action('execute',{confirm:v.preview!.digest});assert.equal(r.decision,'ESCALATE');assert.equal(r.executionState,'REVIEW');assert.equal(r.reason,'TRANSFER_REVIEW_REQUIRED');assert.equal(r.contextRevalidation?.airwallexWritesAttempted,1);assert.equal(r.contextRevalidation?.decision,'ESCALATE');assert.deepEqual([a.conversions,a.transfers],[1,0]);
 const next=restart();assert.equal(next.view().contextRevalidation?.airwallexWritesAttempted,1);await next.action('execute');assert.deepEqual([a.conversions,a.transfers],[1,0]);
}));
test('pre-manifest pending/approved records fail closed without rewriting historical records',()=>setup(async({s,store,dir,restart,a})=>{
 await approve(s);const path=join(dir,'approvals',logicalExecutionKey(SANDBOX_PAYABLE));const last=readdirSync(path).sort().at(-1)!;const file=join(path,last);const text=readFileSync(file,'utf8');const record=JSON.parse(text);delete record.approval.manifest;writeFileSync(file,JSON.stringify(record));
 const before=readFileSync(file,'utf8');const v=restart().view();assert.equal(v.decision,'ESCALATE');assert.equal(v.canExecute,false);assert.equal(readFileSync(file,'utf8'),before);assert.equal(store.current(SANDBOX_PAYABLE)?.approval.status,'INVALIDATED');zero(a);
}));
test('presentation hero shows synthetic threshold evidence, multi-source manifest and zero writes; paid bill stays separate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'duegate-selected-scene-'));
 try{
  const s=new PresentationService(dir,undefined,undefined,{accountingEvidencePath:'fixtures/t0-paid-bill.json',statementEvidencePath:'fixtures/t0-statement-october.json'});
  const v=await s.action('open'),html=renderCase(v);assert.equal(v.decision,'WAIT');assert.equal(v.accountingCheck?.decision,'BLOCK_DUPLICATE');
  for(const text of ['REAPPROVAL_REQUIRED','FINANCIAL_CONTEXT_CHANGED','USD 310,000.00','USD 218,000.00','USD 250,000.00','MINIMUM','T:0 · Airwallex · DueGate policy','Values are synthetic','Airwallex writes attempted'])assert.ok(html.includes(text),text);
  const intro=html.indexOf('data-testid="product-introduction"'),story=html.indexOf('id="t0-financial-context"'),payment=html.indexOf('class="payable-sheet"');
  assert.ok(intro>0&&story>intro&&payment>story,'Selected-claim story follows introduction and precedes WAIT payable');
  assert.equal(html.split(' id="t0-financial-context"').length-1,1,'Story appears once');
  assert.match(html,/Values are synthetic; T:0 retrieval and period-validation evidence is recorded separately below/);
  assert.match(html,/Approval is bound to selected claims across payment state, Airwallex context, optional T:0 context, and DueGate policy/);
  assert.match(html,/A protected claim change that violates its bound policy requires reapproval/);
  assert.doesNotMatch(html,/Any protected change invalidates|Approval is bound to the payment, quote, funding and cutoff/);
  for(const selector of ['duegate-decision','funding-context','fx-context','deadline','human-approval-state','t0-accounting-check','audit-timeline'])assert.ok(html.includes('data-testid="'+selector+'"'));
  assert.ok(html.includes('data-detail="t0-statement-recheck"'));
  assert.equal(v.statementScene?.materialChange?.airwallexWritesAttempted,0);assert.equal(v.statementScene?.later.decision,'ESCALATE');assert.equal(s.adapter.writeAttempts,0);
  assert.equal(recordedStatementScene('fixtures/t0-statement-october.json').materialChange?.decision,'REAPPROVAL_REQUIRED');
 }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'duegate-selected-scene-'));rmSync(dir,{recursive:true});}
});


test('small cash movement from 310000 to 309900 stays within explicitly selected MINIMUM',()=>setup(async({s,store,context,a})=>{
 await approve(s);const old=store.current(SANDBOX_PAYABLE)!,e=structuredClone(old.evaluation);
 context.balanceSheet.accountingCashMinor=30990000n;e.statement=statementSnapshot(context,policy);
 assert.equal(store.inspect(e)?.status,'APPROVED');assert.equal(store.inspect(e)?.execution_fingerprint,old.approval.execution_fingerprint);
 assert.deepEqual(changedManifest(old.approval.manifest!,approvalManifest(e)),[]);zero(a);
}));
test('explicit MUST_EQUAL intentionally rejects even a small accounting cash movement',()=>setup(async({s,context,a})=>{
 const v=await approve(s);context.balanceSheet.accountingCashMinor=30990000n;
 const r=await s.action('execute',{confirm:v.preview!.digest});
 assert.equal(r.decision,'REAPPROVAL_REQUIRED');assert.equal(r.reason,'FINANCIAL_CONTEXT_CHANGED');
 assert.equal(r.contextRevalidation?.changedFields[0].policy,'MUST_EQUAL');zero(a);
},{accountingCash:{policy:'MUST_EQUAL'},netCashChange:{policy:'MUST_EQUAL'}}));
for(const claim of ['wallet.available','treasury.fixed_reserve','fx_policy.max_rate','accounting_cash'])test('numeric '+claim+' with no policy cannot be fingerprinted or revalidated',()=>setup(async({s,store,a})=>{
 await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation,valid=approvalManifest(e),invalid=structuredClone(valid);
 const c=invalid.protectedClaims.find(c=>c.claim===claim)!;
 // @ts-expect-error Missing policy is also invalid at the type boundary.
 delete c.policy;
 assert.throws(()=>manifestFingerprint(invalid),/CLAIM_POLICY_REQUIRED_OR_INVALID/);
 assert.throws(()=>changedManifest(valid,invalid),/CLAIM_POLICY_REQUIRED_OR_INVALID/);
 assert.throws(()=>changedManifest(invalid,valid),/CLAIM_POLICY_REQUIRED_OR_INVALID/);zero(a);
}));
test('statement snapshot requires a policy at both type and runtime boundaries',()=>{
 // @ts-expect-error Omission is deliberately tested at the untyped input boundary.
 assert.throws(()=>statementSnapshot(load()),/CLAIM_POLICY_REQUIRED_OR_INVALID/);
 const s=statementSnapshot(load(),policy);
 // @ts-expect-error Persisted/untyped malformed snapshots must fail closed as well.
 delete s.policy;
 assert.throws(()=>statementFingerprint(s),/CLAIM_POLICY_REQUIRED_OR_INVALID/);
 assert.equal(checkStatements(s,load(),'2026-10-30').decision,'ESCALATE');
});
for(const [label,p] of [
 ['missing',undefined],['partial',{accountingCash:{policy:'MUST_EQUAL'}}],
 ['unsupported',{accountingCash:{policy:'MAXIMUM',threshold:'25000000'},netCashChange:{policy:'MUST_EQUAL'}}],
 ['missing threshold',{accountingCash:{policy:'MINIMUM'},netCashChange:{policy:'MUST_EQUAL'}}],
 ['fractional threshold',{accountingCash:{policy:'MINIMUM',threshold:'1.5'},netCashChange:{policy:'MUST_EQUAL'}}]
] as const)test('invalid '+label+' policy fails before any statement read',async()=>{
 let reads=0;
 await assert.rejects(requireStatements(async()=>{reads++;return load();},()=> '2026-10-30T12:00:00.000Z',undefined,p as StatementPolicy),{message:'FINANCIAL_CONTEXT_INCOMPLETE'});
 assert.equal(reads,0);
});
test('invalid numeric policy cannot create a replacement approval or mutate existing approval history',()=>setup(async({s,store,a})=>{
 await approve(s);const history=store.history(SANDBOX_PAYABLE),e=structuredClone(history.at(-1)!.evaluation);
 e.statement!.policy=undefined as unknown as StatementPolicy;
 assert.throws(()=>store.propose(e),/CLAIM_POLICY_REQUIRED_OR_INVALID/);
 assert.deepEqual(store.history(SANDBOX_PAYABLE),history);zero(a);
}));
test('payment identity, amount, currency and status remain explicitly exact-match claims',()=>setup(async({s,store,a})=>{
 await approve(s);const e=store.current(SANDBOX_PAYABLE)!.evaluation,base=approvalManifest(e);
 for(const name of ['beneficiary_id','amount','currency','status'] as const){
  const next=structuredClone(base),claim=next.protectedClaims.find(c=>c.claim==='payment.'+name)!;
  assert.equal(claim.policy,'MUST_EQUAL');claim.approvedValue=name==='amount'?'101':claim.approvedValue+'-changed';
  assert.deepEqual(changedManifest(base,next).map(c=>c.claim),['payment.'+name]);
 }
 zero(a);
}));
