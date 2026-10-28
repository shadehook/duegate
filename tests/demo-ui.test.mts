import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import type {AirwallexAdapter,QuotedFx,ConversionPayload,TransferPayload,TransferResult,ConversionResult} from '../src/airwallex-adapter.mts';
import {minor} from '../src/airwallex-adapter.mts';
import {DemoService} from '../server/demo-service.mts';
import {renderCase} from '../web/view.mts';
class MockAdapter implements AirwallexAdapter {
  usd = 1000000000n; eur = 1000n; quotes = 0; conversions = 0; transfers = 0; validations = 0;
  failTransfer = false; failConversion = false;
  conversionStatus = 'SETTLED'; lastConversion: ConversionResult | null = null; lastTransfer: TransferResult | null = null;
  quote: QuotedFx = { quote_id: 'synthetic-quote', source_currency: 'USD', target_currency: 'EUR', source_amount: 114n, target_amount: 100n, source_fee_amount: 0n, rate: '1.14', currency_pair: 'EURUSD', valid_from_at: '2026-10-04T15:00:00.000Z', expires_at: '2026-10-04T15:15:00.000Z', conversion_date: '2026-10-04', usage: 'MULTI_USE' };
  async getWalletBalances() { return [{ currency: 'USD', available: this.usd, pending: 0n, total: this.usd }, { currency: 'EUR', available: this.eur, pending: 0n, total: this.eur }]; }
  async createFxQuote() { this.quotes++; return {...structuredClone(this.quote), quote_id: 'synthetic-quote-'+this.quotes}; }
  async getRelevantBeneficiary(id: string) { return { id, currency: 'EUR', country: 'DE', transfer_methods: ['LOCAL'] }; }
  async validateTransfer() { this.validations++; }
  async createConversion(p: ConversionPayload) {
    this.conversions++; if (this.failConversion) throw new Error('Synthetic ambiguous conversion');
    this.usd -= this.quote.source_amount; this.eur += this.quote.target_amount;
    this.lastConversion = { id: 'synthetic-conversion', status: this.conversionStatus, request_id: p.request_id, quote_id: p.quote_id, source_amount: this.quote.source_amount, target_amount: this.quote.target_amount };
    return structuredClone(this.lastConversion);
  }
  async createTransfer(p: TransferPayload): Promise<TransferResult> {
    this.transfers++; this.eur -= minor(p.transfer_amount); if (this.failTransfer) throw new Error('Synthetic ambiguous transfer');
    this.lastTransfer = { id: 'synthetic-transfer', status: 'PROCESSING', request_id: p.request_id, amount: minor(p.transfer_amount), currency: p.transfer_currency, fee_amount: 0n, fee_currency: 'EUR' };
    return structuredClone(this.lastTransfer);
  }
  async getTransfer(): Promise<TransferResult> { if (!this.lastTransfer) throw new Error('Missing mock transfer'); return structuredClone(this.lastTransfer); }
  async getConversion(): Promise<ConversionResult> { if (!this.lastConversion) throw new Error('Missing mock conversion'); return structuredClone(this.lastConversion); }
}

