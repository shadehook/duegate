import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {AccountingError,usdMinor,validateAccountingContext,bindAccountingContext,evaluateAccountingCheck,recordedAccountingCheck,RECORDED_ACCOUNTING_BINDING} from '../src/accounting-context.mts';
import {PresentationService} from '../server/presentation-service.mts';
import {renderCase,renderAccountingCheck} from '../web/view.mts';

const evidence=JSON.parse(readFileSync('fixtures/t0-paid-bill.json','utf8'));
const context=()=>({...structuredClone(evidence),amountMinor:499813n});
const rejects=(code:string,fn:()=>unknown)=>assert.throws(fn,(e:unknown)=>e instanceof AccountingError&&e.code===code);
test('accounting: USD 4,998.13 converts exactly to 499813n',()=>{assert.equal(usdMinor('4998.13'),499813n);assert.equal(usdMinor(4998.13),499813n);assert.equal(usdMinor('2062.5'),206250n);});
test('accounting: valid paid bill reaches the existing engine duplicate block',()=>{
 const c=bindAccountingContext(context(),RECORDED_ACCOUNTING_BINDING),r=evaluateAccountingCheck(c,RECORDED_ACCOUNTING_BINDING,'recorded');
 assert.equal(c.amountMinor,499813n);assert.equal(r.decision,'BLOCK_DUPLICATE');assert.equal(r.reason,'EXECUTION_BLOCKED');assert.equal(r.canExecute,false);
 assert.equal(r.dueDate,'2026-10-20');assert.equal(r.paidDate,'2026-10-26');assert.equal(r.amount,'4998.13');
 assert.equal(r.fxQuoteRequests+r.conversionRequests+r.transferRequests,0);assert.ok(Object.isFrozen(c));assert.ok(Object.isFrozen(r));
});
for(const status of ['open','voided','drafted'])test('accounting: '+status+' cannot authorize execution',()=>{
 const r=evaluateAccountingCheck({...context(),status,paidDate:null},RECORDED_ACCOUNTING_BINDING,'recorded');assert.equal(r.decision,'NOT_EVALUATED');assert.equal(r.reason,'ACCOUNTING_STATUS_NOT_PAID');assert.equal(r.canExecute,false);
});
for(const value of ['PAID','succeeded','unknown',{},null])test('accounting: unsupported status '+JSON.stringify(value),()=>rejects('UNSUPPORTED_STATUS',()=>validateAccountingContext({...context(),status:value})));
for(const value of ['4998.131','4,998.13',' 4998.13','1e3',-1,0,Infinity,NaN,0.1+0.2,null,{},'10000000000000'])test('accounting: malformed amount '+String(value),()=>rejects('INVALID_AMOUNT',()=>usdMinor(value)));
for(const value of ['usd','EUR','JPY','ABC',null])test('accounting: unsupported currency '+value,()=>rejects('INVALID_CURRENCY',()=>validateAccountingContext({...context(),currency:value})));
for(const [field,value] of [['dueDate','2026-02-30'],['dueDate','2026-10-20T12:00:00Z'],['paidDate','2026-13-01'],['paidDate',null],['paidDate','2026-11-02']])test('accounting: invalid date '+field+' '+value,()=>rejects('INVALID_DATE',()=>validateAccountingContext({...context(),[field!]:value})));
test('accounting: a missing due date stays null, never an invented cutoff',()=>assert.equal(validateAccountingContext({...context(),dueDate:null}).dueDate,null));
test('accounting: malformed identities and unexpected authority fields rejected',()=>{
 rejects('INVALID_IDENTITY',()=>validateAccountingContext({...context(),recordId:'../other?token=secret'}));
 for(const [key,value] of [['wallet_balance',999999999n],['transfer_id','synthetic-transfer'],['execution',{state:'completed'}],['approval','APPROVED']])rejects('UNEXPECTED_FIELD',()=>validateAccountingContext({...context(),[key as string]:value}));
 const x=context();delete x.status;rejects('UNEXPECTED_FIELD',()=>validateAccountingContext(x));
});
test('accounting: entity, record and amount/currency bindings are explicit',()=>{
 rejects('IDENTITY_MISMATCH',()=>bindAccountingContext(context(),{...RECORDED_ACCOUNTING_BINDING,entityId:'other-entity'}));
 rejects('IDENTITY_MISMATCH',()=>bindAccountingContext(context(),{...RECORDED_ACCOUNTING_BINDING,recordId:'other-bill'}));
 rejects('OBLIGATION_MISMATCH',()=>bindAccountingContext(context(),{...RECORDED_ACCOUNTING_BINDING,expectedAmountMinor:100n}));
});
test('accounting: invalid or forged provenance rejected',()=>{
 for(const change of [{source:'other'},{recordType:'Payment'},{sourceRefs:['https://evil.invalid']},{capturedAt:'2026-02-30T00:00:00.000Z'},{sourceAsOf:'2026-11-01T00:00:00.000Z'}])rejects('INVALID_PROVENANCE',()=>validateAccountingContext({...context(),...change}));
 assert.equal(validateAccountingContext({...context(),sourceAsOf:'2026-10-31T01:26:43.858438Z'}).sourceAsOf,'2026-10-31T01:26:43.858438Z');
});
test('accounting: recorded fixture has a pinned binding and sanitized output only',()=>{
 const r=recordedAccountingCheck(evidence);assert.equal(r.evidenceMode,'recorded');const text=JSON.stringify(r);
 for(const field of ['entityId','recordId','vendorId','sourceRefs','transfer_id','execution_key','beneficiary_id','wallet_balance'])assert.ok(!text.includes(field));
 assert.ok(!text.includes(evidence.recordId));assert.ok(!text.includes(evidence.vendorId));
 rejects('IDENTITY_MISMATCH',()=>recordedAccountingCheck({...evidence,recordId:'other',sourceRefs:['t0:entity:recorded-t0-sandbox','t0:VendorBill:other','t0:Vendor:recorded-vendor-70c456a0d0']}));
 rejects('INVALID_RECORDED_EVIDENCE',()=>recordedAccountingCheck({...evidence,amountMinor:499813}));
});
test('accounting: distinct copy and stable selectors never imply an attached transfer',()=>{
 const html=renderAccountingCheck(recordedAccountingCheck(evidence));
 for(const text of ['USD 4,998.13','PAID','BLOCK_DUPLICATE','Recorded T:0 sandbox evidence','This obligation is already recorded as paid in the accounting system. Further execution is blocked.','No FX quote, conversion, or transfer requested.','Separate accounting check from the EUR demo payable.','data-testid="t0-accounting-check"','data-testid="t0-decision"'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/attached to an existing transfer|data-action=|<button/);
 const open=evaluateAccountingCheck({...context(),status:'open',paidDate:null},RECORDED_ACCOUNTING_BINDING,'recorded');assert.match(renderAccountingCheck(open),/does not authorize execution/);
});
test('accounting: presentation opt-in is offline and creates no execution records',async t=>{
 let network=0;t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('NETWORK_FORBIDDEN');});
 const dir=mkdtempSync(join(tmpdir(),'duegate-t0-offline-'));
 try {
  const service=new PresentationService(dir,undefined,undefined,{accountingEvidencePath:'fixtures/t0-paid-bill.json'});
  let provider=0;for(const name of ['getWalletBalances','createFxQuote','getRelevantBeneficiary','validateTransfer','createConversion','createTransfer','getConversion','getTransfer'] as const)t.mock.method(service.adapter,name,async()=>{provider++;throw new Error('PROVIDER_FORBIDDEN');});
  const before=readdirSync(dir,{recursive:true});const view=service.view();assert.equal(view.accountingCheck?.decision,'BLOCK_DUPLICATE');
  assert.equal(view.amount,'1.00');assert.equal(view.target,'EUR');assert.equal(view.result,null);assert.equal(view.approval,null);
  assert.deepEqual(readdirSync(dir,{recursive:true}),before);assert.equal(provider,0);assert.equal(network,0);assert.equal(service.adapter.writeAttempts,0);
  const audit=JSON.stringify(service.exportAudit());assert.match(audit,/accounting_check/);assert.doesNotMatch(audit,/recorded-bill-57c3e6aecd/);
 }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'duegate-t0-'));rmSync(dir,{recursive:true});}
});
test('accounting: optional panel preserves the entire EUR story and restart protection',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('NETWORK_FORBIDDEN');});
 const root=mkdtempSync(join(tmpdir(),'duegate-t0-story-'));
 try {
  const a=new PresentationService(join(root,'baseline')),b=new PresentationService(join(root,'accounting'),undefined,undefined,{accountingEvidencePath:'fixtures/t0-paid-bill.json'});
  const signature=(v:ReturnType<PresentationService['view']>)=>({decision:v.decision,reason:v.reason,amount:v.amount,target:v.target,treasury:v.treasury,quote:v.quote,approval:v.approval,result:v.result,canExecute:v.canExecute,conversionCount:v.conversionCount,transferCount:v.transferCount});
  async function both(action:string,body:Record<string,unknown>={}){const x=await a.action(action,body),y=await b.action(action,body);assert.deepEqual(signature(y),signature(x));assert.equal(y.accountingCheck?.decision,'BLOCK_DUPLICATE');return x;}
  let v=await both('open');assert.equal(v.decision,'WAIT');await both('interpret',{text:v.fundingExample});v=await both('apply');assert.equal(v.decision,'ESCALATE');
  v=await both('funded');await both('approve',{fingerprint:v.approval!.execution_fingerprint});v=await both('invalidate');assert.equal(v.approval!.status,'INVALIDATED');await both('execute');
  v=await both('funded');await both('approve',{fingerprint:v.approval!.execution_fingerprint});v=await both('show-recorded');assert.equal(v.decision,'BLOCK_DUPLICATE');await both('execute');
  const restarted=new PresentationService(join(root,'accounting'),undefined,undefined,{accountingEvidencePath:'fixtures/t0-paid-bill.json'});const restored=await restarted.action('open');assert.equal(restored.result!.transferId,v.result!.transferId);assert.equal(restored.accountingCheck?.decision,'BLOCK_DUPLICATE');assert.equal((await restarted.action('execute')).canExecute,false);
  assert.equal(a.adapter.writeAttempts+b.adapter.writeAttempts+restarted.adapter.writeAttempts,0);assert.doesNotMatch(renderCase(a.view()),/id="t0-accounting-check"/);
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'duegate-t0-'));rmSync(root,{recursive:true});}
});
