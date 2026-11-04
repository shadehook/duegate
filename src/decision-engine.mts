import { createHash } from 'node:crypto';
import { validateWindow } from './temporal.mts';
import type { EtaWindow } from './temporal.mts';

/** All money is integer minor units (USD/EUR cents). No floating-point money. */
export interface Payable {
  payable_id: string;
  supplier_id: string;
  beneficiary_id: string;
  amount: bigint;
  currency: string;
  due_at: string;
  latest_safe_execution_at: string;
  status: 'open' | 'paid' | 'cancelled';
}
export interface TreasuryState {
  source_currency: string;
  wallet_balance: bigint;
  fixed_reserve: bigint;
  committed_amount: bigint; // Other obligations only; excludes this payable.
  expected_inflow_id: string | null;
  expected_inflow_amount: bigint;
  expected_inflow_eta: string | null;
  expected_inflow_eta_window?: EtaWindow | null;
  expected_inflow_status: 'none' | 'confirmed' | 'pending' | 'received' | 'cancelled';
}
export interface FxPolicy {
  source_currency: string;
  target_currency: string;
  /** Maximum source minor units per target minor unit, as an exact ratio. */
  max_acceptable_rate: { numerator: bigint; denominator: bigint };
  quote_expiry: string | null;
}
export interface FxQuote {
  quote_id: string;
  source_currency: string;
  target_currency: string;
  source_amount: bigint;
  target_amount: bigint;
  source_fee_amount: bigint; // Explicit verified fee, including explicit zero.
  expires_at: string;
}
export interface ExecutionState {
  state: 'no_execution' | 'executing' | 'completed' | 'failed';
  transfer_id: string | null;
}
import type {Decision} from './approval-types.d.mts';
export type {Decision} from './approval-types.d.mts';
export type Reason = 'INVALID_INPUT' | 'EXECUTION_BLOCKED' | 'PAYABLE_NOT_OPEN'
  | 'CUTOFF_REACHED' | 'QUOTE_MISSING' | 'QUOTE_EXPIRED' | 'FX_LIMIT_BREACHED'
  | 'INFLOW_TOO_LATE' | 'AWAIT_CONFIRMED_INFLOW' | 'RESERVE_PROTECTION'
  | 'INSUFFICIENT_FUNDING' | 'FUNDING_LIMIT_EXCEEDED' | 'READY' | 'INFLOW_ETA_UNCERTAIN';
