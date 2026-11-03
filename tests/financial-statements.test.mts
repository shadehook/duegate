import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BALANCE_SHEET,CASH_FLOW,checkStatements,parseStatements,statementSnapshot,statementFingerprint,StatementVeto} from '../src/financial-statement-context.mts';
import {t0StatementReader} from '../src/t0-statement-reader.mts';
import {MockAdapter} from '../fixtures/mock-adapter.mts';
import {DemoService} from '../server/demo-service.mts';
import {recordedStatementScene} from '../server/statement-scene.mts';
import {PresentationService} from '../server/presentation-service.mts';
import {renderCase} from '../web/view.mts';
import {intentFingerprint} from '../src/approval-store.mts';
import type {Evaluation} from '../src/execution-controller.mts';

const path='fixtures/t0-statement-october.json';
const fixture=()=>JSON.parse(readFileSync(path,'utf8'));
const parse=(f=fixture())=>parseStatements(f.balanceSheet,f.cashFlow,f,f.entityRef,f.capturedAt);
const c=parse(),approved=statementSnapshot(c),day=c.periodEnd,period={periodStart:c.periodStart,periodEnd:day};
test('observed report projections use exact period cells and signed integer atoms',()=>{
  assert.deepEqual(c.balanceSheet,{accountingCashMinor:21644433n,totalAssetsMinor:13305090n,totalLiabilitiesMinor:280806n});
  assert.deepEqual(c.cashFlow,{netCashChangeMinor:-1755443n,operatingCashFlowMinor:-1755443n});
  assert.deepEqual(c.sourceRefs,[BALANCE_SHEET,CASH_FLOW]);assert.ok(!('as_of' in c));
});
test('null protected cell means missing; integer zero is evidence',()=>{
  const f=fixture();const cells=f.balanceSheet.sections[0].children[0].balances;
  cells['2026-10']=null;assert.equal(parse(f).balanceSheet.accountingCashMinor,undefined);
  assert.equal(checkStatements(approved,parse(f),day).result,'FINANCIAL_CONTEXT_INCOMPLETE');
  cells['2026-10']=0;assert.equal(parse(f).balanceSheet.accountingCashMinor,0n);
  assert.equal(checkStatements(approved,parse(f),day).decision,'ESCALATE');
});
for(const [name,mutate] of [
  ['currency mismatch',(f)=>{f.cashFlow.reporting_currency='EUR';}],
  ['wrong atom scale',(f)=>{f.balanceSheet.atoms_per_unit=1;}],
  ['floating amount',(f)=>{f.cashFlow.sections[1].balances['2026-10']=1.2;}],
  ['unusable period',(f)=>{f.balanceSheet.periods[0].end_date='2026-10-31';}],
  ['ambiguous net subtotal',(f)=>{f.cashFlow.sections.push(f.cashFlow.sections[1]);}],
  ['unrecognized bank group even if named Bank',(f)=>{Object.assign(f.balanceSheet.sections[0].children[0],{name:'Bank',account_id:'another-group'});}],
  ['unexpected net row kind',(f)=>{f.cashFlow.sections[1].is_subtotal=false;}],
  ['missing sections',(f)=>{f.balanceSheet.sections=null;}]
] as [string,(f:ReturnType<typeof fixture>)=>void][])test('report parser fails closed: '+name,()=>{
  const f=fixture();mutate(f);assert.throws(()=>parse(f),StatementVeto);
});
test('fresh capture or changes to unprotected totals do not invalidate the approved assumptions',()=>{
  const next=structuredClone(c);next.capturedAt='2026-11-03T12:00:00.000Z';next.balanceSheet.totalAssetsMinor=42n;
  assert.deepEqual(checkStatements(approved,next,day),{result:'FINANCIAL_CONTEXT_OK',decision:null,decisionDate:day,coversDecisionDate:true});
});
test('missing or out-of-period report never supports approval',()=>{
  assert.equal(checkStatements(approved,null,day).decision,'ESCALATE');
  assert.deepEqual(checkStatements(approved,c,'2026-10-31'),{result:'FINANCIAL_CONTEXT_OUT_OF_PERIOD',decision:'ESCALATE',decisionDate:'2026-10-31',coversDecisionDate:false});
});
test('fingerprints bind entity, currency, period and both signed atom values',()=>{
  for(const [key,value] of Object.entries(approved))assert.notEqual(statementFingerprint(approved),statementFingerprint({...approved,[key]:value+'x'}));
  const next=structuredClone(c);next.cashFlow.netCashChangeMinor!-=1n;
  assert.equal(checkStatements(approved,next,day).result,'FINANCIAL_CONTEXT_CHANGED');
  assert.equal(checkStatements(approved,next,day).decision,'ESCALATE');
});
test('reader pins entity, window, origin, GET and nonredirecting transport for both reports',async()=>{
  const paths:string[]=[],f=fixture();
  const read=t0StatementReader('synthetic-key','synthetic-entity',async(url,init)=>{
    const u=new URL(String(url));paths.push(u.pathname);
    assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);assert.equal(u.origin,'https://api.t0.ai');
    assert.deepEqual(Object.fromEntries(u.searchParams),{start_date:c.periodStart,end_date:c.periodEnd,period_type:'monthly',entity:'synthetic-entity'});
    return Response.json(u.pathname===BALANCE_SHEET?f.balanceSheet:f.cashFlow);
  });
  const result=await read(period);assert.deepEqual(paths,[BALANCE_SHEET,CASH_FLOW]);assert.deepEqual(result.cashFlow,c.cashFlow);
});
for(const kind of ['HTTP error','fraction rounded to integer','invalid JSON'])test('reader stops without retry or raw provider data: '+kind,async()=>{
  let calls=0;const read=t0StatementReader('synthetic-key','synthetic-entity',async()=>{
    calls++;return new Response(kind==='HTTP error'?'untrusted provider body':kind==='invalid JSON'?'{':'{"n":1.00000000000000001}',{status:kind==='HTTP error'?403:200,headers:{'content-type':'application/json'}});
  });
  await assert.rejects(read(period),{message:'FINANCIAL_CONTEXT_INCOMPLETE'});assert.equal(calls,1);
});
for(const scenario of ['changed','unavailable','out-of-period','reader removed','late change'] as const)test('approved execution refuses '+scenario+' across restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'duegate-statement-'));t.after(()=>rmSync(dir,{recursive:true}));
  const adapter=new MockAdapter();let now='2026-10-30T23:57:00.000Z',reads=0,stopAt=Infinity;
  adapter.quote.valid_from_at=now;adapter.quote.expires_at='2026-10-31T00:12:00.000Z';
  const read=async()=>{reads++;if(reads>=stopAt&&scenario==='unavailable')throw Error('private provider message');
    const next=structuredClone(c);if(reads>=stopAt)next.balanceSheet.accountingCashMinor!+=1n;return next;};
  const start=(enabled=true)=>new DemoService(adapter,dir,()=>now,{finalProof:true,financialWritesEnabled:true,statements:enabled?read:undefined});
  let s=start();let v=await s.action('open');assert.equal(v.decision,'WAIT');assert.equal(reads,0);
  v=await s.action('funded');assert.equal(v.decision,'EXECUTE');assert.equal(v.canExecute,false);
  v=await s.action('approve',{fingerprint:v.approval!.execution_fingerprint});assert.equal(v.approval?.status,'APPROVED');
  const digest=v.preview!.digest;const previous=adapter.quotes;
  if(scenario==='out-of-period')now='2026-10-31T00:01:00.000Z';
  stopAt=reads+(scenario==='late change'?3:1);s=start(scenario!=='reader removed');
  v=await s.action('execute',{confirm:digest});
  const expected=scenario==='out-of-period'?'FINANCIAL_CONTEXT_OUT_OF_PERIOD':scenario==='unavailable'||scenario==='reader removed'?'FINANCIAL_CONTEXT_INCOMPLETE':'FINANCIAL_CONTEXT_CHANGED';
  assert.equal(v.decision,'ESCALATE');assert.equal(v.reason,expected);assert.equal(v.canExecute,false);
  assert.equal(v.approval?.status,'INVALIDATED');
  const restored=start().view();assert.equal(restored.canExecute,false);assert.equal(restored.reason,expected);
  assert.equal(adapter.quotes,previous);assert.equal(adapter.conversions,0);assert.equal(adapter.transfers,0);
  assert.ok(!JSON.stringify(s.exportAudit()).includes('private provider message'));
});
test('bound and unbound human approval fingerprints are distinct',()=>{
  const e={input:{payable:{},treasury:{},funding:{},fx_policy:{}},quote:null} as unknown as Evaluation;
  assert.notEqual(intentFingerprint(e),intentFingerprint({...e,statement:approved}));
  assert.notEqual(intentFingerprint({...e,statement:approved}),intentFingerprint({...e,statement:{...approved,netCashChangeMinor:'0'}}));
});
test('unavailable initial statements stop a funded proposal before its first FX quote',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'duegate-statement-incomplete-'));t.after(()=>rmSync(dir,{recursive:true}));
  const a=new MockAdapter(),s=new DemoService(a,dir,()=>a.quote.valid_from_at,{statements:async()=>{throw Error('unavailable');}});
  const v=await s.action('funded');assert.equal(v.decision,'ESCALATE');assert.equal(v.reason,'FINANCIAL_CONTEXT_INCOMPLETE');
  assert.equal(v.approval,null);assert.equal(v.canExecute,false);assert.deepEqual([a.quotes,a.conversions,a.transfers],[0,0,0]);
});
test('re-reading a changed statement at human confirmation invalidates the pending approval',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'duegate-statement-confirm-'));t.after(()=>rmSync(dir,{recursive:true}));
  const a=new MockAdapter(),now='2026-10-30T12:00:00.000Z';a.quote.valid_from_at=now;a.quote.expires_at='2026-10-30T12:15:00.000Z';
  const next=structuredClone(c),s=new DemoService(a,dir,()=>now,{statements:async()=>next});
  let v=await s.action('funded');const fp=v.approval!.execution_fingerprint;
  next.cashFlow.netCashChangeMinor!+=1n;v=await s.action('approve',{fingerprint:fp});
  assert.equal(v.reason,'FINANCIAL_CONTEXT_CHANGED');assert.equal(v.decision,'ESCALATE');assert.equal(v.approval?.status,'INVALIDATED');
  assert.equal(v.canExecute,false);assert.equal(a.conversions+a.transfers,0);
});
test('offline scene: unchanged, then out of period; EUR WAIT and paid bill remain independent',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'duegate-statement-scene-'));t.after(()=>rmSync(dir,{recursive:true}));
  const s=new PresentationService(dir,undefined,undefined,{accountingEvidencePath:'fixtures/t0-paid-bill.json',statementEvidencePath:path});
  const v=await s.action('open');assert.equal(v.decision,'WAIT');assert.equal(v.accountingCheck?.decision,'BLOCK_DUPLICATE');
  const scene=v.statementScene!;assert.equal(scene.initial.result,'FINANCIAL_CONTEXT_OK');assert.equal(scene.initial.decision,null);
  assert.equal(scene.later.result,'FINANCIAL_CONTEXT_OUT_OF_PERIOD');assert.equal(scene.later.decision,'ESCALATE');
  for(const name of ['getWalletBalances','createFxQuote','getRelevantBeneficiary','validateTransfer','createConversion','createTransfer'] as const)
    t.mock.method(s.adapter,name,()=>assert.fail('No provider calls for the statement scene'));
  const html=renderCase(s.view());assert.match(html,/USD 216,444.33/);assert.match(html,/USD -17,554.43/);assert.match(html,/ESCALATE \/ FINANCIAL_CONTEXT_OUT_OF_PERIOD/);
  assert.equal(s.exportAudit().statement_scene?.later.coversDecisionDate,false);assert.equal(s.adapter.writeAttempts,0);
  assert.equal(recordedStatementScene(join(dir,'missing.json')).initial.result,'FINANCIAL_CONTEXT_INCOMPLETE');
});
