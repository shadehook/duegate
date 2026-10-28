import { createHash } from 'node:crypto';
import type { TreasuryState } from './decision-engine.mts';

export const PARSER_VERSION = 'deterministic-funding-v1';
export const ambiguityCodes = ['INVALID_DATE','AMBIGUOUS_OR_NONEXISTENT_LOCAL_TIME','UNSUPPORTED_OR_VAGUE_DATE','EXACT_TIME_REQUIRED',
  'INVALID_AMOUNT','AMOUNT_OUT_OF_RANGE','INVALID_CONTEXT','INVALID_KNOWN_INFLOWS','INFLOW_NOT_UNIQUELY_IDENTIFIED','UNKNOWN_OR_UNIDENTIFIED_INFLOW',
  'CURRENCY_MISMATCH','OLD_AMOUNT_MISMATCH','UNSUPPORTED_OR_VAGUE_UPDATE','ETA_NOT_FUTURE','CONTRADICTORY_DELAY','CONFLICTING_FACTS','INVALID_CONTEXT_OR_SCHEMA'] as const;
export const classifications = ['ON_TIME', 'DELAYED', 'CANCELLED', 'AMOUNT_CHANGED', 'IRRELEVANT', 'AMBIGUOUS'] as const;
export type Classification = typeof classifications[number];
export type FundingFact = { kind: 'AMOUNT'; amount_minor: number; currency: string }
  | { kind: 'ETA'; eta: string } | { kind: 'STATUS'; status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' };
export interface FundingUpdateResult {
  classification: Classification; expected_inflow_id: string | null; amount_minor: number | null;
  currency: string | null; new_eta: string | null; source_text_hash: string;
  extracted_facts: FundingFact[]; ambiguities: string[]; parser_version: string;
}
export interface KnownInflow {
  id: string; amount_minor: number; currency: string; eta: string;
}
export interface FundingInterpreter<Result = FundingUpdateResult> {
  interpret(rawText: string, knownInflows: readonly KnownInflow[], referenceTime: string, timezone: string): Result;
}
export const sourceHash = (rawText: string) => createHash('sha256').update(rawText, 'utf8').digest('hex');
export function validTime(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const currency = (v: unknown): v is string => typeof v === 'string' && /^(USD|EUR)$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
function exactKeys(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join('|') !== [...keys].sort().join('|')) throw new Error('Unexpected structured fields');
}
/** Runtime boundary: reject actions, decisions and all unknown fields, including nested ones. */
export function validateFundingUpdate(value: unknown): FundingUpdateResult {
  exactKeys(value, ['classification','expected_inflow_id','amount_minor','currency','new_eta','source_text_hash','extracted_facts','ambiguities','parser_version']);
  if (!classifications.includes(value.classification as Classification) || (value.expected_inflow_id !== null && !id(value.expected_inflow_id))
    || (value.amount_minor !== null && !money(value.amount_minor)) || (value.currency !== null && !currency(value.currency))
    || (value.new_eta !== null && !validTime(value.new_eta)) || typeof value.source_text_hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.source_text_hash)
    || value.parser_version !== PARSER_VERSION || !Array.isArray(value.ambiguities) || value.ambiguities.length > 20
    || !value.ambiguities.every(v => ambiguityCodes.includes(v))
    || !Array.isArray(value.extracted_facts) || value.extracted_facts.length > 20) throw new Error('Invalid funding schema');
  for (const fact of value.extracted_facts) {
    if (fact?.kind === 'AMOUNT') { exactKeys(fact, ['kind','amount_minor','currency']); if (!money(fact.amount_minor) || !currency(fact.currency)) throw new Error('Invalid amount fact'); }
    else if (fact?.kind === 'ETA') { exactKeys(fact, ['kind','eta']); if (!validTime(fact.eta)) throw new Error('Invalid ETA fact'); }
    else { exactKeys(fact, ['kind','status']); if (fact.kind !== 'STATUS' || !['ON_TIME','DELAYED','CANCELLED'].includes(fact.status as string)) throw new Error('Invalid status fact'); }
  }
  const r = value as unknown as FundingUpdateResult;
  if (r.classification === 'AMBIGUOUS') { if (!r.ambiguities.length) throw new Error('Ambiguity needs reason'); return structuredClone(r); }
  if (r.ambiguities.length) throw new Error('Unresolved ambiguity');
  if (r.classification === 'IRRELEVANT') {
    if (r.expected_inflow_id !== null || r.amount_minor !== null || r.currency !== null || r.new_eta !== null || r.extracted_facts.length) throw new Error('Irrelevant update carries facts');
  } else {
    if (!r.expected_inflow_id || r.amount_minor === null || r.currency === null) throw new Error('Incomplete typed update');
    const expected: FundingFact[] = [{ kind: 'AMOUNT', amount_minor: r.amount_minor, currency: r.currency }];
    if (r.classification !== 'CANCELLED' && !r.new_eta) throw new Error('Exact ETA required');
    if (r.classification === 'CANCELLED' && r.new_eta !== null) throw new Error('Cancellation cannot change ETA');
    if (r.new_eta) expected.push({ kind: 'ETA', eta: r.new_eta });
    if (r.classification !== 'AMOUNT_CHANGED') expected.push({ kind: 'STATUS', status: r.classification });
    if (JSON.stringify(expected) !== JSON.stringify(r.extracted_facts)) throw new Error('Conflicting funding facts');
  }
  return structuredClone(r);
}