/** Verified source-currency funding budget, including fees; independent of quote. */
export interface FundingRequirement { source_currency: string; required_amount: bigint }
export interface DecisionInput {
  payable: Payable;
  treasury: TreasuryState;
  fx_policy: FxPolicy;
  quote: FxQuote | null;
  execution: ExecutionState;
  funding: FundingRequirement;
  now: string; // Injected clock; never reads wall-clock time.
}
export interface DecisionResult {
  decision: Decision;
  reason: Reason;
  execution_key: string | null;
  free_cash: bigint | null;
  required_funding: bigint | null;
}
const id = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 200 && s.trim() === s;
const money = (n: unknown): n is bigint => typeof n === 'bigint' && n >= 0n;
const currency = (s: unknown): s is string => typeof s === 'string' && /^[A-Z]{3}$/.test(s);
/** Strict canonical UTC timestamps; impossible calendar dates fail round-trip. */
function time(s: unknown): number {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) throw new Error('invalid time');
  const n = Date.parse(s);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== s) throw new Error('invalid time');
  return n;
}
export function logicalExecutionKey(payableId: string): string {
  if (!id(payableId)) throw new Error('Invalid payable identity');
  return 'duegate-v1-' + createHash('sha256').update(JSON.stringify(['duegate-payable-v1', payableId])).digest('hex');
}
export function decide(input: DecisionInput): DecisionResult {
  let key: string | null = null, free: bigint | null = null, required: bigint | null = null;
  const result = (decision: Decision, reason: Reason): DecisionResult => ({ decision, reason, execution_key: key, free_cash: free, required_funding: required });
  try {
    const { payable: p, treasury: t, fx_policy: f, execution: e, quote: q } = input;
    if (!id(p.payable_id)) throw new Error();
    key = logicalExecutionKey(p.payable_id);
    if (!['no_execution', 'executing', 'completed', 'failed'].includes(e.state) || (e.transfer_id !== null && !id(e.transfer_id))) throw new Error();
    if (e.transfer_id !== null || e.state === 'completed' || p.status === 'paid') return result('BLOCK_DUPLICATE', 'EXECUTION_BLOCKED');
    if (![p.payable_id, p.supplier_id, p.beneficiary_id].every(id) || !money(p.amount) || p.amount === 0n || !currency(p.currency)) throw new Error();
    const now = time(input.now), cutoff = time(p.latest_safe_execution_at), due = time(p.due_at);
    if (cutoff > due || !['open', 'paid', 'cancelled'].includes(p.status)) throw new Error();
    if (now >= cutoff) return result('ESCALATE', 'CUTOFF_REACHED');
    if (e.state !== 'no_execution') return result('ESCALATE', 'EXECUTION_BLOCKED');
    if (p.status !== 'open') return result('ESCALATE', 'PAYABLE_NOT_OPEN');
    if (![t.wallet_balance, t.fixed_reserve, t.committed_amount].every(money)) throw new Error();
    if (!currency(input.funding.source_currency) || input.funding.source_currency !== t.source_currency
      || !money(input.funding.required_amount) || input.funding.required_amount === 0n) throw new Error();
    required = input.funding.required_amount;
    free = t.wallet_balance - t.fixed_reserve - t.committed_amount;
    if (free >= required) {
      if (!currency(t.source_currency) || !currency(f.source_currency) || !currency(f.target_currency)
        || t.source_currency !== f.source_currency || p.currency !== f.target_currency) throw new Error();
      if (!money(f.max_acceptable_rate.numerator) || f.max_acceptable_rate.numerator === 0n
        || !money(f.max_acceptable_rate.denominator) || f.max_acceptable_rate.denominator === 0n) throw new Error();
      if (q === null) {
        return result('ESCALATE', 'QUOTE_MISSING');
      }
      if (!id(q.quote_id) || q.source_currency !== f.source_currency || q.target_currency !== f.target_currency
        || !money(q.source_amount) || q.source_amount === 0n || !money(q.target_amount) || q.target_amount !== p.amount
        || !money(q.source_fee_amount)) throw new Error();
      const expiry = time(q.expires_at);
      if (time(f.quote_expiry) !== expiry) throw new Error();
      if (now >= expiry) return result('ESCALATE', 'QUOTE_EXPIRED');
      if (q.source_amount * f.max_acceptable_rate.denominator > q.target_amount * f.max_acceptable_rate.numerator)
        return result('ESCALATE', 'FX_LIMIT_BREACHED');
      if (q.source_amount + q.source_fee_amount > required) return result('ESCALATE', 'FUNDING_LIMIT_EXCEEDED');
      return result('EXECUTE', 'READY');
    }
    // Cash is insufficient: quote eligibility does not control WAIT.
    if (!money(t.expected_inflow_amount) || !['none', 'confirmed', 'pending', 'received', 'cancelled'].includes(t.expected_inflow_status)) throw new Error();
    if (t.expected_inflow_status === 'none') {
      if (t.expected_inflow_id !== null || t.expected_inflow_eta !== null || t.expected_inflow_amount !== 0n) throw new Error();
    } else if (t.expected_inflow_status === 'confirmed') {
      if (!id(t.expected_inflow_id) || t.expected_inflow_amount === 0n) throw new Error();
      if (t.expected_inflow_eta_window) {
        if (t.expected_inflow_eta !== null) throw new Error();
        validateWindow(t.expected_inflow_eta_window);
        const start=time(t.expected_inflow_eta_window.start), end=time(t.expected_inflow_eta_window.end);
        if(start>=cutoff) return result('ESCALATE','INFLOW_TOO_LATE');
        if(start<=now || end>cutoff) return result('ESCALATE','INFLOW_ETA_UNCERTAIN');
      } else {
        const eta = time(t.expected_inflow_eta);
        if (eta <= now) throw new Error();
        if (eta >= cutoff) return result('ESCALATE', 'INFLOW_TOO_LATE');
      }
      if (free + t.expected_inflow_amount >= required) return result('WAIT', 'AWAIT_CONFIRMED_INFLOW');
    }
    if (t.wallet_balance - t.committed_amount >= required) return result('ESCALATE', 'RESERVE_PROTECTION');
    return result('ESCALATE', 'INSUFFICIENT_FUNDING');
  } catch { return result('ESCALATE', 'INVALID_INPUT'); }
}

export interface InflowUpdate {
  inflow_id: string;
  amount: bigint;
  eta: string;
  status: Exclude<TreasuryState['expected_inflow_status'], 'none'>;
}
/** Events for another inflow have no effect, including object identity. */
export function applyInflowUpdate(state: TreasuryState, update: InflowUpdate): TreasuryState {
  if (update.inflow_id !== state.expected_inflow_id) return state;
  if (!money(update.amount) || update.amount === 0n || !['confirmed', 'pending', 'received', 'cancelled'].includes(update.status)) throw new Error('Invalid inflow update');
  time(update.eta);
  const next = { ...state, ...(state.expected_inflow_eta_window ? {expected_inflow_eta_window:null} : {}), expected_inflow_amount: update.amount, expected_inflow_eta: update.eta, expected_inflow_status: update.status };
  if (next.expected_inflow_amount === state.expected_inflow_amount && next.expected_inflow_eta === state.expected_inflow_eta && next.expected_inflow_status === state.expected_inflow_status) return state;
  // Receiving an event never credits wallet cash. A verified wallet snapshot must do that.
  return next;
}
