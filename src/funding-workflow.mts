import { decide } from './decision-engine.mts';
import type { DecisionInput, DecisionResult } from './decision-engine.mts';
import { applyFundingUpdate, sourceHash, PARSER_VERSION } from './funding-update.mts';
import type { FundingInterpreter, KnownInflow, ApplyResult, FundingAuditEvent } from './funding-update.mts';

type AuditDecision = Omit<DecisionResult, 'free_cash' | 'required_funding'> & {free_cash: string | null; required_funding: string | null};
const auditDecision = (d: DecisionResult): AuditDecision => ({...d,free_cash:d.free_cash?.toString() ?? null,required_funding:d.required_funding?.toString() ?? null});
export type FundingWorkflowEvent = FundingAuditEvent | {
  event: 'DECISION_REEVALUATED'; payable_id: string; inflow_id: string | null;
  source_hash: string; parser_version: string; old_decision: AuditDecision; new_decision: AuditDecision;
};
/** Orchestration owns decision evaluation; neither interpreter nor apply function does.
 * Audit and applied keys are explicit returned values; callers must persist them together.
 */
export function processFundingMessage(interpreter: FundingInterpreter, rawText: string, known: readonly KnownInflow[],
  input: DecisionInput, referenceTime: string, timezone: string, appliedKeys: readonly string[]) {
  const hash = sourceHash(rawText);
  let candidate: unknown;
  try { candidate = referenceTime === input.now ? interpreter.interpret(rawText, known, referenceTime, timezone) : null; } catch { candidate = null; }
  const applied: ApplyResult = applyFundingUpdate(input.treasury, candidate, {
    payable_id: input.payable.payable_id, known_inflow_ids: known.map(k => k.id), applied_update_keys: appliedKeys, source_text_hash: hash,
  });
  const nextInput = applied.state === input.treasury ? input : {...input, treasury:applied.state};
  const audit: FundingWorkflowEvent[] = [...applied.audit];
  const decision = decide(nextInput);
  audit.push({event:'DECISION_REEVALUATED',payable_id:input.payable.payable_id,inflow_id:input.treasury.expected_inflow_id,
    source_hash:hash,parser_version:PARSER_VERSION,old_decision:auditDecision(decide(input)),new_decision:auditDecision(decision)});
  const nextKeys = applied.outcome === 'APPLIED' ? [...appliedKeys, applied.update_key] : appliedKeys;
  return {input:nextInput,decision,outcome:applied.outcome,applied_update_keys:nextKeys,audit};
}
