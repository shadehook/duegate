import test from 'node:test';import assert from 'node:assert/strict';
import {dateWindow,resolveDay} from '../src/temporal.mts';
import {decide} from '../src/decision-engine.mts';
import {deterministicFundingV2,emptyCandidate,validateCandidate,applyFundingV2,candidateSchema,wireCandidate} from '../src/funding-v2.mts';
import {processFundingV2} from '../src/funding-v2-workflow.mts';
import {OpenAiFundingInterpreter} from '../src/openai-funding-interpreter.mts';
import {sourceHash} from '../src/funding-update.mts';
import {fixture,known,reference,timezone,hero,liveCases} from '../fixtures/funding-phase10.mts';

test('original day-only hero is DELAYED DATE with no invented exact time; WAIT -> ESCALATE',async()=>{
  const input=fixture();assert.equal(decide(input).decision,'WAIT');
  const c=deterministicFundingV2.interpret(hero,known,reference,timezone);
  assert.equal(c.classification,'DELAYED');assert.equal(c.new_eta_exact,null);assert.equal(c.new_eta_date,'2026-10-12');
  assert.equal(c.eta_window_start,'2026-10-12T04:00:00.000Z');assert.equal(c.eta_window_end,'2026-10-13T04:00:00.000Z');
  const out=await processFundingV2(deterministicFundingV2,hero,known,input,reference,timezone,[]);
  assert.equal(out.decision.reason,'INFLOW_TOO_LATE');assert.equal(out.input.treasury.expected_inflow_eta,null);
});
test('Thursday full day before Friday cutoff is timely',()=>{
  const i=fixture();i.treasury.expected_inflow_eta=null;i.treasury.expected_inflow_eta_window=dateWindow('2026-10-08',timezone);
  assert.equal(decide(i).decision,'WAIT');
});
test('Friday full day crossing Friday noon cutoff requires review',()=>{
  const i=fixture();i.treasury.expected_inflow_eta=null;i.treasury.expected_inflow_eta_window=dateWindow('2026-10-09',timezone);
  assert.equal(decide(i).reason,'INFLOW_ETA_UNCERTAIN');assert.equal(decide(i).decision,'ESCALATE');
});
test('exact timestamp before, at, after cutoff preserves original strict boundary',()=>{
  for(const [eta,expected] of [['2026-10-09T15:59:59.999Z','WAIT'],['2026-10-09T16:00:00.000Z','ESCALATE'],['2026-10-09T16:00:00.001Z','ESCALATE']]){const i=fixture();i.treasury.expected_inflow_eta=eta;assert.equal(decide(i).decision,expected);}
});
test('window equality uses half-open end; start at cutoff too late',()=>{
  const i=fixture();i.treasury.expected_inflow_eta=null;
  i.treasury.expected_inflow_eta_window={precision:'TIME_WINDOW',date:null,timezone,start:'2026-10-09T15:00:00.000Z',end:i.payable.latest_safe_execution_at};assert.equal(decide(i).decision,'WAIT');
  i.treasury.expected_inflow_eta_window={...i.treasury.expected_inflow_eta_window,start:i.payable.latest_safe_execution_at,end:'2026-10-09T17:00:00.000Z'};assert.equal(decide(i).reason,'INFLOW_TOO_LATE');
});
test('timezone boundary and 23/25-hour DST calendar days',()=>{
  assert.equal(resolveDay('tomorrow','2026-10-08T01:00:00.000Z','America/Los_Angeles'),'2026-10-08');
  assert.equal(resolveDay('tomorrow','2026-10-08T01:00:00.000Z','Asia/Tokyo'),'2026-10-09');
  for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]] as const){const w=dateWindow(date,timezone);assert.equal(Date.parse(w.end)-Date.parse(w.start),hours*3600000);}
});
test('malformed, contradictory or concurrent exact/window input fails closed',()=>{
  const i=fixture();i.treasury.expected_inflow_eta_window=dateWindow('2026-10-08',timezone);assert.equal(decide(i).reason,'INVALID_INPUT');
  i.treasury.expected_inflow_eta=null;i.treasury.expected_inflow_eta_window.end=i.treasury.expected_inflow_eta_window.start;assert.equal(decide(i).reason,'INVALID_INPUT');
  assert.throws(()=>dateWindow('2026-02-30',timezone));
});
test('window partially in past cannot justify waiting',()=>{
  const i=fixture();i.treasury.expected_inflow_eta=null;i.treasury.expected_inflow_eta_window=dateWindow('2026-10-07',timezone);assert.equal(decide(i).reason,'INFLOW_ETA_UNCERTAIN');
});
test('irrelevant v2 message is a true no-op',async()=>{
  const i=fixture();const out=await processFundingV2(deterministicFundingV2,'Customer confirmed invoice reference INV-4832.',known,i,reference,timezone,[]);assert.equal(out.input,i);assert.equal(out.decision.decision,'WAIT');
});
test('on-time date restatement does not lose existing exact ETA',()=>{
  const raw='The customer says payment is still expected Thursday.';
  const c=validateCandidate({...emptyCandidate('ON_TIME'),expected_inflow_id:'INFLOW-001',amount_minor:400000,currency:'USD',eta_precision:'DATE',new_eta_date:'2026-10-08'},raw,known,reference,timezone);
  const s=fixture().treasury;assert.equal(applyFundingV2(s,c,raw,known,reference,timezone,[]).state,s);
});
test('combined amount and date change updates both; never cash/reserve/commitments',()=>{
  const raw='The $4,000 payment is now $3,500 and will arrive Monday.';
  const c=validateCandidate({...emptyCandidate('AMOUNT_CHANGED'),expected_inflow_id:'INFLOW-001',amount_minor:350000,currency:'USD',eta_precision:'DATE',new_eta_date:'2026-10-12'},raw,known,reference,timezone);
  const s=fixture().treasury,out=applyFundingV2(s,c,raw,known,reference,timezone,[]);assert.equal(out.state.expected_inflow_amount,350000n);assert.equal(out.state.expected_inflow_eta_window?.date,'2026-10-12');
  for(const k of ['wallet_balance','fixed_reserve','committed_amount'] as const)assert.equal(out.state[k],s[k]);
});
test('wire schema rejects extra decisions, actions, overrides, invalid money and invented times',()=>{
  const wire=wireCandidate(deterministicFundingV2.interpret(hero,known,reference,timezone));
  for(const key of ['decision','payment_action','fixed_reserve','beneficiary_id','airwallex_action'])assert.throws(()=>validateCandidate({...wire,[key]:'EXECUTE'},hero,known,reference,timezone));
  assert.throws(()=>validateCandidate({...wire,amount_minor:-1},hero,known,reference,timezone));
  assert.throws(()=>validateCandidate({...wire,eta_precision:'EXACT_TIMESTAMP',new_eta_exact:'2026-10-12T13:00:00.000Z',new_eta_date:null,eta_window_start:null,eta_window_end:null},hero,known,reference,timezone));
});
const apiBody=(candidate:unknown)=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(candidate)}]}]});
const config={provider:'openai' as const,model:'synthetic-model',apiKey:'synthetic-test-key'};
test('mock HTTP confirms strict Responses schema, secret-free prompt, and date normalization',async()=>{
  const wire=wireCandidate(deterministicFundingV2.interpret(hero,known,reference,timezone));wire.eta_window_start=null;wire.eta_window_end=null;
  const transport:typeof fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init!.body as string);
    assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.deepEqual(body.text.format.schema,candidateSchema);assert.equal(body.tools,undefined);
    assert.ok(!(init!.body as string).includes(config.apiKey));assert.ok(!(init!.body as string).includes('bank_details'));assert.ok(!(init!.body as string).includes('do-not-send'));
    assert.equal(init!.redirect,'error');return new Response(JSON.stringify(apiBody(wire)),{status:200});};
  const a=new OpenAiFundingInterpreter(config,new Set([sourceHash(hero)]),transport);
  const extra=[{...known[0],bank_details:'do-not-send',api_key:'do-not-send'}];const c=await a.interpret(hero,extra,reference,timezone);assert.equal(c.eta_window_start,'2026-10-12T04:00:00.000Z');assert.equal(a.calls,1);
});
test('mock unsafe model response fails closed and raw output never enters audit',async()=>{
  const transport:typeof fetch=async()=>new Response(JSON.stringify(apiBody({...emptyCandidate(),decision:'EXECUTE',secret:'do-not-log'})));
  const a=new OpenAiFundingInterpreter(config,new Set([sourceHash(hero)]),transport),i=fixture();
  const out=await processFundingV2(a,hero,known,i,reference,timezone,[]);assert.equal(out.outcome,'REJECTED');assert.equal(out.input,i);assert.ok(out.review_required);assert.ok(!JSON.stringify(out.audit).includes('do-not-log'));
});
test('mock refusal, incomplete response, tool call, HTTP error and timeout fail closed without retry',async()=>{
  for(const body of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'function_call'}]},{status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}]){
    const a=new OpenAiFundingInterpreter(config,new Set([sourceHash(hero)]),async()=>new Response(JSON.stringify(body)));await assert.rejects(a.interpret(hero,known,reference,timezone));assert.equal(a.calls,1);
  }
  for(const transport of [async()=>new Response('secret',{status:401}),async()=>{throw new Error('secret');}] as (typeof fetch)[]){const a=new OpenAiFundingInterpreter(config,new Set([sourceHash(hero)]),transport);await assert.rejects(a.interpret(hero,known,reference,timezone),e=>!(e as Error).message.includes('secret'));assert.equal(a.calls,1);}
});
test('arbitrary non-synthetic text cannot leave adapter',async()=>{
  const a=new OpenAiFundingInterpreter(config,new Set([sourceHash(hero)]),async()=>{throw new Error('must not call');});
  await assert.rejects(a.interpret('private unapproved content',known,reference,timezone),/NON_SYNTHETIC/);assert.equal(a.calls,0);
});
test('ambiguous model date alternatives preserve window and require review',async()=>{
  const raw='The payment may arrive Monday or Tuesday.';const w1=dateWindow('2026-10-12',timezone),w2=dateWindow('2026-10-13',timezone);
  const c=validateCandidate({...emptyCandidate('AMBIGUOUS'),expected_inflow_id:'INFLOW-001',amount_minor:400000,currency:'USD',eta_precision:'TIME_WINDOW',eta_window_start:w1.start,eta_window_end:w2.end,ambiguities:['CONFLICTING_DATES']},raw,known,reference,timezone);
  const i=fixture(),out=await processFundingV2({interpret:()=>c},raw,known,i,reference,timezone,[]);assert.equal(out.input,i);assert.ok(out.review_required);
});
test('DATE cannot carry forged shortened bounds to pass cutoff',()=>{
  const wire=wireCandidate(deterministicFundingV2.interpret(hero,known,reference,timezone));
  assert.throws(()=>validateCandidate({...wire,eta_window_end:'2026-10-12T05:00:00.000Z'},hero,known,reference,timezone));
});
test('date update receipt prevents duplicate update and preserves state',()=>{
  const c=deterministicFundingV2.interpret(hero,known,reference,timezone),first=applyFundingV2(fixture().treasury,c,hero,known,reference,timezone,[]);
  const again=applyFundingV2(first.state,c,hero,known,reference,timezone,[first.receipt]);assert.equal(again.outcome,'DUPLICATE');assert.equal(again.state,first.state);
});
test('malicious custom interpreter cannot leak unvalidated output to audit',async()=>{
  const bad={...deterministicFundingV2.interpret(hero,known,reference,timezone),classification:'AMBIGUOUS',secret:'never-log-this'};
  const out=await processFundingV2({interpret:()=>bad as ReturnType<typeof deterministicFundingV2.interpret>},hero,known,fixture(),reference,timezone,[]);
  assert.equal(out.outcome,'REJECTED');assert.ok(!JSON.stringify(out.audit).includes('never-log-this'));assert.equal(out.candidate,null);
});
test('funded branch and duplicate precedence remain independent of date-window lateness',()=>{
  const i=fixture();i.treasury.wallet_balance=1000000n;i.treasury.expected_inflow_eta=null;i.treasury.expected_inflow_eta_window=dateWindow('2026-10-12',timezone);
  // Current cash is enough: existing engine still requires a fresh acceptable quote.
  assert.equal(decide(i).reason,'QUOTE_MISSING');i.execution.transfer_id='synthetic-existing';assert.equal(decide(i).decision,'BLOCK_DUPLICATE');
});
for(const sample of liveCases)test(`offline adversarial corpus: ${sample.id}`,async()=>{
  const input=fixture(),out=await processFundingV2(deterministicFundingV2,sample.text,known,input,reference,timezone,[]);
  const c=out.candidate;assert.ok(c, 'offline grammar returns a validated candidate');assert.ok(sample.classes.includes(c.classification));
  if(sample.decision)assert.equal(out.decision.decision,sample.decision);
  if(sample.review!==undefined)assert.equal(out.review_required,sample.review);
  if(sample.noChange)assert.equal(out.input,input);
  if(sample.amount!==undefined)assert.equal(c.amount_minor,sample.amount);
  if(sample.precision)assert.equal(c.eta_precision,sample.precision);
  for(const k of ['wallet_balance','fixed_reserve','committed_amount'] as const)assert.equal(out.input.treasury[k],input.treasury[k]);
  assert.ok(!JSON.stringify(c).match(/EXECUTE|ESCALATE|WAIT|BLOCK_DUPLICATE/));
});
