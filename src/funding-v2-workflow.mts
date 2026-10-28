import { decide } from './decision-engine.mts';
import type { DecisionInput } from './decision-engine.mts';
import type { FundingInterpreter, KnownInflow } from './funding-update.mts';
import { sourceHash } from './funding-update.mts';
import { applyFundingV2, FUNDING_V2, validateCandidate, wireCandidate } from './funding-v2.mts';
import type { FundingUpdateV2 } from './funding-v2.mts';

export async function processFundingV2(interpreter:FundingInterpreter<FundingUpdateV2|Promise<FundingUpdateV2>>,raw:string,known:readonly KnownInflow[],input:DecisionInput,reference:string,timezone:string,receipts:readonly string[]) {
  const hash=sourceHash(raw),audit:object[]=[];
  const record=(event:string,data:unknown)=>audit.push({event,payable_id:input.payable.payable_id,inflow_id:input.treasury.expected_inflow_id,source_hash:hash,parser_version:FUNDING_V2,data});
  record('FUNDING_UPDATE_RECEIVED',{reference,timezone});
  let candidate:FundingUpdateV2|null=null;
  try{
    if(input.now!==reference)throw new Error('CLOCK_MISMATCH');
    const returned=await interpreter.interpret(raw,known,reference,timezone);
    if(returned.source_text_hash!==hash||returned.parser_version!==FUNDING_V2)throw new Error('INVALID_PROVENANCE');
    const validated=validateCandidate(wireCandidate(returned),raw,known,reference,timezone);
    if(JSON.stringify(returned.extracted_facts)!==JSON.stringify(validated.extracted_facts))throw new Error('INVALID_FACTS');
    candidate=validated;
  }catch{ candidate=null; /* No provider error/raw response logging. */ }
  const applied=candidate?applyFundingV2(input.treasury,candidate,raw,known,reference,timezone,receipts):{state:input.treasury,outcome:'REJECTED' as const,review_required:true,receipt:''};
  if(applied.outcome==='REJECTED')record('FUNDING_UPDATE_REJECTED',{reason:'UNSAFE_INVALID_OR_AMBIGUOUS',candidate: candidate?.classification==='AMBIGUOUS'?candidate:null});
  else record('FUNDING_FACTS_EXTRACTED',{candidate});
  const nextInput=applied.state===input.treasury?input:{...input,treasury:applied.state};
  if(applied.outcome==='APPLIED')record('EXPECTED_INFLOW_UPDATED',{old:input.treasury,new:applied.state});
  const decision=decide(nextInput),review=applied.review_required||decision.reason==='INFLOW_ETA_UNCERTAIN';
  record('DECISION_REEVALUATED',{before:decide(input),after:decision,review_required:review});
  // Audit is JSON-safe, and carries no raw message or unvalidated model output.
  const safeAudit:object[]=JSON.parse(JSON.stringify(audit,(_k,v)=>typeof v==='bigint'?String(v):v));
  return {input:nextInput,candidate,decision,outcome:applied.outcome,review_required:review,
    receipts:applied.outcome==='APPLIED'?[...receipts,applied.receipt]:receipts,audit:safeAudit};
}
