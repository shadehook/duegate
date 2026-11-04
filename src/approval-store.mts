import {approvalManifest,manifestFingerprint,changedManifest,APPROVAL_VERSION} from './approval-context.mts';
import type {ApprovalManifest,RevalidationEvidence} from './approval-context.mts';
import {mkdirSync,readdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {decide,logicalExecutionKey} from './decision-engine.mts';
import type {DecisionInput} from './decision-engine.mts';
import type {QuotedFx} from './airwallex-adapter.mts';
import type {Evaluation,PreparedExecution} from './execution-controller.mts';

export type ApprovalStatus='PENDING'|'APPROVED'|'INVALIDATED'|'USED';
export interface Approval {manifest?:ApprovalManifest; invalidation?:Omit<RevalidationEvidence,'airwallexWritesAttempted'>;actor_type?:'HUMAN';actor_display_label?:string;approval_id:string;payable_id:string;approved_at:string|null;approved_by:string|null;execution_fingerprint:string;quote_id:string;expires_at:string;status:ApprovalStatus}
type Intent=Pick<Evaluation,'input'|'quote'|'statement'>;
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>typeof x==='bigint'?{__money:x.toString()}:x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const parse=<T,>(s:string):T=>JSON.parse(s,(_k,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&'__money'in v?BigInt(v.__money):v);
export function intentFingerprint(p:Intent):string{return manifestFingerprint(approvalManifest(p));}
function eligible(p:Intent,now:string):boolean{
  const q=p.quote;
  return !!q&&canonical(q)===canonical(p.input.quote)&&Number.isFinite(Date.parse(now))&&Number.isFinite(Date.parse(q.valid_from_at))&&Date.parse(q.valid_from_at)<=Date.parse(now)&&decide({...p.input,now}).decision==='EXECUTE';
}
export interface ExactAuthorization {check(p:PreparedExecution,used?:boolean):void;consume(p:PreparedExecution):void}
interface RecordEntry {sequence:number;at:string;event:string;from:ApprovalStatus|null;to:ApprovalStatus;reason:string;approval:Approval;evaluation:Evaluation}
/** Append-only exclusive revision creation supplies one-use cross-process arbitration.
 * A crash after USED is intentionally blocked, never retried automatically. */
export class ApprovalStore {
  private directory:string;private clock:()=>string;
  constructor(directory:string,clock:()=>string){this.directory=directory;this.clock=clock;mkdirSync(directory,{recursive:true});}
  private dir(id:string){const d=join(this.directory,logicalExecutionKey(id));mkdirSync(d,{recursive:true});return d;}
  history(id:string):RecordEntry[]{return readdirSync(this.dir(id)).filter(f=>/^\d{8}\.json$/.test(f)).sort().map(f=>parse<RecordEntry>(readFileSync(join(this.dir(id),f),'utf8')));}
  current(id:string):RecordEntry|null{return this.history(id).at(-1)??null;}
  private append(previous:RecordEntry|null,evaluation:Evaluation,approval:Approval,reason:string){
    const entry:RecordEntry={sequence:(previous?.sequence??0)+1,at:this.clock(),event:'APPROVAL_'+approval.status,from:previous?.approval.status??null,to:approval.status,reason,approval,evaluation};
    const fd=openSync(join(this.dir(approval.payable_id),String(entry.sequence).padStart(8,'0')+'.json'),'wx');
    try{writeFileSync(fd,canonical(entry));fsyncSync(fd);}finally{closeSync(fd);}return entry;
  }
  invalidate(id:string,reason='PROTECTED_INPUT_CHANGED',evidence?:Omit<RevalidationEvidence,'airwallexWritesAttempted'>):void{const old=this.current(id);if(old&&['APPROVED','PENDING'].includes(old.approval.status))this.append(old,old.evaluation,{...old.approval,status:'INVALIDATED',...(evidence?{invalidation:evidence}:{})},reason);}
  propose(e:Evaluation):Approval{
    if(!eligible(e,this.clock()))throw new Error('QUOTE_OR_GATE_INVALID');
    const id=e.input.payable.payable_id,old=this.current(id);
    if(old?.approval.status==='USED')throw new Error('APPROVAL_ALREADY_USED');
    const fp=intentFingerprint(e),q=e.quote!;
    if(old)this.invalidate(id,'NEW_QUOTE_REQUIRES_NEW_APPROVAL');
    const a:Approval={manifest:approvalManifest(e),approval_id:'approval-'+fp,payable_id:id,approved_at:null,approved_by:null,execution_fingerprint:fp,quote_id:q.quote_id,expires_at:new Date(Math.min(Date.parse(q.expires_at),Date.parse(e.input.payable.latest_safe_execution_at))).toISOString(),status:'PENDING'};
    if(this.history(id).some(r=>r.approval.approval_id===a.approval_id))throw new Error('FRESH_QUOTE_REQUIRED');
    return this.append(this.current(id),structuredClone(e),a,'EXACT_EXECUTION_PRESENTED').approval;
  }
  inspect(e:Intent):Approval|null{
    const old=this.current(e.input.payable.payable_id);if(!old)return null;
    if(['PENDING','APPROVED'].includes(old.approval.status)){
      let invalidation:Omit<RevalidationEvidence,'airwallexWritesAttempted'>|undefined;
      try{
        const manifest=old.approval.manifest;
        if(!manifest||manifestFingerprint(manifest)!==old.approval.execution_fingerprint||intentFingerprint(old.evaluation)!==old.approval.execution_fingerprint)throw Error('LEGACY_OR_CORRUPT_MANIFEST');
        const changedFields=changedManifest(manifest,approvalManifest(e));
        const gate=decide({...e.input,now:this.clock()});
        if(gate.reason==='INVALID_INPUT')throw Error('MALFORMED_CURRENT_CONTEXT');
        if(Date.parse(this.clock())>=Date.parse(old.approval.expires_at)||['QUOTE_EXPIRED','CUTOFF_REACHED'].includes(gate.reason)){
          invalidation={decision:'ESCALATE',reasonCode:gate.reason==='CUTOFF_REACHED'?'CUTOFF_REACHED':'QUOTE_EXPIRED',approvalVersion:APPROVAL_VERSION,changedFields:[]};
        }else if(changedFields.length){
          invalidation={decision:'REAPPROVAL_REQUIRED',reasonCode:changedFields.some(c=>c.source==='t0')?'FINANCIAL_CONTEXT_CHANGED':'PROTECTED_INPUT_CHANGED',approvalVersion:APPROVAL_VERSION,changedFields};
        }else if(!eligible(e,this.clock()))invalidation={decision:'ESCALATE',reasonCode:gate.reason,approvalVersion:APPROVAL_VERSION,changedFields:[]};
      }catch{invalidation={decision:'ESCALATE',reasonCode:'APPROVAL_CONTEXT_UNAVAILABLE',approvalVersion:APPROVAL_VERSION,changedFields:[]};}
      if(invalidation)this.invalidate(old.approval.payable_id,invalidation.reasonCode,invalidation);
    }
    return this.current(old.approval.payable_id)!.approval;
  }
  approve(e:Evaluation,fingerprint:string,actor:string):Approval{
    const a=this.inspect(e);if(!a||a.status!=='PENDING'||a.execution_fingerprint!==fingerprint||actor!=='local-demo-operator')throw new Error('EXACT_APPROVAL_REQUIRED');
    const old=this.current(a.payable_id)!;
    return this.append(old,old.evaluation,{...a,status:'APPROVED',approved_at:this.clock(),approved_by:actor,actor_type:'HUMAN',actor_display_label:'Human operator · local demo'},'EXPLICIT_HUMAN_APPROVAL').approval;
  }
  authorization(e:Evaluation):ExactAuthorization{
    const id=e.input.payable.payable_id;
    const original=this.current(id)?.approval;const fp=original?.execution_fingerprint;
    const check=(p:Intent,used=false)=>{
      const a=this.inspect(p);
      if(!a||!original?.manifest||changedManifest(original.manifest,approvalManifest(p)).length||a.execution_fingerprint!==fp||a.status!==(used?'USED':'APPROVED')||!eligible(p,this.clock())||Date.parse(this.clock())>=Date.parse(a.expires_at))throw new Error('APPROVAL_INVALID_OR_USED');
    };
    check(e);
    return {check,consume:(p)=>{check(p);const old=this.current(id)!;this.append(old,old.evaluation,{...old.approval,status:'USED'},'EXECUTION_STARTING');}};
  }
}
