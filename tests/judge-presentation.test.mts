import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {PresentationService} from '../server/presentation-service.mts';
import {renderCase,renderConfirmation} from '../web/view.mts';
async function fixture(fn:(s:PresentationService)=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'duegate-judge-ui-'));
 try{await fn(new PresentationService(dir,undefined,undefined,{accountingEvidencePath:'fixtures/t0-paid-bill.json',statementEvidencePath:'fixtures/t0-statement-october.json'}));}
 finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'duegate-judge-ui-'));rmSync(dir,{recursive:true});}
}
test('judge hero is a standalone synthetic approval check; technical evidence is disclosed and WAIT remains separate',()=>fixture(async s=>{
 const v=await s.action('open'),before=structuredClone(v),html=renderCase(v);
 for(const text of ['Approval validity check','Separate example: an already-approved payment is revalidated immediately before execution.','Protected accounting cash','Source: T:0','Approved cash','Current cash','Minimum required','USD 310,000.00','USD 218,000.00','USD 250,000.00','Execution blocked','REAPPROVAL_REQUIRED','FINANCIAL_CONTEXT_CHANGED','Airwallex writes attempted','Values are synthetic; T:0 retrieval and period-validation evidence is recorded separately below.'])assert.ok(html.includes(text),text);
 assert.ok(html.indexOf('data-testid="validity-business-evidence"')<html.indexOf('data-detail="approval-claim-evidence"'));
 assert.ok(html.indexOf('data-detail="approval-claim-evidence"')<html.indexOf('Synthetic approval manifest'));
 assert.ok(html.indexOf('data-detail="approval-claim-evidence"')<html.indexOf('accounting_cash · t0'));
 assert.ok(html.indexOf('data-detail="approval-claim-evidence"')<html.indexOf('Approval version'));
 assert.ok(html.indexOf('Secondary example: funding and timing control')<html.indexOf('class="payable-sheet"'));
 assert.ok(html.includes('data-detail="t0-statement-recheck"'));assert.equal(v.decision,'WAIT');assert.deepEqual(v,before);assert.equal(s.adapter.writeAttempts,0);
}));
test('judge execution status is Not started without changing the stored MISSING state',()=>fixture(async s=>{
 const v=await s.action('open');assert.equal(v.executionState,'MISSING');const html=renderCase(v);
 assert.ok(html.includes('Execution status</span><strong>Not started'));assert.doesNotMatch(html,/>MISSING</);assert.equal(v.executionState,'MISSING');
}));
test('presentation groups only consecutive STATE_RESTORED and retains every record and anchor',()=>fixture(async s=>{
 const v=await s.action('open');const at='2026-10-27T17:48:00.000Z';
 v.audit=[{at,event:'STATE_RESTORED',detail:'restore-one'},{at,event:'STATE_RESTORED',detail:'restore-two'},{at,event:'STATE_RESTORED',detail:'restore-three'},{at,event:'APPROVAL_INVALIDATED',detail:'important-control-event'},{at,event:'STATE_RESTORED',detail:'restore-four'}];
 const before=structuredClone(v.audit),html=renderCase(v);
 assert.match(html,/State restored ×3/);assert.equal((html.match(/data-testid="audit-event"/g)??[]).length,3);
 for(let i=0;i<5;i++)assert.equal(html.split(' id="audit-event-'+i+'"').length-1,1);
 for(const event of v.audit)assert.ok(html.includes(event.detail));assert.ok(html.includes('data-event="APPROVAL_INVALIDATED"'));assert.deepEqual(v.audit,before);
 const live=renderCase({...v,presentationMode:false});assert.doesNotMatch(live,/State restored ×/);assert.equal((live.match(/data-testid="audit-event"/g)??[]).length,5);
}));
test('rendered grouping never alters persisted audit export or hides recorded restart protection',()=>fixture(async s=>{
 await s.action('open');await s.action('open');await s.action('open');
 const before=JSON.stringify(s.exportAudit()),v=s.view(),html=renderCase(v);
 assert.match(html,/State restored ×/);assert.equal(JSON.stringify(s.exportAudit()),before);assert.equal(s.adapter.writeAttempts,0);
 const recorded={...v,audit:[...v.audit,{at:v.clock,event:'RECORDED_STATE_RESTORED',detail:'persistent duplicate proof'}]};
 assert.match(renderCase(recorded),/Protection restored from persistent state/);
}));
test('missing statement evidence never renders the successful approval-validity hero',()=>fixture(async s=>{
 const v=await s.action('open');v.statementScene={...v.statementScene!,materialChange:undefined};
 const html=renderCase(v);assert.ok(!html.includes('data-testid="validity-business-evidence"'));assert.ok(html.includes('data-detail="t0-statement-recheck"'));assert.equal(s.adapter.writeAttempts,0);
}));


test('funded approval display distinguishes reserve from remaining availability and never alters payment terms',()=>fixture(async s=>{
 const v=await s.action('funded'),before=structuredClone(v),html=renderCase(v),modal=renderConfirmation(v,'approve');
 assert.equal(v.approval?.status,'PENDING');assert.equal(v.treasury.reserve,'100.00');assert.equal(v.treasury.free,'5.00');
 for(const text of ['Available after reserve and commitments · USD','Required reserve · USD','Sandbox beneficiary · DE / EUR','Protected approval context','Approval manifest fingerprint','Quote expiry','Latest safe execution',v.supplier,v.quote!.rate,v.amount])assert.ok(modal.includes(text),text);
 assert.ok(modal.includes('Required reserve · USD</span><strong>100.00'));
 assert.ok(modal.includes('Available after reserve and commitments · USD</span><strong>5.00'));
 assert.ok(html.includes('Recorded Airwallex balance − required reserve − application commitments = available after reserve and commitments'));
 assert.doesNotMatch(html+modal,/Free cash|…eficiary/);assert.deepEqual(v,before);assert.equal(s.view().approval?.status,'PENDING');assert.equal(s.adapter.writeAttempts,0);
 const live={...v,presentationMode:false,beneficiary:'Existing sanitized reference'};
 assert.ok(renderConfirmation(live,'approve').includes('Existing sanitized reference'),'Live approval retains its existing beneficiary reference');
}));
test('hero keeps its position, uses a natural heading, and states synthetic versus recorded T0 relationship once',()=>fixture(async s=>{
 const html=renderCase(await s.action('open'));
 assert.ok(html.includes('<h2 id="validity-title">Approval validity check</h2>'));
 const line='Reapproval policy scenario using the recorded T:0 report structure. Values are synthetic; T:0 retrieval and period-validation evidence is recorded separately below.';
 assert.equal(html.split(line).length-1,1);assert.ok(html.indexOf(line)<html.indexOf('Secondary example: funding and timing control'));
 assert.ok(html.includes('Accounting cash does not replace Airwallex spendable balance'));
 assert.ok(html.includes('T:0 supplies read-only accounting context'));assert.equal(s.adapter.writeAttempts,0);
}));
