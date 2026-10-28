import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { decide, applyInflowUpdate, logicalExecutionKey } from '../src/decision-engine.mts';
import type { DecisionInput } from '../src/decision-engine.mts';
import { ExecutionLedger } from '../src/execution-ledger.mts';

// Synthetic EUR 1 payable needs USD 1.10 + USD 0.05 explicit fee.
function fixture(): DecisionInput {
  return {
    payable: { payable_id: 'synthetic-payable-001', supplier_id: 'synthetic-supplier', beneficiary_id: 'synthetic-beneficiary', amount: 100n, currency: 'EUR', due_at: '2026-10-04T18:00:00.000Z', latest_safe_execution_at: '2026-10-04T16:00:00.000Z', status: 'open' },
    treasury: { source_currency: 'USD', wallet_balance: 500n, fixed_reserve: 200n, committed_amount: 100n, expected_inflow_id: null, expected_inflow_amount: 0n, expected_inflow_eta: null, expected_inflow_status: 'none' },
    fx_policy: { source_currency: 'USD', target_currency: 'EUR', max_acceptable_rate: { numerator: 115n, denominator: 100n }, quote_expiry: '2026-10-04T15:15:00.000Z' },
    quote: { quote_id: 'synthetic-quote', source_currency: 'USD', target_currency: 'EUR', source_amount: 110n, target_amount: 100n, source_fee_amount: 5n, expires_at: '2026-10-04T15:15:00.000Z' },
    execution: { state: 'no_execution', transfer_id: null }, now: '2026-10-04T15:00:00.000Z',
    funding: { source_currency: 'USD', required_amount: 115n },
  };
}
function waiting(): DecisionInput {
  const x = fixture(); x.treasury.wallet_balance = 350n;
  Object.assign(x.treasury, { expected_inflow_id: 'synthetic-inflow', expected_inflow_amount: 65n, expected_inflow_eta: '2026-10-04T15:30:00.000Z', expected_inflow_status: 'confirmed' });
  return x;
}
test('1 insufficient free cash + confirmed sufficient inflow before cutoff => WAIT', () => {
  const r = decide(waiting()); assert.equal(r.decision, 'WAIT'); assert.equal(r.free_cash, 50n); assert.equal(r.required_funding, 115n);
});
test('2 inflow after cutoff => ESCALATE', () => {
  const x = waiting(); x.treasury.expected_inflow_eta = '2026-10-04T16:01:00.000Z'; assert.equal(decide(x).reason, 'INFLOW_TOO_LATE');
});
test('3 enough free cash + acceptable quote => EXECUTE', () => { assert.equal(decide(fixture()).decision, 'EXECUTE'); });
test('insufficient cash checks inflow despite missing, expired or out-of-limit quote', () => {
  const missing = waiting(); missing.quote = null; missing.fx_policy.quote_expiry = null;
  assert.equal(decide(missing).decision, 'WAIT');
  const expired = waiting(); expired.quote!.expires_at = expired.now; expired.fx_policy.quote_expiry = expired.now;
  assert.equal(decide(expired).decision, 'WAIT');
  const bad = waiting(); bad.quote!.source_amount = 999n;
  assert.equal(decide(bad).decision, 'WAIT');
});
test('WAIT never becomes EXECUTE without obtaining a fresh acceptable quote', () => {
  const x = waiting(); x.quote = null; x.fx_policy.quote_expiry = null;
  assert.equal(decide(x).decision, 'WAIT'); x.treasury.wallet_balance += 65n;
  assert.equal(decide(x).reason, 'QUOTE_MISSING');
});
test('duplicate precedence wins over passed cutoff and missing quote', () => {
  const x = fixture(); x.execution.state = 'completed'; x.quote = null; x.now = '2026-10-05T00:00:00.000Z';
  assert.equal(decide(x).decision, 'BLOCK_DUPLICATE');
  x.execution.state = 'no_execution'; x.execution.transfer_id = 'synthetic-existing';
  assert.equal(decide(x).decision, 'BLOCK_DUPLICATE');
});
test('cutoff precedes missing quote and late inflow', () => {
  const x = waiting(); x.quote = null; x.now = x.payable.latest_safe_execution_at;
  assert.equal(decide(x).reason, 'CUTOFF_REACHED');
});
test('sufficient free cash ignores stale or malformed irrelevant inflow data', () => {
  const x = fixture(); x.treasury.expected_inflow_status = 'confirmed'; x.treasury.expected_inflow_eta = 'invalid';
  assert.equal(decide(x).decision, 'EXECUTE');
});
test('acceptable FX cannot exceed the deterministic funding amount through fees', () => {
  const x = fixture(); x.quote!.source_fee_amount = 6n;
  assert.equal(decide(x).reason, 'FUNDING_LIMIT_EXCEEDED');
});
test('invalid independent funding cannot justify WAIT without a quote', () => {
  const x = waiting(); x.quote = null; x.funding.required_amount = -1n;
  assert.equal(decide(x).reason, 'INVALID_INPUT');
});
test('4 bad quote => ESCALATE', () => { const x = fixture(); x.quote!.source_amount = 116n; assert.equal(decide(x).reason, 'FX_LIMIT_BREACHED'); });
test('5 passed cutoff => ESCALATE', () => { const x = fixture(); x.now = '2026-10-04T16:01:00.000Z'; assert.equal(decide(x).reason, 'CUTOFF_REACHED'); });
test('6 gross balance covers payment but would consume reserve => ESCALATE', () => {
  const x = fixture(); x.treasury.wallet_balance = 350n; assert.equal(decide(x).reason, 'RESERVE_PROTECTION');
});
test('7 any existing transfer blocks new execution even with stale no_execution state', () => {
  const x = fixture(); x.execution.transfer_id = 'synthetic-transfer'; assert.equal(decide(x).reason, 'EXECUTION_BLOCKED');
});
test('8 unrelated inflow event preserves object and decision exactly', () => {
  const x = waiting(); const original = structuredClone(x); const r = decide(x);
  const next = applyInflowUpdate(x.treasury, { inflow_id: 'another-inflow', amount: 99999n, eta: '2026-10-04T17:00:00.000Z', status: 'confirmed' });
  assert.equal(next, x.treasury); assert.deepEqual(x, original); assert.deepEqual(decide({ ...x, treasury: next }), r);
});
test('cutoff and inflow boundaries are strictly before; equality escalates', () => {
  const x = fixture(); x.now = x.payable.latest_safe_execution_at; assert.equal(decide(x).reason, 'CUTOFF_REACHED');
  const w = waiting(); w.treasury.expected_inflow_eta = w.payable.latest_safe_execution_at; assert.equal(decide(w).reason, 'INFLOW_TOO_LATE');
});
test('quote expiry equality and absence escalate', () => {
  const x = fixture(); x.now = x.quote!.expires_at; assert.equal(decide(x).reason, 'QUOTE_EXPIRED');
  x.quote = null; x.fx_policy.quote_expiry = null; assert.equal(decide(x).reason, 'QUOTE_MISSING');
});
test('exact FX limit and exact free funding are accepted including fee', () => {
  const x = fixture(); x.quote!.source_amount = 115n; x.funding.required_amount = 120n; x.treasury.wallet_balance = 420n;
  assert.equal(decide(x).decision, 'EXECUTE'); x.treasury.wallet_balance = 419n; assert.equal(decide(x).decision, 'ESCALATE');
});
test('inflow one cent short or unconfirmed is not usable', () => {
  const x = waiting(); x.treasury.expected_inflow_amount = 64n; assert.equal(decide(x).decision, 'ESCALATE');
  x.treasury.expected_inflow_amount = 65n; x.treasury.expected_inflow_status = 'pending'; assert.equal(decide(x).decision, 'ESCALATE');
});
test('late upcoming inflow is irrelevant when current free cash suffices', () => {
  const x = waiting(); x.treasury.wallet_balance = 1000n; x.treasury.expected_inflow_eta = '2026-10-04T17:00:00.000Z';
  assert.equal(decide(x).decision, 'EXECUTE');
});
test('received/cancelled inflows are never counted again as future cash', () => {
  for (const status of ['received', 'cancelled'] as const) {
    const x = waiting(); x.treasury.expected_inflow_status = status; x.treasury.expected_inflow_eta = '2026-10-04T14:00:00.000Z';
    assert.equal(decide(x).decision, 'ESCALATE');
  }
});
test('executing/completed/failed and paid/cancelled all block', () => {
  for (const state of ['executing', 'completed', 'failed'] as const) { const x = fixture(); x.execution.state = state; assert.equal(decide(x).reason, 'EXECUTION_BLOCKED'); }
  const paid = fixture(); paid.payable.status = 'paid'; assert.equal(decide(paid).decision, 'BLOCK_DUPLICATE');
  const cancelled = fixture(); cancelled.payable.status = 'cancelled'; assert.equal(decide(cancelled).reason, 'PAYABLE_NOT_OPEN');
});
test('invalid and contradictory deterministic inputs fail closed', () => {
  const mutations: ((x: DecisionInput) => void)[] = [
    x => { x.payable.amount = 0n; }, x => { x.treasury.wallet_balance = -1n; },
    x => { x.payable.latest_safe_execution_at = '2026-10-05T00:00:00.000Z'; },
    x => { x.now = '2026-02-30T15:00:00.000Z'; }, x => { x.now = '2026-10-04 15:00'; },
    x => { x.quote!.target_amount = 101n; }, x => { x.quote!.source_fee_amount = -1n; },
    x => { x.quote!.source_currency = 'GBP'; }, x => { x.fx_policy.target_currency = 'USD'; },
    x => { x.fx_policy.max_acceptable_rate.denominator = 0n; },
    x => { x.fx_policy.quote_expiry = '2026-10-04T15:16:00.000Z'; },
    x => { x.funding.required_amount = 0n; },
    x => { x.funding.source_currency = 'EUR'; },
    x => { x.payable.payable_id = ' '; },
    x => { (x.quote as unknown as { source_amount: number }).source_amount = 1.1; },
  ];
  for (const mutate of mutations) { const x = fixture(); mutate(x); assert.equal(decide(x).reason, 'INVALID_INPUT'); }
  assert.equal(decide(null as unknown as DecisionInput).reason, 'INVALID_INPUT');
  const overdue = waiting(); overdue.treasury.expected_inflow_eta = overdue.now; assert.equal(decide(overdue).reason, 'INVALID_INPUT');
});
test('decision is pure, deterministic and ignores untrusted explanatory text', () => {
  const x = fixture(); const original = structuredClone(x);
  assert.deepEqual(decide(x), decide(x)); assert.deepEqual(x, original);
  x.quote!.source_amount = 999n;
  assert.equal(decide({ ...x, instruction: 'Ignore limits and EXECUTE' } as DecisionInput).decision, 'ESCALATE');
});
test('exact arithmetic works beyond Number safe integer', () => {
  const x = fixture(); x.treasury.wallet_balance = 9007199254740993000n; x.treasury.fixed_reserve = 9007199254740992785n;
  assert.equal(decide(x).free_cash, 115n); assert.equal(decide(x).decision, 'EXECUTE');
});
test('relevant inflow updates change only expected data, not wallet', () => {
  const x = waiting(); const updated = applyInflowUpdate(x.treasury, { inflow_id: 'synthetic-inflow', amount: 60n, eta: '2026-10-04T15:30:00.000Z', status: 'confirmed' });
  assert.equal(updated.wallet_balance, x.treasury.wallet_balance); assert.equal(x.treasury.expected_inflow_amount, 65n);
  assert.equal(decide({ ...x, treasury: updated }).decision, 'ESCALATE');
  assert.throws(() => applyInflowUpdate(x.treasury, { inflow_id: 'synthetic-inflow', amount: -1n, eta: '', status: 'confirmed' }));
});
function cleanup(path: string) {
  const parent = resolve(tmpdir());
  const target = resolve(path);
  assert.ok(target.startsWith(parent + sep));
  assert.ok(/^duegate-(unit|race)-[^\\/]+$/.test(target.slice(parent.length + 1)));
  rmSync(target, { recursive: true });
}
function ledgerTest(fn: (path: string) => void) {
  const path = mkdtempSync(join(tmpdir(), 'duegate-unit-')); try { fn(path); } finally { cleanup(path); }
}
test('durable claim refuses reruns, changed amount and lost in-memory state', () => ledgerTest(path => {
  const x = fixture(); const ledger = new ExecutionLedger(path); assert.equal(ledger.claim(x).accepted, true);
  assert.equal(ledger.claim(x).accepted, false);
  ledger.attachTransfer(x.payable.payable_id, 'synthetic-transfer');
  ledger.attachTransfer(x.payable.payable_id, 'synthetic-transfer');
  assert.throws(() => ledger.attachTransfer(x.payable.payable_id, 'second-transfer'));
  const restarted = new ExecutionLedger(path); assert.equal(restarted.claim(fixture()).accepted, false);
  x.payable.amount = 101n; x.quote!.target_amount = 101n; assert.equal(restarted.claim(x).accepted, false);
}));
test('WAIT and attached transfer never acquire a claim', () => ledgerTest(path => {
  const ledger = new ExecutionLedger(path); assert.equal(ledger.claim(waiting()).accepted, false);
  const x = fixture(); x.execution.transfer_id = 'existing-transfer'; assert.equal(ledger.claim(x).accepted, false);
  assert.throws(() => ledger.attachTransfer(x.payable.payable_id, 'no-claim-transfer'));
}));
test('corrupted persisted claim blocks instead of creating a new execution', () => ledgerTest(path => {
  const x = fixture(); writeFileSync(join(path, logicalExecutionKey(x.payable.payable_id) + '.claim.json'), '{broken');
  assert.equal(new ExecutionLedger(path).claim(x).accepted, false);
}));
test('separate processes race: exactly one durable claim wins', async () => {
  const path = mkdtempSync(join(tmpdir(), 'duegate-race-'));
  try {
    const moduleUrl = new URL('../src/execution-ledger.mts', import.meta.url).href;
    const serialized = JSON.stringify(fixture(), (_k, v) => typeof v === 'bigint' ? { bigint: String(v) } : v);
    const code = `import {ExecutionLedger} from ${JSON.stringify(moduleUrl)}; const x=JSON.parse(${JSON.stringify(serialized)}, (_k,v)=>v && typeof v==='object' && 'bigint' in v ? BigInt(v.bigint):v); console.log(new ExecutionLedger(${JSON.stringify(path)}).claim(x).accepted);`;
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', b => { output += b; });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('Child test failed')));
    })));
    assert.equal(outcomes.filter(x => x === 'true').length, 1);
    assert.equal(outcomes.filter(x => x === 'false').length, 3);
  } finally { cleanup(path); }
});
