import {createHash} from 'node:crypto';
import {BALANCE_SHEET,CASH_FLOW,parseStatements,StatementVeto,validPeriod} from './financial-statement-context.mts';
import type {StatementReader} from './financial-statement-context.mts';

/** Key is scoped to one entity; explicitly pin that entity on both fixed GETs. */
export function t0StatementReader(key:string|undefined,entity:string|undefined,request=fetch):StatementReader {
  return async period=>{
    if(!key||!entity||!validPeriod(period))throw new StatementVeto();
    async function get(path:typeof BALANCE_SHEET|typeof CASH_FLOW){
      const url=new URL(path,'https://api.t0.ai');
      url.search=new URLSearchParams({start_date:period.periodStart,end_date:period.periodEnd,period_type:'monthly',entity:entity!}).toString();
      const r=await request(url,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store'});
      if(r.status!==200||!r.headers.get('content-type')?.includes('application/json'))throw new StatementVeto();
      // Do not silently round an atom (including a fractional token rounded to an integer by JSON.parse).
      return JSON.parse(await r.text(),((_k:string,v:unknown,ctx?:{source?:string})=>{
        if(typeof v==='number'&&(!Number.isSafeInteger(v)||!/^(-?0|-?[1-9]\d*)$/.test(ctx?.source??'')))throw new StatementVeto();
        return v;
      }));
    }
    try{
      const bs=await get(BALANCE_SHEET), cf=await get(CASH_FLOW);
      return parseStatements(bs,cf,period,'sha256:'+createHash('sha256').update(entity).digest('hex'),new Date().toISOString());
    }catch{throw new StatementVeto();} // No raw response, entity, URL, or credential in errors.
  };
}
