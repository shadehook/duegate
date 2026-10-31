import test from 'node:test';
import assert from 'node:assert/strict';
import {T0AccountingAdapter,T0ReadError} from '../src/t0-accounting-adapter.mts';
import {AccountingError,evaluateAccountingCheck} from '../src/accounting-context.mts';
const binding={entityId:'synthetic-entity',recordId:'synthetic-bill',expectedAmountMinor:499813n,expectedCurrency:'USD' as const};
const key='synthetic-test-credential';const clock=()=> '2026-10-31T02:00:00.000Z';
const bill=()=>({id:{dataType:'VendorBill',externalId:binding.recordId},data:{total:4998.13,currencyCode:'USD',status:'paid',dueDate:'2026-10-20',paidDate:'2026-10-26'},links:[{dataType:'Vendor',externalId:'synthetic-vendor'}]});
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
function setup(change?:(path:string)=>Response|undefined){
 const requests:{url:string;method:string;redirect:string}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input),u=new URL(url);requests.push({url,method:init?.method??'',redirect:init?.redirect??''});
  assert.equal(u.origin,'https://api.t0.ai');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+key);
  const customized=change?.(u.pathname);if(customized)return customized;
  if(u.pathname==='/v1/entities')return json({data:[{external_id:binding.entityId}]});
  if(u.pathname==='/v1/vendor-bills/'+binding.recordId)return json(bill());
  if(u.pathname==='/v1/vendors/synthetic-vendor')return json({id:{dataType:'Vendor',externalId:'synthetic-vendor'},data:{name:key,email:'not-retained@example.invalid'}});
  throw new Error('UNEXPECTED_REQUEST');
 };
 return {adapter:new T0AccountingAdapter({apiKey:key,binding,fetch:fetcher,clock}),requests};
}
const isCode=(code:string)=>(e:unknown)=>(e instanceof T0ReadError||e instanceof AccountingError)&&e.code===code;
test('T0: exact entity, bill and linked vendor GETs yield validated facts and engine block',async()=>{
 const {adapter,requests}=setup();const c=await adapter.loadBill();assert.equal(c.amountMinor,499813n);assert.equal(c.sourceAsOf,null);assert.equal(c.vendorId,'synthetic-vendor');
 assert.equal(evaluateAccountingCheck(c,binding,'live').decision,'BLOCK_DUPLICATE');assert.equal(requests.length,3);assert.ok(requests.every(r=>r.method==='GET'&&r.redirect==='error'));
});
test('T0: no public generic URL method, write method, credential or financial capability',()=>{
 const {adapter}=setup();assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort(),['constructor','loadBill']);assert.deepEqual(Object.keys(adapter),[]);assert.equal(JSON.stringify(adapter),'{}');
});
test('T0: configuration cannot redirect a request to another host',()=>assert.throws(()=>new T0AccountingAdapter({apiKey:key,binding:{...binding,recordId:'https://other.invalid/?secret'},clock}),isCode('INVALID_IDENTITY')));
test('T0: credential is required without retaining it in errors',()=>{for(const apiKey of [undefined,'','bad\nheader'])assert.throws(()=>new T0AccountingAdapter({apiKey,binding}),isCode('T0_NOT_CONFIGURED'));});
for(const [status,code] of [[401,'T0_AUTH_FAILED'],[403,'T0_ACCESS_DENIED'],[404,'T0_RECORD_NOT_FOUND'],[409,'T0_READ_FAILED'],[429,'T0_READ_FAILED'],[500,'T0_READ_FAILED']] as const)test('T0: HTTP '+status+' fails safely without retry',async()=>{
 const {adapter,requests}=setup(()=>json({error:key},status));await assert.rejects(adapter.loadBill(),isCode(code));assert.equal(requests.length,1);
});
test('T0: cross-entity mismatch stops before bill lookup',async()=>{
 const {adapter,requests}=setup(p=>p==='/v1/entities'?json({data:[{external_id:'other'}]}):undefined);await assert.rejects(adapter.loadBill(),isCode('T0_ENTITY_MISMATCH'));assert.equal(requests.length,1);
});
test('T0: missing configured bill stops before vendor lookup',async()=>{
 const {adapter,requests}=setup(p=>p.includes('vendor-bills')?json({error:key},404):undefined);await assert.rejects(adapter.loadBill(),isCode('T0_RECORD_NOT_FOUND'));assert.equal(requests.length,2);
});
test('T0: multiple entities cannot be silently selected',async()=>{
 const {adapter,requests}=setup(p=>p==='/v1/entities'?json({data:[{external_id:binding.entityId},{external_id:'other'}]}):undefined);await assert.rejects(adapter.loadBill(),isCode('T0_ENTITY_MISMATCH'));assert.equal(requests.length,1);
});
for(const change of [{externalId:'other'},{dataType:'Payment'}])test('T0: returned bill identity/type must match '+JSON.stringify(change),async()=>{
 const b=bill();Object.assign(b.id,change);const {adapter}=setup(p=>p.includes('vendor-bills')?json(b):undefined);await assert.rejects(adapter.loadBill(),isCode('T0_RECORD_MISMATCH'));
});
test('T0: linked vendor identity must match',async()=>{
 const {adapter}=setup(p=>p.includes('/vendors/')?json({id:{externalId:'other',dataType:'Vendor'}}):undefined);await assert.rejects(adapter.loadBill(),isCode('T0_RECORD_MISMATCH'));
});
test('T0: ambiguous multiple vendor links are rejected',async()=>{
 const b=bill();b.links.push({dataType:'Vendor',externalId:'second'});const {adapter,requests}=setup(p=>p.includes('vendor-bills')?json(b):undefined);await assert.rejects(adapter.loadBill(),isCode('T0_RECORD_MISMATCH'));assert.equal(requests.length,2);
});
test('T0: bill with no vendor stays null, never infers a beneficiary',async()=>{
 const b=bill();b.links=[];const {adapter,requests}=setup(p=>p.includes('vendor-bills')?json(b):undefined);assert.equal((await adapter.loadBill()).vendorId,null);assert.equal(requests.length,2);
});
for(const total of ['4998.131','4998.1300000000000001','4.99813e3','-4998.13','null'])test('T0: raw amount token rejected without floating-point normalization '+total,async()=>{
 const body=JSON.stringify(bill()).replace('4998.13',total);const {adapter}=setup(p=>p.includes('vendor-bills')?new Response(body,{headers:{'content-type':'application/json'}}):undefined);await assert.rejects(adapter.loadBill(),isCode('INVALID_AMOUNT'));
});
test('T0: different amount cannot be mistaken for the configured obligation',async()=>{
 const b=bill();b.data.total=1;const {adapter}=setup(p=>p.includes('vendor-bills')?json(b):undefined);await assert.rejects(adapter.loadBill(),isCode('OBLIGATION_MISMATCH'));
});
for(const [field,value,code] of [['status','PAID','UNSUPPORTED_STATUS'],['currencyCode','EUR','INVALID_CURRENCY'],['dueDate','2026-02-30','INVALID_DATE']] as const)test('T0: invalid bill '+field+' rejected',async()=>{
 const b=bill();b.data[field]=value;const {adapter}=setup(p=>p.includes('vendor-bills')?json(b):undefined);await assert.rejects(adapter.loadBill(),isCode(code));
});
test('T0: open bill never authorizes execution',async()=>{
 const b=bill();b.data.status='open';const {adapter}=setup(p=>p.includes('vendor-bills')?json(b):undefined);const result=evaluateAccountingCheck(await adapter.loadBill(),binding,'live');assert.equal(result.decision,'NOT_EVALUATED');assert.equal(result.canExecute,false);
});
for(const kind of ['html','json','shape','oversize'])test('T0: malformed response '+kind+' stops safely',async()=>{
 const {adapter,requests}=setup(()=>kind==='html'?new Response(key,{headers:{'content-type':'text/html'}}):kind==='json'?new Response('{'+key,{headers:{'content-type':'application/json'}}):kind==='shape'?json({data:null}):json({data:'x'.repeat(262145)}));
 await assert.rejects(adapter.loadBill(),isCode('T0_MALFORMED_RESPONSE'));assert.equal(requests.length,1);
});
test('T0: timeout aborts, does not retry, and never prints transport details',async()=>{
 let calls=0,signal:AbortSignal|undefined;const fetcher:typeof fetch=async(_input,init)=>{calls++;signal=init?.signal??undefined;return new Promise(()=>{});};
 const adapter=new T0AccountingAdapter({apiKey:key,binding,fetch:fetcher,timeoutMs:5});await assert.rejects(adapter.loadBill(),isCode('T0_TIMEOUT'));assert.equal(calls,1);assert.equal(signal?.aborted,true);
});
test('T0: body-read timeout is bounded too',async()=>{
 const fetcher:typeof fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),{headers:{'content-type':'application/json'}});
 const adapter=new T0AccountingAdapter({apiKey:key,binding,fetch:fetcher,timeoutMs:5});await assert.rejects(adapter.loadBill(),isCode('T0_TIMEOUT'));
});
test('T0: credential/provider prose never enter output, logs or safe errors',async t=>{
 const logs:unknown[]=[];t.mock.method(console,'log',(...x:unknown[])=>{logs.push(x);});t.mock.method(console,'error',(...x:unknown[])=>{logs.push(x);});
 const {adapter}=setup(p=>p.includes('vendor-bills')?json({...bill(),transfer_id:key,wallet_balance:999999999,customFields:{secret:key}}):undefined);
 const result=evaluateAccountingCheck(await adapter.loadBill(),binding,'live');assert.ok(!JSON.stringify(result).includes(key));assert.ok(!('transfer_id'in result));assert.ok(!('wallet_balance'in result));assert.equal(logs.length,0);
 const failing=new T0AccountingAdapter({apiKey:key,binding,fetch:async()=>{throw new Error('Authorization: Bearer '+key);}});
 await assert.rejects(failing.loadBill(),e=>{assert.ok(!String(e).includes(key));assert.equal((e as Error).cause,undefined);return isCode('T0_READ_FAILED')(e);});assert.equal(logs.length,0);
});
