import {safeDiagnostic} from '../src/funding-diagnostics.mts';
import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {decide,logicalExecutionKey} from '../src/decision-engine.mts';
import type {DecisionInput} from '../src/decision-engine.mts';
import type {AirwallexAdapter,WalletBalance} from '../src/airwallex-adapter.mts';
import {major} from '../src/airwallex-adapter.mts';
import {ExecutionController,digest,deserialize,serialize} from '../src/execution-controller.mts';
import type {Evaluation,PreparedExecution} from '../src/execution-controller.mts';
import {ExecutionLedger} from '../src/execution-ledger.mts';
import type {InterpretationAdapter} from '../src/claude-funding-interpreter.mts';
import {REVIEW_MESSAGE} from '../src/claude-funding-interpreter.mts';
import {validateCandidate,wireCandidate,deterministicFundingV2,applyFundingV2} from '../src/funding-v2.mts';
import type {FundingUpdateV2} from '../src/funding-v2.mts';
import type {CaseView} from '../web/types.mts';
import {ApprovalStore,intentFingerprint} from '../src/approval-store.mts';
import {safeAuditExport} from '../src/audit-export.mts';
import {StatementVeto} from '../src/financial-statement-context.mts';
import type {StatementReader,StatementFailure} from '../src/financial-statement-context.mts';

