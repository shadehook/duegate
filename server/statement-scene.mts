import {readFileSync} from 'node:fs';
import {parseStatements,checkStatements,statementSnapshot,StatementVeto} from '../src/financial-statement-context.mts';
import type {FinancialStatementContext,StatementSnapshot} from '../src/financial-statement-context.mts';
import type {StatementScene} from '../web/types.mts';
import {approvalManifest,manifestFingerprint} from '../src/approval-context.mts';
import type {DecisionInput} from '../src/decision-engine.mts';
import type {QuotedFx} from '../src/airwallex-adapter.mts';
import {major} from '../src/airwallex-adapter.mts';

// Separate synthetic approval, pinned independently of the re-read fixture. No EUR claim.
const approved:StatementSnapshot={
  policy:{accountingCash:{policy:'MUST_EQUAL'},netCashChange:{policy:'MUST_EQUAL'}},
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
  // Deliberately synthetic material-change example; never represented as a new T:0 observation.
  let materialChange:StatementScene['materialChange'];let fingerprint='Unavailable';
  if(c){
    const baseline=structuredClone(c);baseline.balanceSheet.accountingCashMinor=31000000n;
    const selected=statementSnapshot(baseline,{accountingCash:{policy:'MINIMUM',threshold:'25000000'},netCashChange:{policy:'MUST_EQUAL'}});
    const current=structuredClone(baseline);current.balanceSheet.accountingCashMinor=21800000n;
    const check=checkStatements(selected,current,'2026-10-30');
    if(check.result==='FINANCIAL_CONTEXT_CHANGED')materialChange=new StatementVeto(check.result,check.changedFields).evidence(0);
    const quote:QuotedFx={quote_id:'synthetic-claim-scene',source_currency:'USD',target_currency:'EUR',source_amount:112n,target_amount:100n,source_fee_amount:0n,expires_at:'2026-10-30T12:15:00.000Z',valid_from_at:'2026-10-30T12:00:00.000Z',conversion_date:'2026-10-30',rate:'1.12',currency_pair:'EURUSD',usage:'SINGLE_USE'};
    const input:DecisionInput={payable:{payable_id:'synthetic-claim-example',supplier_id:'synthetic-supplier',beneficiary_id:'synthetic-de-eur',amount:100n,currency:'EUR',due_at:'2026-10-30T20:00:00.000Z',latest_safe_execution_at:'2026-10-30T16:00:00.000Z',status:'open'},
      treasury:{source_currency:'USD',wallet_balance:100000n,fixed_reserve:10000n,committed_amount:0n,expected_inflow_id:null,expected_inflow_amount:0n,expected_inflow_eta:null,expected_inflow_status:'none'},
      funding:{source_currency:'USD',required_amount:200n},fx_policy:{source_currency:'USD',target_currency:'EUR',max_acceptable_rate:{numerator:150n,denominator:100n},quote_expiry:quote.expires_at},quote,execution:{state:'no_execution',transfer_id:null},now:'2026-10-30T12:00:00.000Z'};
    fingerprint=manifestFingerprint(approvalManifest({input,quote,statement:selected}));
  }
  return {mode:'recorded',periodStart:c?.periodStart??null,periodEnd:c?.periodEnd??null,capturedAt:c?.capturedAt??null,
    currency:c?.reportCurrency??null,cash:money(c?.balanceSheet.accountingCashMinor),net:money(c?.cashFlow.netCashChangeMinor),
    fingerprint,materialChange,sourceRefs:c?.sourceRefs??[],
    initial:checkStatements(approved,c,'2026-10-30'),later:checkStatements(approved,c,'2026-10-31')};
}
