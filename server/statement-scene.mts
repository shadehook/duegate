import {readFileSync} from 'node:fs';
import {parseStatements,checkStatements,statementFingerprint} from '../src/financial-statement-context.mts';
import type {FinancialStatementContext,StatementSnapshot} from '../src/financial-statement-context.mts';
import type {StatementScene} from '../web/types.mts';
import {major} from '../src/airwallex-adapter.mts';

// Separate synthetic approval, pinned independently of the re-read fixture. No EUR claim.
const approved:StatementSnapshot={
  entityRef:'sha256:6a964dffd1c2485aa75c544d48cb69eadb10b2a18906c902ffd6c5b7b4eb55e8',
  reportCurrency:'USD',periodStart:'2026-10-01',periodEnd:'2026-10-30',
  accountingCashMinor:'21644433',netCashChangeMinor:'-1755443'
};
const money=(n:bigint|undefined)=>n===undefined?null:(n<0n?'-':'')+major(n<0n?-n:n);
export function recordedStatementScene(path:string):StatementScene {
  let c:FinancialStatementContext|null=null;
  try {
    const f=JSON.parse(readFileSync(path,'utf8'));
    c=parseStatements(f.balanceSheet,f.cashFlow,f,f.entityRef,f.capturedAt);
  }catch{/* Offline evidence unavailable: display INCOMPLETE, never a successful baseline. */}
  return {mode:'recorded',periodStart:c?.periodStart??null,periodEnd:c?.periodEnd??null,capturedAt:c?.capturedAt??null,
    currency:c?.reportCurrency??null,cash:money(c?.balanceSheet.accountingCashMinor),net:money(c?.cashFlow.netCashChangeMinor),
    fingerprint:statementFingerprint(approved),sourceRefs:c?.sourceRefs??[],
    initial:checkStatements(approved,c,'2026-10-30'),later:checkStatements(approved,c,'2026-10-31')};
}