export const SANDBOX_PAYABLE='duegate-demo-dg001-sandbox-001';
const DEMO_BENEFICIARY='synthetic-german-eur-beneficiary';
const STORY_CLOCK='2026-10-07T12:00:00.000Z',TIMEZONE='America/New_York';
const money=(n:bigint)=>n<0n?'-'+major(-n):major(n);
export const FINAL_PAYABLE='duegate-shortlist-final-eur001-v1';
export class DemoService {
  private claudeStory:boolean;private interpretation:InterpretationAdapter;private beneficiaryId:string;private payableId:string;private finalProof:boolean;private writesEnabled:boolean;
  private adapter:AirwallexAdapter;private ledger:ExecutionLedger;private controller:ExecutionController;
  private dir:string;private clock:()=>string;private input:DecisionInput|null=null;private mode:'dry'|'sandbox'='dry';
  private connected=false;private asOf:string|null=null;private error:string|null=null;private facts:FundingUpdateV2|null=null;private raw:string|null=null;
  private evaluation:Evaluation|null=null;private approvedDigest:string|null=null;private transition:string|null=null;private review=false;private busy=false;
  private receipts:string[]=[];private events:CaseView['audit']=[];private result:CaseView['result']=null;
  private writes=0;private conversions=0;private transfers=0;
  private approvals:ApprovalStore;
  private statementFailure:StatementFailure|null=null;
  constructor(adapter:AirwallexAdapter,directory:string,clock=()=>new Date().toISOString(),options:{finalProof?:boolean;financialWritesEnabled?:boolean;beneficiaryId?:string;interpretation?:InterpretationAdapter;claudeStory?:boolean;statements?:StatementReader}={}){
    this.claudeStory=options.claudeStory===true;this.interpretation=options.interpretation??{interpreter:deterministicFundingV2,provider:'deterministic'};this.beneficiaryId=options.beneficiaryId??DEMO_BENEFICIARY;this.finalProof=options.finalProof===true;this.payableId=this.finalProof?FINAL_PAYABLE:SANDBOX_PAYABLE;this.writesEnabled=options.financialWritesEnabled??!this.finalProof;
    this.adapter=adapter;this.dir=directory;this.clock=clock;mkdirSync(directory,{recursive:true});
    this.ledger=new ExecutionLedger(join(directory,'ledger'));this.controller=new ExecutionController(adapter,this.ledger,clock,options.statements);
    this.approvals=new ApprovalStore(join(directory,'approvals'),clock);
    if(existsSync(join(directory,'audit.jsonl')))this.events=readFileSync(join(directory,'audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
    if(existsSync(join(directory,'result.json'))){this.result=JSON.parse(readFileSync(join(directory,'result.json'),'utf8'));this.writes=2;this.conversions=1;this.transfers=1;}
    if(this.finalProof&&existsSync(join(directory,'case-state.json'))){
      const saved=deserialize<{input:DecisionInput|null;mode:'dry'|'sandbox';receipts:string[]}>(readFileSync(join(directory,'case-state.json'),'utf8'));
      if(saved.input&&saved.input.payable.payable_id!==this.payableId)throw new Error('RESTORED_IDENTITY_MISMATCH');
      this.input=saved.input;this.mode=saved.mode;this.receipts=saved.receipts;
    }
    const approval=this.approvals.current(this.payableId);
    const lastStatement=this.events.filter(e=>e.event.startsWith('FINANCIAL_CONTEXT_')).at(-1)?.event;
    if(lastStatement==='FINANCIAL_CONTEXT_CHANGED'||lastStatement==='FINANCIAL_CONTEXT_INCOMPLETE'||lastStatement==='FINANCIAL_CONTEXT_OUT_OF_PERIOD')this.statementFailure=lastStatement;
    if(approval&&this.state()==='MISSING'&&['APPROVED','PENDING'].includes(approval.approval.status)&&
       Boolean(approval.evaluation.statement)!==Boolean(options.statements)){
      this.statementFailure='FINANCIAL_CONTEXT_INCOMPLETE';
      this.approvals.invalidate(this.payableId,this.statementFailure);
      this.audit(this.statementFailure,'Restored approval and statement policy do not match; new review required');
    }
    if(approval&&this.state()==='MISSING'){
      this.mode='sandbox';this.evaluation=approval.evaluation;this.input=structuredClone(approval.evaluation.input);this.asOf=this.input.now;
      this.approvedDigest=approval.approval.execution_fingerprint;
    }
  }
  private audit(event:string,detail:string,data?:unknown){const e={at:this.clock(),event,detail,...(data===undefined?{}:{data})};const fd=openSync(join(this.dir,'audit.jsonl'),'a');try{writeFileSync(fd,JSON.stringify(e,(_k,v)=>typeof v==='bigint'?v.toString():v)+'\n');fsyncSync(fd);}finally{closeSync(fd);}this.events.push(structuredClone(e));}
  private base(balance:bigint,live=false):DecisionInput{
    const now=live||this.finalProof?this.clock():STORY_CLOCK,at=(mins:number)=>new Date(Date.parse(now)+mins*60000).toISOString();
    const reserve=live||this.finalProof?10000n:2500000n,free=live?500n:this.finalProof?100n:800000n;
    if(balance<reserve+free)throw new Error('BALANCE_TOO_SMALL_FOR_SCENARIO');
    let due=this.claudeStory?'2026-10-09T20:00:00.000Z':at(120),cutoff=this.claudeStory?'2026-10-09T16:00:00.000Z':at(60);
    if(live&&existsSync(join(this.dir,'synthetic-reschedule.json'))){
      const schedule=JSON.parse(readFileSync(join(this.dir,'synthetic-reschedule.json'),'utf8'));
      if(schedule.payable_id!==this.payableId||schedule.event!=='SYNTHETIC_PAYABLE_RESCHEDULED'||!schedule.synthetic_demo_only||!Number.isFinite(Date.parse(schedule.new_due_at))||!Number.isFinite(Date.parse(schedule.new_latest_safe_execution_at))||Date.parse(schedule.new_due_at)<=Date.parse(schedule.new_latest_safe_execution_at))throw new Error('INVALID_SYNTHETIC_SCHEDULE');
      due=schedule.new_due_at;cutoff=schedule.new_latest_safe_execution_at;
    }
    if(this.finalProof){
      const path=join(this.dir,'final-case.json');
      if(!existsSync(path)){const schedule={payable_id:this.payableId,due_at:due,latest_safe_execution_at:cutoff,expected_inflow_eta:this.claudeStory?'2026-10-08T13:00:00.000Z':at(30)};const fd=openSync(path,'wx');try{writeFileSync(fd,JSON.stringify(schedule));fsyncSync(fd);}finally{closeSync(fd);}this.audit('SYNTHETIC_CASE_CREATED','One fixed EUR 1.00 final-proof payable; no execution authorized',{payable:schedule});}
      const fixed=JSON.parse(readFileSync(path,'utf8'));if(fixed.payable_id!==this.payableId)throw new Error('CASE_IDENTITY_MISMATCH');due=fixed.due_at;cutoff=fixed.latest_safe_execution_at;
    }
    return {payable:{payable_id:live||this.finalProof?this.payableId:'duegate-visual-dg001',supplier_id:'demo-supplier',beneficiary_id:this.beneficiaryId,amount:live||this.finalProof?100n:1000000n,currency:'EUR',
      due_at:live||this.finalProof?due:'2026-10-09T20:00:00.000Z',latest_safe_execution_at:live||this.finalProof?cutoff:'2026-10-09T16:00:00.000Z',status:'open'},
      treasury:{source_currency:'USD',wallet_balance:balance,fixed_reserve:reserve,committed_amount:balance-reserve-free,expected_inflow_id:'INFLOW-001',expected_inflow_amount:this.claudeStory?400000n:live||this.finalProof?200n:400000n,
        expected_inflow_eta:this.finalProof?JSON.parse(readFileSync(join(this.dir,'final-case.json'),'utf8')).expected_inflow_eta:live?at(30):'2026-10-08T13:00:00.000Z',expected_inflow_status:'confirmed'},
      funding:{source_currency:'USD',required_amount:live||this.finalProof?200n:1150000n},fx_policy:{source_currency:'USD',target_currency:'EUR',max_acceptable_rate:{numerator:150n,denominator:100n},quote_expiry:null},
      quote:null,execution:{state:'no_execution',transfer_id:null},now};
  }
  private one(rows:WalletBalance[],currency:string){const r=rows.filter(b=>b.currency===currency);if(r.length!==1)throw new Error('BALANCE_UNAVAILABLE');return r[0];}
  private known(){if(!this.input)throw new Error('CASE_NOT_LOADED');return [{id:'INFLOW-001',amount_minor:Number(this.input.treasury.expected_inflow_amount),currency:'USD',eta:this.input.treasury.expected_inflow_eta??'2026-10-08T13:00:00.000Z'}];}
  private state(){return this.ledger.continuationState(this.payableId);}
  /** All mutations serialize within this local process; ledger supplies durable cross-process exclusion. */
  async action(name:string,body:Record<string,unknown>={}):Promise<CaseView>{
    if(this.busy)throw new Error('OPERATION_IN_PROGRESS');this.busy=true;this.error=null;
    try{
      if(name==='open'){
        if(this.input)this.audit('STATE_RESTORED','Persisted exact approval/context re-evaluated after restart');
        if(!this.input){const rows=await this.adapter.getWalletBalances();this.asOf=this.clock();this.connected=true;this.input=this.base(this.one(rows,'USD').available);this.audit('PAYABLE_EVALUATED',this.finalProof?'EUR 1.00 final proof · real USD wallet snapshot':'EUR 10,000 visual case · NOT EXECUTED · real USD wallet snapshot',{input:this.input,decision:decide(this.input),parser_version:'funding-facts-v2'});this.audit('DECISION_'+decide(this.input).decision,decide(this.input).reason);}
      }else if(name==='interpret'){
        if(this.mode!=='dry'||!this.input||typeof body.text!=='string'||body.text.length>3000)throw new Error('INVALID_UPDATE');
        this.facts=null;this.raw=null;this.review=false;
        let result:FundingUpdateV2;
        const reference=this.finalProof?this.input.now:STORY_CLOCK;
        const providerLabel=this.interpretation.provider+(this.interpretation.model?' · '+this.interpretation.model:'');
        this.audit('INTERPRETATION_STARTED',providerLabel);
        const started=Date.now();
        try{const candidate=await this.interpretation.interpreter.interpret(body.text,this.known(),reference,TIMEZONE);result=validateCandidate(wireCandidate(candidate),body.text,this.known(),reference,TIMEZONE);}
        catch(error){this.review=true;this.error=REVIEW_MESSAGE;this.audit('INTERPRETATION_REVIEW_REQUIRED',providerLabel+' · validation failed · '+(Date.now()-started)+' ms',safeDiagnostic(error));return this.view();}
        this.audit('INTERPRETATION_COMPLETED',providerLabel+' · validated · '+(Date.now()-started)+' ms');
        if(result.classification==='AMBIGUOUS'){this.review=true;this.error=REVIEW_MESSAGE;}
        this.facts=result;this.raw=body.text;this.audit('FUNDING_UPDATE_RECEIVED','SHA-256 '+result.source_text_hash,{source_text_hash:result.source_text_hash,parser_version:result.parser_version});this.audit('FUNDING_FACTS_EXTRACTED',`${result.classification} · ${result.eta_precision} · ${result.expected_inflow_id??'unidentified'}`,result);
      }else if(name==='apply'){
        if(this.mode!=='dry'||!this.input||!this.facts||this.raw===null)throw new Error('NO_TYPED_UPDATE');
        const before=decide(this.input).decision;
        const applied=applyFundingV2(this.input.treasury,this.facts,this.raw,this.known(),this.finalProof?this.input.now:STORY_CLOCK,TIMEZONE,this.receipts);
        if(applied.diagnostic)this.audit('FUNDING_APPLICATION_REJECTED',applied.diagnostic.diagnostic_code,applied.diagnostic);
        this.review=applied.review_required;this.input={...this.input,treasury:applied.state};if(applied.outcome==='APPLIED')this.receipts.push(applied.receipt);
        const after=decide(this.input);this.review ||= after.reason==='INFLOW_ETA_UNCERTAIN';this.transition=`${before} → ${after.decision}`;
        this.audit(applied.outcome==='APPLIED'?'EXPECTED_INFLOW_UPDATED':'FUNDING_UPDATE_'+applied.outcome,`${this.facts.classification} · ${this.facts.new_eta_date??this.facts.new_eta_exact??'no date'}`);
        this.audit('DECISION_'+after.decision,after.reason+' · financial writes 0',{from:before,to:after.decision,decision:after,input:this.input});this.raw=null;
      }else if(name==='funded'){
        // Never invent another identity to bypass a persisted claim.
        if(this.state()!=='MISSING'){
          this.mode='sandbox';this.evaluation=null;this.approvedDigest=null;
          const saved=deserialize<PreparedExecution>(this.ledger.readPreparation(this.payableId).body);this.input=saved.input;this.asOf=saved.input.now;
          this.audit('BLOCK_DUPLICATE','Existing '+this.state()+' record; no new quote or financial request');return this.view();
        }
        this.approvals.invalidate(this.payableId,'REQUOTE_REQUIRED');
        this.evaluation=null;this.approvedDigest=null;this.mode='sandbox';this.facts=null;this.raw=null;this.transition=null;this.review=false;
        const rows=await this.adapter.getWalletBalances();this.asOf=this.clock();this.connected=true;
        const previous=this.input;this.input=this.base(this.one(rows,'USD').available,true);if(this.finalProof&&previous){this.input.payable=structuredClone(previous.payable);this.input.treasury={...previous.treasury,wallet_balance:this.input.treasury.wallet_balance,committed_amount:this.input.treasury.committed_amount};}this.audit('FUNDED_SCENARIO_LOADED',this.finalProof?'Same EUR 1.00 payable; real balance retained; application commitments released':'Separate EUR 1.00 sandbox payable; real balance retained; application commitments released');
        const evaluated=await this.controller.evaluate(this.input);this.input=evaluated.input;this.evaluation=evaluated;
        if(evaluated.quote)this.audit('QUOTE_CREATED',`${evaluated.quote.quote_id} · USD ${major(evaluated.quote.source_amount)} → EUR 1.00`);
        this.audit('DECISION_'+evaluated.decision.decision,evaluated.decision.reason);
        this.audit('EXECUTION_PREVIEW','Exact intent requires approval',{input:evaluated.input,decision:evaluated.decision,quote:evaluated.quote,raw_balance:evaluated.raw_balance,execution_fingerprint:intentFingerprint(evaluated)});
        this.approvals.invalidate(this.payableId,'REQUOTE_REQUIRED');
        if(evaluated.decision.decision==='EXECUTE'){
          if(!evaluated.statement&&(this.statementFailure||this.approvals.current(this.payableId)?.evaluation.statement))throw new StatementVeto();
          if(evaluated.statement){this.audit('FINANCIAL_CONTEXT_OK','Statement snapshot included in proposed approval',evaluated.statementEvidence);this.statementFailure=null;}
          const approval=this.approvals.propose(evaluated);this.approvedDigest=approval.execution_fingerprint;
        }
      }else if(name==='invalidate'){
        if(this.state()!=='MISSING'||!this.evaluation)throw new Error('INVALIDATION_BLOCKED');
        this.approvals.invalidate(this.payableId,'QUOTE_REPLACEMENT_REQUESTED');
        this.audit('APPROVAL_INVALIDATED','Quote replacement requested; no writes; refresh quote and explicitly approve again');
      }else if(name==='refresh-context'){
        if(this.input && this.state()==='MISSING'){
          const rows=await this.adapter.getWalletBalances(),balance=this.one(rows,'USD').available;
          this.connected=true;this.asOf=this.clock();
          this.input.treasury.wallet_balance=balance;this.input.now=this.finalProof||this.mode==='sandbox'?this.clock():STORY_CLOCK;
          if(this.evaluation){this.evaluation.input.treasury.wallet_balance=balance;this.evaluation.input.now=this.input.now;this.approvals.inspect(this.evaluation);}
          this.audit('CONTEXT_REEVALUATED','Read-only current cash, clock and approval check',{input:this.input,decision:decide(this.input)});
        }
      }else if(name==='approve'){
        if(this.mode!=='sandbox'||this.state()!=='MISSING'||!this.evaluation||typeof body.fingerprint!=='string')throw new Error('APPROVAL_BLOCKED');
        await this.controller.recheckStatements(this.evaluation);
        this.approvals.approve(this.evaluation,body.fingerprint,'local-demo-operator');
      }else if(name==='refresh-status'){
        await this.refreshTransferStatus();
      }else if(name==='execute'){
        if(this.state()!=='MISSING'){this.audit('BLOCK_DUPLICATE','Existing execution prevents submission');this.evaluation=null;this.approvedDigest=null;return this.view();}
        if(!this.writesEnabled)throw new Error('FINANCIAL_WRITES_DISABLED');
        if(this.mode!=='sandbox'||!this.evaluation||!this.approvedDigest||body.confirm!==this.approvedDigest||!this.view().canExecute)throw new Error('EXECUTION_GATE_BLOCKED');
        // The browser cannot supply amounts, beneficiaries, quotes, reserve or IDs.
        // Only the immutable server-side evaluation is used to prepare the claim.
        const authorization=this.approvals.authorization(this.evaluation);
        const prepared=await this.controller.prepare(this.evaluation,authorization);
        if(prepared.prepared.input.payable.payable_id!==this.payableId)throw new Error('IDENTITY_MISMATCH');
        this.approvedDigest=null;
        const result=await this.controller.continuePrepared(this.payableId,authorization);
        this.importExecutionAudit();
        if(result.decision==='BLOCK_DUPLICATE'){this.audit('BLOCK_DUPLICATE',result.state);return this.view();}
        const val=(rows:WalletBalance[],c:string)=>major(this.one(rows,c).available);
        this.result={conversionId:result.conversion.id,conversionStatus:result.conversion.status,transferId:result.transfer.id,transferStatus:result.transfer.status,
          usdBefore:val(result.before,'USD'),usdAfter:val(result.after,'USD'),eurBefore:val(result.before,'EUR'),eurAfter:val(result.after,'EUR')};
        writeFileSync(join(this.dir,'result.json'),JSON.stringify(this.result),{flag:'wx'});this.writes=2;this.conversions=1;this.transfers=1;
        this.input=structuredClone(prepared.prepared.input);this.input.treasury.wallet_balance=this.one(result.after,'USD').available;this.asOf=this.clock();this.audit('BLOCK_DUPLICATE','Transfer attached. Every later execute request is blocked.');
      }else throw new Error('UNKNOWN_ACTION');
    }catch(error){
      if(error instanceof StatementVeto){
        this.statementFailure=error.reason;this.approvals.invalidate(this.payableId,error.reason);this.approvedDigest=null;
        this.audit(error.reason,'ESCALATE · statement check refused execution; fresh context and human review required');
      }
      this.importExecutionAudit();this.error=name==='execute'?'Execution refused: approval/context invalid, financial writes disabled, or execution needs review. Refresh context; do not reset existing claims.':name==='interpret'?'The update could not be interpreted safely. Use a supported synthetic funding statement.':'Sandbox request failed or the scenario could not be loaded. No executable preview is available.';
      if(name==='funded'||name==='execute'){this.evaluation=null;this.approvedDigest=null;}
      if(name==='open')this.connected=false;
      this.audit('REQUEST_FAILED',name+' · safe error; provider details omitted');
    }finally{this.busy=false;if(this.finalProof){
      const path=join(this.dir,'case-state.json'),temp=path+'.tmp';const fd=openSync(temp,'w');
      try{writeFileSync(fd,serialize({input:this.input,mode:this.mode,receipts:this.receipts}));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);
    }}
    return this.view();
  }
  private importExecutionAudit(){
    const path=join(this.dir,'ledger',logicalExecutionKey(this.payableId)+'.audit.jsonl');if(!existsSync(path))return;
    const existing=new Set(this.events.map(e=>e.event+'|'+e.detail));
    for(const line of readFileSync(path,'utf8').trim().split('\n')){const e=JSON.parse(line);const detail=`Controller event at ${e.at}`;if(!existing.has(e.event+'|'+detail))this.audit(e.event,detail);}
  }
  async refreshTransferStatus():Promise<void>{
    const key=logicalExecutionKey(this.payableId),path=join(this.dir,'ledger',key+'.transfer.json');
    if(!existsSync(path))throw new Error('NO_TRANSFER');
    const saved=JSON.parse(readFileSync(path,'utf8'));const t=await this.adapter.getTransfer(saved.transfer_id);
    if(t.id!==saved.transfer_id||t.amount!==100n||t.currency!=='EUR')throw new Error('STATUS_IDENTITY_MISMATCH');
    this.ledger.observeTransfer(this.payableId,t,this.clock());
    this.audit('TRANSFER_STATUS_OBSERVED','Read-only provider observation',{transfer:t,to:this.state()});
    if(this.result)this.result={...this.result,transferStatus:t.status};
    this.importExecutionAudit();
  }
  exportAudit():unknown{
    const path=join(this.dir,'ledger',logicalExecutionKey(this.payableId)+'.audit.jsonl');
    const execution=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
    const approval=this.approvals.history(this.payableId);
    const caseEvents=this.events.map((e,sequence)=>({...e,stream:'case',sequence,...(e.event==='FUNDING_UPDATE_RECEIVED'&&/^SHA-256 [a-f0-9]{64}$/.test(e.detail)?{data:{source_text_hash:e.detail.slice(8),parser_version:'funding-facts-v2'}}:{})}));
    return safeAuditExport({schema_version:'duegate-audit-v1',case_id:'DG-001',payable_id:this.payableId,parser_version:'funding-facts-v2',approval:approval.at(-1)?.approval??{status:'NOT_RECORDED_LEGACY'},history:[...caseEvents,...execution.map((e,sequence)=>({...e,stream:'execution',sequence})),...approval.map(e=>({...e,stream:'approval'}))].sort((a,b)=>a.at.localeCompare(b.at)||a.stream.localeCompare(b.stream)||a.sequence-b.sequence)});
  }
  view():CaseView{
    const input=this.input, live=this.mode==='sandbox',persisted=this.state();
    const d=input?decide({...input,now:live||this.finalProof?this.clock():STORY_CLOCK}):null;
    const blocked=live&&persisted!=='MISSING';const q=this.evaluation?.quote??null;
    const storedApproval=this.approvals.current(this.payableId);
    const approval=this.evaluation?this.approvals.inspect(this.evaluation):storedApproval?this.approvals.inspect(storedApproval.evaluation):null;
    const veto=this.statementFailure&&live&&!['TRANSFER_ATTACHED','FAILED_REVIEW_REQUIRED'].includes(persisted)?this.statementFailure:null;
    const decision=veto?'ESCALATE':persisted==='FAILED_REVIEW_REQUIRED'&&live?'FAILED_REVIEW_REQUIRED':blocked?'BLOCK_DUPLICATE':d?.decision??'UNAVAILABLE';
    const p=input?.payable,t=input?.treasury;const free=t?t.wallet_balance-t.fixed_reserve-t.committed_amount:0n;
    const safe=(v:bigint|undefined)=>v===undefined?'—':money(v);
    const bound=storedApproval?.evaluation.statement;
    let observedResult=this.result;
    const transferPath=join(this.dir,'ledger',logicalExecutionKey(this.payableId)+'.transfer.json');
    const conversionPath=join(this.dir,'ledger',logicalExecutionKey(this.payableId)+'.conversion.json');
    if(!observedResult&&existsSync(transferPath)&&existsSync(conversionPath)){
      const transfer=JSON.parse(readFileSync(transferPath,'utf8')),conversion=JSON.parse(readFileSync(conversionPath,'utf8'));
      observedResult={conversionId:conversion.conversion_id,conversionStatus:conversion.status??'UNVERIFIED',transferId:transfer.transfer_id,transferStatus:this.ledger.observedTransferStatus(this.payableId)??'UNVERIFIED',usdBefore:'—',usdAfter:'—',eurBefore:'—',eurAfter:'—'};
    }
    if(observedResult)observedResult={...observedResult,transferStatus:this.ledger.observedTransferStatus(this.payableId)??observedResult.transferStatus};
    return {interpreterProvider:this.interpretation.provider,connectionLabel:this.connected?'Airwallex sandbox: Connected':observedResult?'Airwallex proof: Recorded · live connection not checked':'Airwallex sandbox: Not checked',approvalReason:approval?.status==='INVALIDATED'?'Approval no longer matches current execution context. A new quote/context requires new approval.':undefined,finalProof:this.finalProof,financialWritesEnabled:this.writesEnabled,quoteLimit:'Maximum 1.50 USD per EUR; source budget USD '+safe(input?.funding.required_amount),fundingExample:this.claudeStory?'The $4,000 customer payment expected Thursday has been delayed until Monday.':this.finalProof&&p?'INFLOW-001 delayed until '+new Date(Date.parse(p.latest_safe_execution_at)+3600000).toISOString():'The $4,000 customer payment expected Thursday has been delayed until Monday.',mode:this.mode,caseId:'Supplier Payment DG-001',payableId:live||this.finalProof?this.payableId:'duegate-visual-dg001',supplier:'Nordlicht Supply · demo',amount:live||this.finalProof?'1.00':'10000.00',
      due:p?.due_at??'2026-10-09T20:00:00.000Z',cutoff:p?.latest_safe_execution_at??'2026-10-09T16:00:00.000Z',clock:live||this.finalProof?this.clock():STORY_CLOCK,source:'USD',target:'EUR',beneficiary:'Known sandbox DE / EUR · …'+(p?.beneficiary_id??this.beneficiaryId).slice(-8),
      connected:this.connected,balanceAsOf:this.asOf,treasury:{balance:safe(t?.wallet_balance),reserve:safe(t?.fixed_reserve),committed:safe(t?.committed_amount),free:input?money(free):'—',required:safe(input?.funding.required_amount),inflow:safe(t?.expected_inflow_amount),eta:t?.expected_inflow_eta_window?`${t.expected_inflow_eta_window.date??'Window'} · ${t.expected_inflow_eta_window.timezone}`:t?.expected_inflow_eta??'—'},
      decision,reason:veto??(persisted==='FAILED_REVIEW_REQUIRED'?'TRANSFER_REVIEW_REQUIRED':blocked?'EXISTING_EXECUTION':d?.reason??'BALANCE_UNAVAILABLE'),transition:this.transition,
      ...(bound?{statementTerms:{start:bound.periodStart,end:bound.periodEnd,cash:money(BigInt(bound.accountingCashMinor)),net:money(BigInt(bound.netCashChangeMinor))}}:{}),
      approval:live?approval:null,canApprove:live&&!blocked&&!!this.evaluation&&approval?.status==='PENDING'&&decision==='EXECUTE',
      quoteFreshness:!q?'NONE':!Number.isFinite(Date.parse(q.expires_at))?'INVALID':Date.parse(q.expires_at)<=Date.parse(this.clock())?'EXPIRED':'FRESH',
      canExecute:this.writesEnabled&&live&&!blocked&&!this.review&&approval?.status==='APPROVED'&&!!this.approvedDigest&&decision==='EXECUTE'&&!!q&&Date.parse(q.expires_at)>Date.parse(this.clock()),
      canApply:!live&&!!this.facts&&this.raw!==null&&this.facts.classification!=='AMBIGUOUS',review:this.review,
      facts:this.facts?{classification:this.facts.classification,inflow:this.facts.expected_inflow_id??'—',amount:this.facts.amount_minor===null?'—':major(BigInt(this.facts.amount_minor)),precision:this.facts.eta_precision,date:this.facts.new_eta_date,exact:this.facts.new_eta_exact,windowStart:this.facts.eta_window_start,windowEnd:this.facts.eta_window_end,hash:this.facts.source_text_hash}:null,
      quote:q?{id:q.quote_id,rate:q.rate,expires:q.expires_at,sourceAmount:major(q.source_amount),targetAmount:major(q.target_amount)}:null,
      preview:live&&this.approvedDigest?{key:logicalExecutionKey(this.payableId),digest:this.approvedDigest,reserveRemaining:safe(t?.fixed_reserve)}:null,
      result:live?observedResult:null,executionState:persisted,
      financialWrites:live&&!this.result&&['EXECUTING','REVIEW','TRANSFER_ATTACHED'].includes(persisted)?null:this.writes,
      conversionCount:this.conversions||Number(existsSync(join(this.dir,'ledger',logicalExecutionKey(this.payableId)+'.conversion.json'))),
      transferCount:this.transfers||Number(existsSync(join(this.dir,'ledger',logicalExecutionKey(this.payableId)+'.transfer.json'))),error:this.error,audit:[...this.events.map(({at,event,detail})=>({at,event,detail})),...this.approvals.history(this.payableId).map(r=>({at:r.at,event:r.event,detail:r.from+' → '+r.to+' · '+r.reason}))].sort((a,b)=>a.at.localeCompare(b.at))};
  }
}