const hero='The $4,000 customer payment expected Thursday has been delayed until Monday.';
async function setup(fn:(s:DemoService,a:MockAdapter,t:(s:string)=>void,dir:string)=>Promise<void>){
  const dir=mkdtempSync(join(tmpdir(),'duegate-ui-')),a=new MockAdapter();let now='2026-10-04T15:00:00.000Z';
  try{await fn(new DemoService(a,dir,()=>now),a,s=>{now=s;},dir);}finally{const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep+'duegate-ui-'));rmSync(target,{recursive:true});}
}
const zero=(a:MockAdapter)=>{assert.equal(a.conversions,0);assert.equal(a.transfers,0);};
test('UI: authorized synthetic dates persist across preview refresh and restart',()=>setup(async(s,a,time,dir)=>{
  const schedule={event:'SYNTHETIC_PAYABLE_RESCHEDULED',synthetic_demo_only:true,payable_id:'duegate-demo-dg001-sandbox-001',new_due_at:'2026-10-04T23:00:00.000Z',new_latest_safe_execution_at:'2026-10-04T21:00:00.000Z'};
  writeFileSync(join(dir,'synthetic-reschedule.json'),JSON.stringify(schedule));
  let v=await s.action('funded');assert.equal(v.cutoff,schedule.new_latest_safe_execution_at);assert.equal(v.due,schedule.new_due_at);assert.equal(v.amount,'1.00');assert.equal(v.treasury.reserve,'100.00');
  time('2026-10-04T15:01:00.000Z');v=await s.action('funded');assert.equal(v.cutoff,schedule.new_latest_safe_execution_at);
  const restarted=new DemoService(a,dir,()=> '2026-10-04T15:02:00.000Z');assert.equal((await restarted.action('funded')).due,schedule.new_due_at);zero(a);
}));
test('UI: real balance mapping reflects engine WAIT',()=>setup(async(s,a)=>{const v=await s.action('open');assert.equal(v.treasury.balance,'10000000.00');assert.equal(v.decision,'WAIT');assert.match(renderCase(v),/AWAIT_CONFIRMED_INFLOW/);assert.equal(a.quotes,0);zero(a);}));
test('UI: WAIT refuses execution even by direct request',()=>setup(async(s,a)=>{await s.action('open');const v=await s.action('execute',{confirm:'fake'});assert.equal(v.canExecute,false);zero(a);}));
test('UI: hero DATE facts display without invented exact arrival',()=>setup(async(s)=>{await s.action('open');const v=await s.action('interpret',{text:hero});assert.equal(v.facts?.classification,'DELAYED');assert.equal(v.facts?.precision,'DATE');assert.equal(v.facts?.date,'2026-10-12');assert.equal(v.facts?.exact,null);assert.match(renderCase(v),/No exact arrival time was inferred/);}));
test('UI: applied hero changes WAIT to ESCALATE with zero writes',()=>setup(async(s,a)=>{await s.action('open');await s.action('interpret',{text:hero});const v=await s.action('apply');assert.equal(v.transition,'WAIT → ESCALATE');assert.equal(v.decision,'ESCALATE');assert.equal(v.financialWrites,0);await s.action('execute');zero(a);}));
test('UI: funded preview requires valid fresh quote and shows EUR 1',()=>setup(async(s,a)=>{const v=await s.action('funded');assert.equal(v.decision,'EXECUTE');assert.equal(v.canExecute,false);assert.equal(v.canApprove,true);assert.equal(v.amount,'1.00');assert.ok(v.preview);assert.equal(a.quotes,1);zero(a);}));
test('UI: quote expiry disables execution on server and rendered button',()=>setup(async(s,a,time)=>{await s.action('funded');time(a.quote.expires_at);assert.equal(s.view().canExecute,false);assert.match(renderCase(s.view()),/data-action="execute" disabled/);await s.action('execute');zero(a);}));
test('UI: excessive quote never permits execution',()=>setup(async(s,a)=>{a.quote.source_amount=160n;const v=await s.action('funded');assert.equal(v.decision,'ESCALATE');assert.equal(v.canExecute,false);zero(a);}));
test('UI: incorrect confirmation cannot create claim',()=>setup(async(s,a)=>{await s.action('funded');const v=await s.action('execute',{confirm:'incorrect'});assert.equal(v.executionState,'MISSING');zero(a);}));
test('UI: mock execution uses controller and duplicate remains blocked after restart',()=>setup(async(s,a,_t,dir)=>{const p=await s.action('funded');await s.action('approve',{fingerprint:p.approval!.execution_fingerprint});const v=await s.action('execute',{confirm:p.preview?.digest});assert.equal(v.error,null);assert.equal(v.result?.transferStatus,'PROCESSING');assert.equal(v.decision,'BLOCK_DUPLICATE');assert.match(renderCase(v),/data-action="execute" disabled/);assert.equal(a.conversions,1);assert.equal(a.transfers,1);const quotes=a.quotes;const restarted=new DemoService(a,dir,()=> '2026-10-04T15:00:00.000Z');await restarted.action('funded');await restarted.action('execute');assert.equal(a.quotes,quotes);assert.equal(a.transfers,1);assert.equal(a.conversions,1);}));
test('UI: provider errors cannot leak secrets into output or audit',()=>setup(async(s,a)=>{a.getWalletBalances=async()=>{throw new Error('SECRET_SYNTHETIC_TOKEN <script>');};const v=await s.action('open');assert.ok(v.error);assert.equal(v.canExecute,false);assert.doesNotMatch(JSON.stringify(v),/SECRET_SYNTHETIC_TOKEN/);assert.doesNotMatch(renderCase(v),/<script>/);}));
test('UI: rendered dynamic content is escaped',()=>setup(async(s)=>{const v=await s.action('open');v.error='<img src=x onerror=alert(1)>';assert.doesNotMatch(renderCase(v),/<img/);assert.match(renderCase(v),/&lt;img/);}));
test('UI: page load and interpretation have no quote or financial calls',()=>setup(async(s,a)=>{s.view();await s.action('open');await s.action('interpret',{text:hero});assert.equal(a.quotes,0);zero(a);}));



