import {readFileSync,writeFileSync,existsSync,mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import type {InterpretationAdapter} from '../src/claude-funding-interpreter.mts';
import {DemoService,FINAL_PAYABLE} from './demo-service.mts';
import {ApprovalStore} from '../src/approval-store.mts';
import type {AirwallexAdapter,QuotedFx,WalletBalance} from '../src/airwallex-adapter.mts';
import type {CaseView} from '../web/types.mts';
import {major} from '../src/airwallex-adapter.mts';
import {recordedAccountingCheck} from '../src/accounting-context.mts';
import type {AccountingCheckResult} from '../src/accounting-context.mts';
interface RecordedSummary {quote:QuotedFx;counts:{conversions:number;transfers:number};before:{currency:string;available:string;pending:string;total:string}[];after:{currency:string;available:string;pending:string;total:string}[];conversion:{id:string;status:string};transfer:{id:string;status:string;fee_amount:string;fee_currency:string};funding_status:string}
/** Offline data adapter. Every money-moving operation throws; no HTTP or credentials. */
export class RecordedAdapter implements AirwallexAdapter {
  private summary:RecordedSummary;private sequence=0;private counterPath:string;private quoteClock?:()=>string;writeAttempts=0;
  constructor(summary:RecordedSummary,counterPath:string,quoteClock?:()=>string){this.quoteClock=quoteClock;this.summary=summary;this.counterPath=counterPath;if(existsSync(counterPath))this.sequence=Number(readFileSync(counterPath,'utf8'));}
  async getWalletBalances():Promise<WalletBalance[]>{return this.summary.before.map(x=>({...x,available:BigInt(x.available),pending:BigInt(x.pending),total:BigInt(x.total)}));}
  async createFxQuote():Promise<QuotedFx>{this.sequence++;writeFileSync(this.counterPath,String(this.sequence));return {...this.summary.quote,quote_id:'presentation-quote-'+this.sequence,...(this.quoteClock?{valid_from_at:this.quoteClock(),expires_at:new Date(Date.parse(this.quoteClock())+900000).toISOString()}:{}),source_amount:BigInt(this.summary.quote.source_amount),target_amount:BigInt(this.summary.quote.target_amount),source_fee_amount:BigInt(this.summary.quote.source_fee_amount)};}
  async getRelevantBeneficiary(id:string){return {id,country:'DE',currency:'EUR',transfer_methods:['LOCAL']};}
  async validateTransfer(){throw new Error('NO_WRITE_PRESENTATION_NO_VALIDATION');}
  async createConversion():Promise<never>{this.writeAttempts++;throw new Error('NO_WRITE_PRESENTATION');}
  async createTransfer():Promise<never>{this.writeAttempts++;throw new Error('NO_WRITE_PRESENTATION');}
  async getConversion():Promise<never>{throw new Error('USE_RECORDED_EVIDENCE');}
  async getTransfer():Promise<never>{throw new Error('USE_RECORDED_EVIDENCE');}
}
export class PresentationService {
  private accountingCheck:AccountingCheckResult|undefined;
  readonly adapter:RecordedAdapter;private demo:DemoService;private dir:string;private summary:RecordedSummary;private attached=false;private events:{at:string;event:string;detail:string}[]=[];
  private clock=()=> '2026-10-27T17:48:00.000Z';
  constructor(directory:string,evidencePath='fixtures/recorded-proof.json',interpretation?:InterpretationAdapter,options:{accountingEvidencePath?:string}={}){
    if(options.accountingEvidencePath){
      if(interpretation?.provider==='claude')throw new Error('ACCOUNTING_PRESENTATION_REQUIRES_OFFLINE_MODE');
      this.accountingCheck=recordedAccountingCheck(JSON.parse(readFileSync(options.accountingEvidencePath,'utf8')));
    }
    if(interpretation?.provider==='claude')this.clock=()=> '2026-10-07T12:00:00.000Z';
    this.dir=directory;mkdirSync(directory,{recursive:true});this.summary=JSON.parse(readFileSync(evidencePath,'utf8'));
    if(this.summary.counts.conversions!==1||this.summary.counts.transfers!==1)throw new Error('RECORDED_PROOF_COUNTS_INVALID');
    this.adapter=new RecordedAdapter(this.summary,join(directory,'quote-sequence.txt'),interpretation?.provider==='claude'?this.clock:undefined);this.demo=new DemoService(this.adapter,join(directory,'interaction'),this.clock,{finalProof:true,financialWritesEnabled:false,interpretation,claudeStory:interpretation?.provider==='claude'});
    this.attached=existsSync(join(directory,'recorded-attached.json'));
    if(existsSync(join(directory,'presentation-audit.jsonl')))this.events=readFileSync(join(directory,'presentation-audit.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  }
  private event(event:string,detail:string){const e={at:new Date().toISOString(),event,detail};appendFileSync(join(this.dir,'presentation-audit.jsonl'),JSON.stringify(e)+'\n');this.events.push(e);}
  async action(name:string,body:Record<string,unknown>={}):Promise<CaseView>{
    if(this.attached){this.event(name==='open'?'RECORDED_STATE_RESTORED':'BLOCK_DUPLICATE','Recorded transfer remains attached in presentation; no execution or provider call');return this.view();}
    if(name==='show-recorded'){
      if(this.demo.view().approval?.status!=='APPROVED')throw new Error('PRESENTATION_APPROVAL_REQUIRED');
      writeFileSync(join(this.dir,'recorded-attached.json'),JSON.stringify({source:'fixtures/recorded-proof.json',new_financial_writes:0}),{flag:'wx'});this.attached=true;this.event('RECORDED_PROOF_SHOWN','Historical EUR1 execution displayed; no new execution. Historical approval/IDs remain in original live audit.');return this.view();
    }
    if(name==='execute'){this.event('EXECUTION_REFUSED','Presentation cannot execute. '+(this.demo.view().approval?.status==='INVALIDATED'?'Approval invalidated: FX quote changed.':'No-write mode.'));return {...this.view(),error:'Execution refused: no-write presentation. '+(this.demo.view().approval?.status==='INVALIDATED'?'Approval invalidated: FX quote changed.':'')};}
    if(name==='invalidate'){
      const store=new ApprovalStore(join(this.dir,'interaction','approvals'),this.clock),entry=store.current(FINAL_PAYABLE);if(entry?.approval.status!=='APPROVED')throw new Error('APPROVAL_REQUIRED');
      const changed=structuredClone(entry.evaluation);changed.quote!.quote_id+='-changed';changed.input.quote=changed.quote;store.inspect(changed);
      this.event('PROTECTED_CONTEXT_CHANGED','Synthetic FX quote ID changed; approval fingerprint no longer matches. No API call.');
      return this.view();
    }
    if(!['open','interpret','apply','funded','approve','refresh-context'].includes(name))throw new Error('PRESENTATION_ACTION_BLOCKED');
    await this.demo.action(name,body);if(name==='approve'&&this.demo.view().approval?.status==='APPROVED')this.event('PRESENTATION_HUMAN_APPROVAL','Human operator · local demo accepted '+this.demo.view().approval!.execution_fingerprint+'; local label, not authenticated identity');
    return this.view();
  }
  view():CaseView{
    const v=this.demo.view();let result=v.result;
    if(this.attached){const value=(rows:RecordedSummary['before'],c:string)=>major(BigInt(rows.find(x=>x.currency===c)!.available));result={conversionId:this.summary.conversion.id,conversionStatus:this.summary.conversion.status,transferId:this.summary.transfer.id,transferStatus:this.summary.transfer.status,usdBefore:value(this.summary.before,'USD'),usdAfter:value(this.summary.after,'USD'),eurBefore:value(this.summary.before,'EUR'),eurAfter:value(this.summary.after,'EUR')};}
    return {...v,...(this.accountingCheck?{accountingCheck:this.accountingCheck}:{}),presentationMode:true,recordedAttached:this.attached,connected:false,connectionLabel:'Airwallex sandbox proof · Recorded',financialWritesEnabled:false,financialWrites:0,canExecute:false,canApprove:!this.attached&&v.canApprove,canApply:!this.attached&&v.canApply,decision:this.attached?'BLOCK_DUPLICATE':v.decision,reason:this.attached?'RECORDED_EXECUTION_ALREADY_EXISTS':v.reason,executionState:this.attached?'RECORDED_TRANSFER_ATTACHED':v.executionState,result,conversionCount:this.attached?1:0,transferCount:this.attached?1:0,recordedFunding:this.attached?this.summary.funding_status:undefined,recordedFee:this.attached?this.summary.transfer.fee_currency+' '+major(BigInt(this.summary.transfer.fee_amount)):undefined,approvalReason:v.approval?.status==='INVALIDATED'?'Approval invalidated: FX quote changed. New context requires new human approval.':undefined,audit:[...v.audit.map(a=>({...a,detail:a.detail.replace('real USD wallet snapshot','recorded USD wallet snapshot').replace('real balance retained','recorded balance retained')})),...this.events]};
  }
  exportAudit(){return {schema_version:'duegate-presentation-v1',mode:'NO_WRITE_RECORDED_PROOF',new_financial_writes:0,current_interaction:this.demo.exportAudit(),presentation_events:this.events,recorded_proof_source:'docs/proof.md',recorded_execution:this.attached?this.summary:null,...(this.accountingCheck?{accounting_check:this.accountingCheck}:{})};}
}
