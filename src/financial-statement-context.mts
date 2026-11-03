import {createHash} from 'node:crypto';

export const BALANCE_SHEET = '/v1/reports/balance-sheet';
export const CASH_FLOW = '/v1/reports/cash-flow';
export interface Period {periodStart:string; periodEnd:string}
export interface FinancialStatementContext extends Period {
  source:'t0'; entityRef:string; reportCurrency:'USD'; capturedAt:string;
  balanceSheet:{accountingCashMinor?:bigint; totalAssetsMinor?:bigint; totalLiabilitiesMinor?:bigint};
  cashFlow:{netCashChangeMinor?:bigint; operatingCashFlowMinor?:bigint};
  sourceRefs:readonly [typeof BALANCE_SHEET,typeof CASH_FLOW];
}
export interface StatementSnapshot extends Period {
  entityRef:string; reportCurrency:'USD'; accountingCashMinor:string; netCashChangeMinor:string;
}
export type StatementFailure='FINANCIAL_CONTEXT_CHANGED'|'FINANCIAL_CONTEXT_INCOMPLETE'|'FINANCIAL_CONTEXT_OUT_OF_PERIOD';
export class StatementVeto extends Error {
  readonly reason:StatementFailure;
  constructor(reason:StatementFailure='FINANCIAL_CONTEXT_INCOMPLETE'){super(reason);this.reason=reason;}
}
const invalid=():never=>{throw new StatementVeto();};
const date=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&
  Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function validPeriod(p:Period){return date(p.periodStart)&&date(p.periodEnd)&&p.periodStart<=p.periodEnd&&p.periodStart.slice(0,7)===p.periodEnd.slice(0,7);}
const covers=(p:Period,d:string)=>date(d)&&p.periodStart<=d&&d<=p.periodEnd;
const captureTime=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:invalid();
const list=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.map(object):invalid();
const one=(items:Record<string,unknown>[],key:string,value:string,optional=false)=>{
  const found=items.filter(x=>x[key]===value);
  if(found.length>1||(!optional&&!found.length))invalid();
  return found[0];
};
const cell=(row:Record<string,unknown>|undefined,column:string):bigint|undefined=>{
  if(!row)return undefined;
  const n=object(row.balances)[column];
  if(n==null)return undefined;
  return typeof n==='number'&&Number.isSafeInteger(n)?BigInt(n):invalid();
};
export function parseStatements(balanceSheet:unknown,cashFlow:unknown,period:Period,entityRef:string,capturedAt:string):FinancialStatementContext {
  if(!validPeriod(period)||!/^sha256:[a-f0-9]{64}$/.test(entityRef)||!captureTime(capturedAt))invalid();
  function unpack(raw:unknown){
    const r=object(raw), periods=list(r.periods), p=periods[0];
    if(r.reporting_currency!=='USD'||r.amount_unit!=='atoms'||r.atoms_per_unit!==100||periods.length!==1||
       p.start_date!==period.periodStart||p.end_date!==period.periodEnd||typeof p.id!=='string'||p.id!==period.periodStart.slice(0,7))invalid();
    return {sections:list(r.sections),id:p.id as string};
  }
  const bs=unpack(balanceSheet),cf=unpack(cashFlow);
  const asset=one(bs.sections,'account_type','asset'),bank=one(list(asset.children),'account_id','type_group_bank');
  const net=one(cf.sections,'key','net_change');
  if(bank.account_kind!=='type_group'||net.is_subtotal!==true)invalid();
  return {source:'t0',entityRef,reportCurrency:'USD',periodStart:period.periodStart,periodEnd:period.periodEnd,capturedAt,
    balanceSheet:{accountingCashMinor:cell(bank,bs.id),totalAssetsMinor:cell(asset,bs.id),totalLiabilitiesMinor:cell(one(bs.sections,'account_type','liability',true),bs.id)},
    cashFlow:{netCashChangeMinor:cell(net,cf.id),operatingCashFlowMinor:cell(one(cf.sections,'key','operating',true),cf.id)},sourceRefs:[BALANCE_SHEET,CASH_FLOW]};
}
// Exact equality, in atoms. Optional totals and local capture time are evidence, not protected assumptions.
export function statementSnapshot(c:FinancialStatementContext):StatementSnapshot {
  if(c.source!=='t0'||!validPeriod(c)||!captureTime(c.capturedAt)||c.reportCurrency!=='USD'||!/^sha256:[a-f0-9]{64}$/.test(c.entityRef)||
     c.sourceRefs?.length!==2||c.sourceRefs[0]!==BALANCE_SHEET||c.sourceRefs[1]!==CASH_FLOW||
     typeof c.balanceSheet.accountingCashMinor!=='bigint'||typeof c.cashFlow.netCashChangeMinor!=='bigint')throw new StatementVeto();
  return {entityRef:c.entityRef,reportCurrency:c.reportCurrency,periodStart:c.periodStart,periodEnd:c.periodEnd,
    accountingCashMinor:c.balanceSheet.accountingCashMinor.toString(),netCashChangeMinor:c.cashFlow.netCashChangeMinor.toString()};
}
export function statementFingerprint(s:StatementSnapshot):string {
  return createHash('sha256').update(JSON.stringify(['t0-statement-v1',s.entityRef,s.reportCurrency,s.periodStart,s.periodEnd,s.accountingCashMinor,s.netCashChangeMinor])).digest('hex');
}
export function checkStatements(approved:StatementSnapshot,current:FinancialStatementContext|null,decisionDate:string){
  let reason:StatementFailure|'FINANCIAL_CONTEXT_OK'='FINANCIAL_CONTEXT_INCOMPLETE';
  let coversDecisionDate:boolean|null=null;
  try {
    if(!date(decisionDate)||!current)throw new StatementVeto();
    const snapshot=statementSnapshot(current);
    coversDecisionDate=covers(current,decisionDate);
    if(!coversDecisionDate)reason='FINANCIAL_CONTEXT_OUT_OF_PERIOD';
    else reason=statementFingerprint(approved)===statementFingerprint(snapshot)?'FINANCIAL_CONTEXT_OK':'FINANCIAL_CONTEXT_CHANGED';
  }catch{/* Missing or malformed is never support. */}
  return {result:reason,decision:reason==='FINANCIAL_CONTEXT_OK'?null:'ESCALATE' as const,decisionDate,coversDecisionDate};
}
export type StatementReader=(period:Period)=>Promise<FinancialStatementContext>;
export async function requireStatements(reader:StatementReader|undefined,clock:()=>string,approved?:StatementSnapshot){
  try {
    if(!reader)throw new StatementVeto();
    const day=clock().slice(0,10);
    const period=approved?{periodStart:approved.periodStart,periodEnd:approved.periodEnd}:{periodStart:day.slice(0,7)+'-01',periodEnd:day};
    if(!validPeriod(period))throw new StatementVeto();
    if(!covers(period,day))throw new StatementVeto('FINANCIAL_CONTEXT_OUT_OF_PERIOD');
    const c=await reader(period), snapshot=statementSnapshot(c);
    if(c.periodStart!==period.periodStart||c.periodEnd!==period.periodEnd)throw new StatementVeto();
    const check=checkStatements(approved??snapshot,c,clock().slice(0,10));
    if(check.result!=='FINANCIAL_CONTEXT_OK')throw new StatementVeto(check.result);
    return {snapshot,evidence:{...c,decisionDate:check.decisionDate,coversDecisionDate:check.coversDecisionDate}};
  }catch(err){throw err instanceof StatementVeto?err:new StatementVeto();}
}