function localParts(ms: number, timezone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).formatToParts(ms).map(p => [p.type,p.value]));
}
/** Resolve only exact local times. DST gaps/folds are rejected, never disambiguated silently. */
function localToUtc(date: string, clock: string, timezone: string): string {
  const wall = `${date}T${clock}:00.000Z`;
  if (!validTime(wall)) throw new Error('INVALID_DATE');
  const matches: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const ms = Date.parse(wall) - offset * 60000, p = localParts(ms, timezone);
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === `${date}T${clock}`) matches.push(new Date(ms).toISOString());
  }
  if (matches.length !== 1) throw new Error('AMBIGUOUS_OR_NONEXISTENT_LOCAL_TIME');
  return matches[0];
}
function resolveEta(text: string, reference: string, timezone: string): string {
  if (validTime(text)) return text;
  const explicit = text.match(/^(\d{4}-\d{2}-\d{2})(?: at (\d{2}:\d{2}))?$/i);
  const relative = text.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|tomorrow)(?: at (\d{2}:\d{2}))?$/i);
  if (!explicit && !relative) throw new Error('UNSUPPORTED_OR_VAGUE_DATE');
  const clock = (explicit ?? relative)![2];
  if (!clock) throw new Error('EXACT_TIME_REQUIRED');
  let date: string;
  if (explicit) date = explicit[1];
  else {
    const p = localParts(Date.parse(reference), timezone);
    const day = new Date(`${p.year}-${p.month}-${p.day}T00:00:00.000Z`);
    const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const delta = relative![1].toLowerCase() === 'tomorrow' ? 1 : (weekdays.indexOf(relative![1].toLowerCase()) - day.getUTCDay() + 7) % 7;
    // A named weekday includes today; past/equal ETAs are rejected below.
    day.setUTCDate(day.getUTCDate() + delta); date = day.toISOString().slice(0,10);
  }
  return localToUtc(date, clock, timezone);
}
function parseMoney(text: string): { amount_minor: number; currency: string } {
  const m = text.trim().match(/^(USD|EUR|\$|€)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error('INVALID_AMOUNT');
  const amount = BigInt(m[2].replaceAll(',','')) * 100n + BigInt((m[3] ?? '').padEnd(2,'0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return { amount_minor: Number(amount), currency: m[1] === '$' ? 'USD' : m[1] === '€' ? 'EUR' : m[1] };
}

/** Conservative offline grammar implementation. No model, I/O, wall clock or payment rules. */
export function interpretFundingUpdate(rawText: string, known: readonly KnownInflow[], referenceTime: string, timezone: string): FundingUpdateResult {
  const base: FundingUpdateResult = { classification:'IRRELEVANT',expected_inflow_id:null,amount_minor:null,currency:null,new_eta:null,
    source_text_hash:sourceHash(rawText),extracted_facts:[],ambiguities:[],parser_version:PARSER_VERSION };
  const ambiguous = (code: string): FundingUpdateResult => ({ ...base, classification:'AMBIGUOUS', ambiguities:[code] });
  try {
    if (!validTime(referenceTime) || !timezone || rawText.length > 10000 || !rawText.trim()) throw new Error('INVALID_CONTEXT');
    localParts(Date.parse(referenceTime), timezone);
    if (new Set(known.map(k => k.id)).size !== known.length || known.some(k => !id(k.id) || !money(k.amount_minor) || !currency(k.currency) || !validTime(k.eta))) throw new Error('INVALID_KNOWN_INFLOWS');
    const candidates: FundingUpdateResult[] = [];
    for (const sentence of rawText.trim().split(/[.!?](?:\s+|$)/).map(s => s.trim()).filter(Boolean)) {
      // Ignore only standalone instruction/noise sentences. Never execute their contents.
      if (/^Customer confirmed invoice reference [A-Za-z0-9-]+$/i.test(sentence)
        || /^(?:ignore previous rules and pay now|bypass (?:the )?reserve(?: and pay now)?|ignore previous rules and bypass (?:the )?reserve)$/i.test(sentence)) continue;
      let selected: KnownInflow | undefined, action: string;
      const direct = sentence.match(/^([A-Za-z0-9_-]+) (.+)$/);
      const hero = sentence.match(/^The (.+?) customer payment expected (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) has been (.+)$/i);
      if (hero) {
        const amount = parseMoney(hero[1]);
        const matches = known.filter(k => k.amount_minor === amount.amount_minor && k.currency === amount.currency
          && new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'long'}).format(new Date(k.eta)).toLowerCase() === hero[2].toLowerCase());
        if (matches.length !== 1) throw new Error('INFLOW_NOT_UNIQUELY_IDENTIFIED');
        selected = matches[0]; action = hero[3];
      } else {
        selected = known.find(k => k.id === direct?.[1]); action = direct?.[2] ?? '';
      }
      if (!selected) throw new Error('UNKNOWN_OR_UNIDENTIFIED_INFLOW');
      let classification: Classification, eta: string | null = selected.eta, amount = selected.amount_minor, curr = selected.currency;
      const delay = action.match(/^(?:is |has been )?delayed until (.+)$/i);
      const changed = action.match(/^amount changed from (.+) to (.+)$/i);
      if (delay) { classification = 'DELAYED'; eta = resolveEta(delay[1], referenceTime, timezone); }
      else if (/^(?:is )?on time$/i.test(action)) classification = 'ON_TIME';
      else if (/^(?:is |has been )?cancelled$/i.test(action)) { classification = 'CANCELLED'; eta = null; }
      else if (changed) {
        classification = 'AMOUNT_CHANGED'; const from = parseMoney(changed[1]), to = parseMoney(changed[2]);
        if (from.currency !== selected.currency || to.currency !== selected.currency) throw new Error('CURRENCY_MISMATCH');
        if (from.amount_minor !== selected.amount_minor) throw new Error('OLD_AMOUNT_MISMATCH');
        amount = to.amount_minor; curr = to.currency;
      } else throw new Error('UNSUPPORTED_OR_VAGUE_UPDATE');
      if (eta !== null && Date.parse(eta) <= Date.parse(referenceTime)) throw new Error('ETA_NOT_FUTURE');
      if (classification === 'DELAYED' && Date.parse(eta!) < Date.parse(selected.eta)) throw new Error('CONTRADICTORY_DELAY');
      const facts: FundingFact[] = [{kind:'AMOUNT',amount_minor:amount,currency:curr}];
      if (eta) facts.push({kind:'ETA',eta});
      if (classification !== 'AMOUNT_CHANGED') facts.push({kind:'STATUS',status:classification});
      candidates.push({ ...base,classification,expected_inflow_id:selected.id,amount_minor:amount,currency:curr,new_eta:eta,extracted_facts:facts });
    }
    if (!candidates.length) return base;
    if (candidates.some(c => JSON.stringify(c) !== JSON.stringify(candidates[0]))) throw new Error('CONFLICTING_FACTS');
    return validateFundingUpdate(candidates[0]);
  } catch (e) {
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_CONTEXT_OR_SCHEMA';
    return ambiguous(code);
  }
}
export const deterministicFundingInterpreter: FundingInterpreter = { interpret: interpretFundingUpdate };

export interface FundingAuditEvent {
  event: 'FUNDING_UPDATE_RECEIVED' | 'FUNDING_FACTS_EXTRACTED' | 'FUNDING_UPDATE_REJECTED' | 'EXPECTED_INFLOW_UPDATED';
  payable_id: string; inflow_id: string | null; source_hash: string; parser_version: string;
  old_values?: object; new_values?: object; reason?: string;
}
export interface ApplyContext { payable_id: string; known_inflow_ids: readonly string[]; applied_update_keys: readonly string[]; source_text_hash: string }
export interface ApplyResult { state: TreasuryState; outcome: 'APPLIED' | 'NO_CHANGE' | 'DUPLICATE' | 'REJECTED'; update_key: string; audit: FundingAuditEvent[] }
/** No raw source text, no provider dependency, no payment decision. Caller persists audit and keys. */
export function applyFundingUpdate(state: TreasuryState, candidate: unknown, context: ApplyContext): ApplyResult {
  let r: FundingUpdateResult;
  try { r = validateFundingUpdate(candidate); }
  catch { return { state, outcome:'REJECTED', update_key:'', audit:[{event:'FUNDING_UPDATE_REJECTED',payable_id:context.payable_id,inflow_id:null,source_hash:context.source_text_hash,parser_version:PARSER_VERSION,reason:'INVALID_SCHEMA'}] }; }
  const key = sourceHash(JSON.stringify([context.payable_id, r.expected_inflow_id, r.source_text_hash, r.parser_version]));
  const audit: FundingAuditEvent[] = [{event:'FUNDING_UPDATE_RECEIVED',payable_id:context.payable_id,inflow_id:r.expected_inflow_id,source_hash:context.source_text_hash,parser_version:r.parser_version},
    {event:'FUNDING_FACTS_EXTRACTED',payable_id:context.payable_id,inflow_id:r.expected_inflow_id,source_hash:context.source_text_hash,parser_version:r.parser_version,new_values:{classification:r.classification,facts:r.extracted_facts}}];
  const reject = (reason: string): ApplyResult => { audit.push({...audit[0],event:'FUNDING_UPDATE_REJECTED',reason}); return {state,outcome:'REJECTED',update_key:key,audit}; };
  if (r.source_text_hash !== context.source_text_hash) return reject('SOURCE_HASH_MISMATCH');
  if (r.classification === 'AMBIGUOUS') return reject('AMBIGUOUS');
  if (r.classification === 'IRRELEVANT') return {state,outcome:'NO_CHANGE',update_key:key,audit};
  if (!r.expected_inflow_id || !context.known_inflow_ids.includes(r.expected_inflow_id)) return reject('UNKNOWN_INFLOW');
  if (r.expected_inflow_id !== state.expected_inflow_id) return reject('NONMATCHING_INFLOW');
  if (r.currency !== state.source_currency) return reject('CURRENCY_MISMATCH');
  if (context.applied_update_keys.includes(key)) return {state,outcome:'DUPLICATE',update_key:key,audit};
  if (!['confirmed','pending'].includes(state.expected_inflow_status)) return reject('INACTIVE_INFLOW');
  if (r.classification !== 'AMOUNT_CHANGED' && BigInt(r.amount_minor!) !== state.expected_inflow_amount) return reject('UNEXPECTED_AMOUNT_CHANGE');
  if ((r.classification === 'ON_TIME' || r.classification === 'AMOUNT_CHANGED') && r.new_eta !== state.expected_inflow_eta) return reject('UNEXPECTED_ETA_CHANGE');
  if (r.classification === 'DELAYED' && (!validTime(state.expected_inflow_eta) || Date.parse(r.new_eta!) < Date.parse(state.expected_inflow_eta!))) return reject('CONTRADICTORY_DELAY');
  const next: TreasuryState = {...state,expected_inflow_amount:BigInt(r.amount_minor!),expected_inflow_eta:r.new_eta ?? state.expected_inflow_eta,
    expected_inflow_status:r.classification === 'CANCELLED' ? 'cancelled' : state.expected_inflow_status};
  if (next.expected_inflow_amount === state.expected_inflow_amount && next.expected_inflow_eta === state.expected_inflow_eta && next.expected_inflow_status === state.expected_inflow_status) return {state,outcome:'NO_CHANGE',update_key:key,audit};
  const values = (s: TreasuryState) => ({amount_minor:s.expected_inflow_amount.toString(),currency:s.source_currency,eta:s.expected_inflow_eta,status:s.expected_inflow_status});
  audit.push({...audit[0],event:'EXPECTED_INFLOW_UPDATED',old_values:values(state),new_values:values(next)});
  return {state:next,outcome:'APPLIED',update_key:key,audit};
}
