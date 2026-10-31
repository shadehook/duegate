import {accountingId, accountingRefs, bindAccountingContext, usdMinor, validateAccountingBinding} from './accounting-context.mts';
import type {AccountingBinding, AccountingContext} from './accounting-context.mts';

export type T0ReadCode = 'T0_NOT_CONFIGURED' | 'T0_AUTH_FAILED' | 'T0_ACCESS_DENIED' | 'T0_RECORD_NOT_FOUND'
  | 'T0_READ_FAILED' | 'T0_TIMEOUT' | 'T0_MALFORMED_RESPONSE' | 'T0_ENTITY_MISMATCH' | 'T0_RECORD_MISMATCH';
export class T0ReadError extends Error {
  readonly code: T0ReadCode;
  constructor(code:T0ReadCode) { super(code); this.name='T0ReadError'; this.code=code; }
}
const fail=(code:T0ReadCode):never=>{throw new T0ReadError(code);};
const object=(x:unknown):Record<string,unknown>=>{
  if(!x||typeof x!=='object'||Array.isArray(x))return fail('T0_MALFORMED_RESPONSE');
  return x as Record<string,unknown>;
};
const array=(x:unknown):unknown[]=>{if(!Array.isArray(x))return fail('T0_MALFORMED_RESPONSE');return x;};
type ReadPath='/v1/entities'|`/v1/vendor-bills/${string}`|`/v1/vendors/${string}`;
/** Server-only client. Three concrete GET routes; no browsing, write or arbitrary URL API. */
export class T0AccountingAdapter {
  #key:string; #binding:AccountingBinding; #fetch:typeof fetch; #clock:()=>string; #timeoutMs:number;
  constructor(options:{apiKey:string|undefined;binding:AccountingBinding;fetch?:typeof fetch;clock?:()=>string;timeoutMs?:number}) {
    const apiKey=options.apiKey;
    if(typeof apiKey!=='string'||apiKey.length===0||apiKey.trim()!==apiKey||/[\r\n\x00-\x1f]/.test(apiKey))throw new T0ReadError('T0_NOT_CONFIGURED');
    this.#key=apiKey;
    this.#binding=validateAccountingBinding(options.binding);
    this.#fetch=options.fetch??globalThis.fetch;this.#clock=options.clock??(()=>new Date().toISOString());this.#timeoutMs=options.timeoutMs??10000;
    if(!Number.isInteger(this.#timeoutMs)||this.#timeoutMs<1||this.#timeoutMs>20000)fail('T0_NOT_CONFIGURED');
  }
  async #get(path:ReadPath):Promise<unknown> {
    if(!/^\/v1\/(?:entities|(?:vendor-bills|vendors)\/[A-Za-z0-9_.%~-]+)$/.test(path))return fail('T0_READ_FAILED');
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const timed=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new T0ReadError('T0_TIMEOUT'));},this.#timeoutMs);});
    try {
      const operation=async()=>{
        const response=await this.#fetch('https://api.t0.ai'+path,{method:'GET',headers:{Authorization:'Bearer '+this.#key,Accept:'application/json'},redirect:'error',signal:abort.signal});
        if(response.status===401) return fail('T0_AUTH_FAILED');
        if(response.status===403) return fail('T0_ACCESS_DENIED');
        if(response.status===404) return fail('T0_RECORD_NOT_FOUND');
        if(response.status!==200||response.redirected)return fail('T0_READ_FAILED');
        if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))return fail('T0_MALFORMED_RESPONSE');
        if(!response.body)return fail('T0_MALFORMED_RESPONSE');
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
        const cancel=()=>{void reader.cancel().catch(()=>{});};
        abort.signal.addEventListener('abort',cancel,{once:true});
        try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return fail('T0_MALFORMED_RESPONSE');}chunks.push(value);}}
        finally {abort.signal.removeEventListener('abort',cancel);reader.releaseLock();}
        const text=Buffer.concat(chunks).toString('utf8');
        try {
          // Node 24 supplies source tokens. Preserve decimal precision BEFORE binary
          // floating-point rounding; a malformed total must never become valid money.
          return JSON.parse(text,(key,value,context?:{source?:string})=>{
            if(key==='total'&&typeof value==='number') {
              if(!context?.source)return fail('T0_MALFORMED_RESPONSE');
              return context.source;
            }
            return value;
          });
        } catch {return fail('T0_MALFORMED_RESPONSE');}
      };
      return await Promise.race([operation(),timed]);
    } catch(error) {
      if(error instanceof T0ReadError)throw error;
      return fail(abort.signal.aborted?'T0_TIMEOUT':'T0_READ_FAILED');
    } finally {clearTimeout(timer);abort.abort();}
  }
  async loadBill():Promise<AccountingContext> {
    const entities=object(await this.#get('/v1/entities'));
    // API-key access is entity-scoped; this route is not paginated. Fail rather
    // than selecting the first entity if the provider contract changes.
    const items=array(entities.data);
    if(items.length!==1||object(items[0]).external_id!==this.#binding.entityId)return fail('T0_ENTITY_MISMATCH');
    const bill=object(await this.#get(`/v1/vendor-bills/${encodeURIComponent(this.#binding.recordId)}`));
    const id=object(bill.id),data=object(bill.data);
    if(id.dataType!=='VendorBill'||id.externalId!==this.#binding.recordId)return fail('T0_RECORD_MISMATCH');
    const links=array(bill.links).map(object).filter(link=>link.dataType==='Vendor');
    if(links.length>1)return fail('T0_RECORD_MISMATCH');
    const vendorId=links.length?accountingId(links[0].externalId):null;
    if(vendorId!==null){
      const vendor=object(await this.#get(`/v1/vendors/${encodeURIComponent(vendorId)}`)),vendorIdentity=object(vendor.id);
      if(vendorIdentity.dataType!=='Vendor'||vendorIdentity.externalId!==vendorId)return fail('T0_RECORD_MISMATCH');
      // Names, emails, custom fields and payment details are intentionally discarded.
    }
    return bindAccountingContext({source:'t0',entityId:this.#binding.entityId,recordType:'VendorBill',recordId:this.#binding.recordId,vendorId,
      amountMinor:usdMinor(data.total),currency:data.currencyCode,status:data.status,dueDate:data.dueDate??null,paidDate:data.paidDate??null,
      sourceAsOf:null,capturedAt:this.#clock(),sourceRefs:accountingRefs(this.#binding.entityId,this.#binding.recordId,vendorId)},this.#binding);
  }
}
