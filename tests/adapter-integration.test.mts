import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { DecisionInput } from '../src/decision-engine.mts';
import { logicalExecutionKey } from '../src/decision-engine.mts';
import type { AirwallexAdapter, QuotedFx, ConversionPayload, TransferPayload, TransferResult, ConversionResult } from '../src/airwallex-adapter.mts';
import { minor, major } from '../src/airwallex-adapter.mts';
import { AirwallexSandbox } from '../src/airwallex-sandbox.mts';
import { ExecutionLedger } from '../src/execution-ledger.mts';
import { ExecutionController, providerId } from '../src/execution-controller.mts';

function fixture(): DecisionInput {
  return {
    payable: { payable_id: 'duegate-phase7-synthetic-eur-001', supplier_id: 'synthetic-supplier', beneficiary_id: 'synthetic-DE', amount: 100n, currency: 'EUR', status: 'open', due_at: '2026-10-04T18:00:00.000Z', latest_safe_execution_at: '2026-10-04T16:00:00.000Z' },
    treasury: { source_currency: 'USD', wallet_balance: 0n, fixed_reserve: 200n, committed_amount: 100n, expected_inflow_id: 'synthetic-inflow', expected_inflow_amount: 200n, expected_inflow_eta: '2026-10-04T15:30:00.000Z', expected_inflow_status: 'confirmed' },
    fx_policy: { source_currency: 'USD', target_currency: 'EUR', max_acceptable_rate: { numerator: 150n, denominator: 100n }, quote_expiry: null },
    funding: { source_currency: 'USD', required_amount: 200n }, quote: null, execution: { state: 'no_execution', transfer_id: null }, now: '2026-10-04T15:00:00.000Z',
  };
}
class MockAdapter implements AirwallexAdapter {
  usd = 1000n; eur = 1000n; quotes = 0; conversions = 0; transfers = 0; validations = 0;
  failTransfer = false; failConversion = false;
  conversionStatus = 'SETTLED'; lastConversion: ConversionResult | null = null; lastTransfer: TransferResult | null = null;
  quote: QuotedFx = { quote_id: 'synthetic-quote', source_currency: 'USD', target_currency: 'EUR', source_amount: 114n, target_amount: 100n, source_fee_amount: 0n, rate: '1.14', currency_pair: 'EURUSD', valid_from_at: '2026-10-04T15:00:00.000Z', expires_at: '2026-10-04T15:15:00.000Z', conversion_date: '2026-10-04', usage: 'MULTI_USE' };
  async getWalletBalances() { return [{ currency: 'USD', available: this.usd, pending: 0n, total: this.usd }, { currency: 'EUR', available: this.eur, pending: 0n, total: this.eur }]; }
  async createFxQuote() { this.quotes++; return structuredClone(this.quote); }
  async getRelevantBeneficiary(id: string) { return { id, currency: 'EUR', country: 'DE', transfer_methods: ['LOCAL'] }; }
  async validateTransfer() { this.validations++; }
  async createConversion(p: ConversionPayload) {
    this.conversions++; if (this.failConversion) throw new Error('Synthetic ambiguous conversion');
    this.usd -= this.quote.source_amount; this.eur += this.quote.target_amount;
    this.lastConversion = { id: 'synthetic-conversion', status: this.conversionStatus, request_id: p.request_id, quote_id: p.quote_id, source_amount: this.quote.source_amount, target_amount: this.quote.target_amount };
    return structuredClone(this.lastConversion);
  }
  async createTransfer(p: TransferPayload): Promise<TransferResult> {
    this.transfers++; this.eur -= minor(p.transfer_amount); if (this.failTransfer) throw new Error('Synthetic ambiguous transfer');
    this.lastTransfer = { id: 'synthetic-transfer', status: 'PROCESSING', request_id: p.request_id, amount: minor(p.transfer_amount), currency: p.transfer_currency, fee_amount: 0n, fee_currency: 'EUR' };
    return structuredClone(this.lastTransfer);
  }
  async getTransfer(): Promise<TransferResult> { if (!this.lastTransfer) throw new Error('Missing mock transfer'); return structuredClone(this.lastTransfer); }
  async getConversion(): Promise<ConversionResult> { if (!this.lastConversion) throw new Error('Missing mock conversion'); return structuredClone(this.lastConversion); }
}
async function setup(fn: (adapter: MockAdapter, ledger: ExecutionLedger, controller: ExecutionController, setTime: (s: string) => void, dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'duegate-integration-')); const a = new MockAdapter(); const ledger = new ExecutionLedger(dir);
  let time = fixture().now; const c = new ExecutionController(a, ledger, () => time);
  try { await fn(a, ledger, c, s => { time = s; }, dir); }
  finally { const root = resolve(tmpdir()); const target = resolve(dir); assert.ok(target.startsWith(root + sep) && target.slice(root.length + 1).startsWith('duegate-integration-')); rmSync(target, { recursive: true }); }
}
const zeroWrites = (a: MockAdapter) => { assert.equal(a.conversions, 0); assert.equal(a.transfers, 0); };
test('guard 1: WAIT requests no quote or financial writes and cannot prepare', () => setup(async (a, _l, c) => {
  a.usd = 350n; const e = await c.evaluate(fixture()); assert.equal(e.input.treasury.wallet_balance, 350n); assert.equal(e.decision.decision, 'WAIT'); assert.equal(a.quotes, 0);
  await assert.rejects(c.prepare(e)); zeroWrites(a);
}));
test('guard 2: only ETA changes WAIT to ESCALATE; no financial calls', () => setup(async (a, _l, c) => {
  a.usd = 350n; const input = fixture(); assert.equal((await c.evaluate(input)).decision.decision, 'WAIT');
  input.treasury.expected_inflow_eta = '2026-10-04T17:00:00.000Z'; const e = await c.evaluate(input);
  assert.equal(e.decision.reason, 'INFLOW_TOO_LATE'); assert.equal(a.quotes, 0); await assert.rejects(c.prepare(e)); zeroWrites(a);
}));
test('guard 3: expired claimed quote cannot execute', () => setup(async (a, _l, c, setTime) => {
  const p = await c.prepare(await c.evaluate(fixture())); setTime(a.quote.expires_at); await assert.rejects(c.executeApproved(p, p.digest)); zeroWrites(a);
}));
test('guard 4: excessive quote blocks preview and execution', () => setup(async (a, _l, c) => {
  a.quote.source_amount = 151n; const e = await c.evaluate(fixture()); assert.equal(e.decision.reason, 'FX_LIMIT_BREACHED'); await assert.rejects(c.prepare(e)); zeroWrites(a);
}));
test('guard 5: cutoff after claim blocks execution', () => setup(async (a, _l, c, setTime) => {
  const p = await c.prepare(await c.evaluate(fixture())); setTime(fixture().payable.latest_safe_execution_at); await assert.rejects(c.executeApproved(p, p.digest)); zeroWrites(a);
}));
test('guard 6: actual cash reduction threatens reserve and blocks execution', () => setup(async (a, _l, c) => {
  const p = await c.prepare(await c.evaluate(fixture())); a.usd = 350n; await assert.rejects(c.executeApproved(p, p.digest)); zeroWrites(a);
}));
test('guard 7: an existing claim blocks another preview and quote', () => setup(async (a, _l, c) => {
  const e = await c.evaluate(fixture()); await c.prepare(e); const quoteCount = a.quotes;
  await assert.rejects(c.prepare(e)); assert.notEqual((await c.evaluate(fixture())).decision.decision, 'EXECUTE'); assert.equal(a.quotes, quoteCount); zeroWrites(a);
}));
test('guard 8: attached transfer blocks future submission', () => setup(async (a, l, c) => {
  const p = await c.prepare(await c.evaluate(fixture())); l.attachTransfer(fixture().payable.payable_id, 'synthetic-existing');
  await assert.rejects(c.executeApproved(p, p.digest)); zeroWrites(a);
}));
test('guard 9: payload mutation after claim/approval is rejected', () => setup(async (a, _l, c) => {
  const p = await c.prepare(await c.evaluate(fixture())); p.prepared.transfer.transfer_amount = '2.00'; await assert.rejects(c.executeApproved(p, p.digest)); zeroWrites(a);
}));
test('guard 10: restart cannot cause second conversion/transfer', () => setup(async (a, _l, c, _t, dir) => {
  const p = await c.prepare(await c.evaluate(fixture())); await c.executeApproved(p, p.digest);
  const restarted = new ExecutionController(a, new ExecutionLedger(dir), () => fixture().now);
  await assert.rejects(restarted.executeApproved(p, p.digest)); assert.equal(a.conversions, 1); assert.equal(a.transfers, 1);
}));
test('preview is persistent and complete; preparing has zero financial writes', () => setup(async (a, l, c) => {
  const p = await c.prepare(await c.evaluate(fixture())); assert.equal(p.prepared.decision, 'EXECUTE'); assert.equal(p.prepared.raw_balance.available, 1000n);
  assert.equal(p.prepared.conversion.buy_amount, '1.00'); assert.equal(p.prepared.transfer.transfer_amount, '1.00');
  assert.notEqual(p.prepared.conversion.request_id, p.prepared.transfer.request_id); assert.match(p.prepared.conversion.request_id, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(l.readPreparation(fixture().payable.payable_id).digest, p.digest); zeroWrites(a);
}));
test('claim binds disk payload against persisted mutation', () => setup(async (a, _l, c, _t, dir) => {
  const p = await c.prepare(await c.evaluate(fixture())); writeFileSync(join(dir, logicalExecutionKey(fixture().payable.payable_id) + '.preview.json'), JSON.stringify({ digest: p.digest, body: '{}' }));
  await assert.rejects(c.executeApproved(p, p.digest)); zeroWrites(a);
}));
test('ambiguous conversion failure never retries or submits transfer after restart', () => setup(async (a, _l, c, _t, dir) => {
  const p = await c.prepare(await c.evaluate(fixture())); a.failConversion = true; await assert.rejects(c.executeApproved(p, p.digest));
  await assert.rejects(new ExecutionController(a, new ExecutionLedger(dir), () => fixture().now).executeApproved(p, p.digest));
  assert.equal(a.conversions, 1); assert.equal(a.transfers, 0);
}));
test('ambiguous transfer failure never creates a second transfer', () => setup(async (a, _l, c, _t, dir) => {
  const p = await c.prepare(await c.evaluate(fixture())); a.failTransfer = true; await assert.rejects(c.executeApproved(p, p.digest));
  await assert.rejects(new ExecutionController(a, new ExecutionLedger(dir), () => fixture().now).executeApproved(p, p.digest));
  assert.equal(a.conversions, 1); assert.equal(a.transfers, 1);
}));
test('real adapter defaults to rejecting financial writes before any HTTP', () => setup(async (_a, _l, _c, _t, dir) => {
  const file = join(dir, '.env'); writeFileSync(file, 'AIRWALLEX_CLIENT_ID=synthetic\nAIRWALLEX_API_KEY=synthetic\n');
  const adapter = new AirwallexSandbox(file);
  await assert.rejects(adapter.createConversion({} as ConversionPayload), /FINANCIAL_WRITES_DISABLED/);
  await assert.rejects(adapter.createTransfer({} as TransferPayload), /FINANCIAL_WRITES_DISABLED/); assert.equal(adapter.calls.length, 0);
}));
test('major/minor mapping is exact and rejects excessive precision', () => {
  assert.equal(minor('9999990.01'), 999999001n); assert.equal(major(999999001n), '9999990.01'); assert.throws(() => minor('1.001'));
});
test('provider UUIDs are stable per payable and separated by operation', () => {
  const key = logicalExecutionKey('synthetic-payable');
  assert.equal(providerId(key, 'transfer'), providerId(key, 'transfer'));
  assert.notEqual(providerId(key, 'transfer'), providerId(key, 'conversion'));
  assert.notEqual(providerId(key, 'transfer'), providerId(logicalExecutionKey('other-payable'), 'transfer'));
});
test('quote expiry during final balance read blocks conversion', () => setup(async (a, _l, c, setTime) => {
  const p = await c.prepare(await c.evaluate(fixture()));
  const original = a.getWalletBalances.bind(a); let reads = 0;
  a.getWalletBalances = async () => { if (++reads === 2) setTime(a.quote.expires_at); return original(); };
  await assert.rejects(c.executeApproved(p, p.digest), /Final pre-conversion gate blocked/); zeroWrites(a);
}));
test('Phase 8 continues the same claim with fresh quote and blocks restart without provider calls', () => setup(async (a, l, c, _t, dir) => {
  const old = await c.prepare(await c.evaluate(fixture()));
  const claimFile = join(dir, old.prepared.logical_execution_key + '.claim.json'); const originalClaim = readFileSync(claimFile, 'utf8');
  a.quote.quote_id = 'synthetic-fresh';
  const result = await c.continuePrepared(fixture().payable.payable_id); assert.equal(result.decision, 'EXECUTE');
  assert.equal(readFileSync(claimFile, 'utf8'), originalClaim); assert.equal(readdirSync(dir).filter(n => n.endsWith('.claim.json')).length, 1);
  assert.equal(a.lastTransfer!.request_id, old.prepared.transfer.request_id); assert.equal(a.lastConversion!.request_id, old.prepared.conversion.request_id);
  assert.equal(a.lastConversion!.quote_id, 'synthetic-fresh'); assert.equal(l.continuationState(fixture().payable.payable_id), 'TRANSFER_ATTACHED');
  const q = a.quotes; a.getWalletBalances = async () => { throw new Error('Duplicate must not read provider'); };
  const result2 = await new ExecutionController(a, new ExecutionLedger(dir), () => fixture().now).continuePrepared(fixture().payable.payable_id);
  assert.equal(result2.decision, 'BLOCK_DUPLICATE'); assert.equal(a.quotes, q); assert.equal(a.conversions, 1); assert.equal(a.transfers, 1);
  const events = readFileSync(join(dir, old.prepared.logical_execution_key + '.audit.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s).event);
  for (const event of ['PAYABLE_EVALUATED', 'EXECUTE_PROPOSED', 'QUOTE_CREATED', 'EXECUTE_RECONFIRMED', 'EXECUTION_LOCKED', 'CONVERSION_CREATED', 'CONVERSION_SETTLED', 'TRANSFER_CREATED', 'TRANSFER_STATUS_OBSERVED', 'BALANCE_RECONCILED', 'DUPLICATE_EXECUTION_BLOCKED']) assert.ok(events.includes(event));
}));
test('Phase 8 expired original quote can refresh before cutoff', () => setup(async (a, _l, c, time) => {
  await c.prepare(await c.evaluate(fixture())); time('2026-10-04T15:16:00.000Z');
  a.quote.quote_id = 'new-quote'; a.quote.expires_at = '2026-10-04T15:31:00.000Z';
  assert.equal((await c.continuePrepared(fixture().payable.payable_id)).decision, 'EXECUTE');
}));
test('Phase 8 passed cutoff stops before quote and never replaces claim', () => setup(async (a, l, c, time) => {
  await c.prepare(await c.evaluate(fixture())); const q = a.quotes; time(fixture().payable.latest_safe_execution_at);
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /cutoff/); assert.equal(a.quotes, q); zeroWrites(a); assert.equal(l.continuationState(fixture().payable.payable_id), 'PREPARED');
}));
test('Phase 8 corrupt original identity stops without writes', () => setup(async (a, _l, c, _t, dir) => {
  const p = await c.prepare(await c.evaluate(fixture())); const file = join(dir, p.prepared.logical_execution_key + '.claim.json');
  const data = JSON.parse(readFileSync(file, 'utf8')); data.amount = '200'; writeFileSync(file, JSON.stringify(data));
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /claim mismatch/); zeroWrites(a);
}));
test('Phase 8 cannot reuse the old quote', () => setup(async (a, _l, c) => {
  await c.prepare(await c.evaluate(fixture())); await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /new and valid/); zeroWrites(a);
}));
test('Phase 8 unacceptable fresh quote cannot lock or move money', () => setup(async (a, l, c) => {
  await c.prepare(await c.evaluate(fixture())); a.quote.quote_id = 'fresh-bad'; a.quote.source_amount = 151n;
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /Fresh quote gate blocked/); zeroWrites(a); assert.equal(l.continuationState(fixture().payable.payable_id), 'PREPARED');
}));
test('Phase 8 unsettled conversion persists ID and blocks transfer/restart', () => setup(async (a, l, c, _t, dir) => {
  await c.prepare(await c.evaluate(fixture())); a.quote.quote_id = 'fresh'; a.conversionStatus = 'SCHEDULED';
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /review/);
  const stored = JSON.parse(readFileSync(join(dir, logicalExecutionKey(fixture().payable.payable_id) + '.conversion.json'), 'utf8'));
  assert.equal(stored.conversion_id, 'synthetic-conversion'); assert.equal(stored.status, 'SCHEDULED'); assert.equal(l.continuationState(fixture().payable.payable_id), 'REVIEW');
  assert.equal((await c.continuePrepared(fixture().payable.payable_id)).decision, 'BLOCK_DUPLICATE'); assert.equal(a.conversions, 1); assert.equal(a.transfers, 0);
}));
test('Phase 8 ambiguous transfer cannot be submitted again after restart', () => setup(async (a, _l, c, _t, dir) => {
  await c.prepare(await c.evaluate(fixture())); a.quote.quote_id = 'fresh'; a.failTransfer = true;
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /review/);
  assert.equal((await new ExecutionController(a, new ExecutionLedger(dir), () => fixture().now).continuePrepared(fixture().payable.payable_id)).decision, 'BLOCK_DUPLICATE');
  assert.equal(a.conversions, 1); assert.equal(a.transfers, 1);
}));
test('Phase 8 fingerprint tampering after conversion blocks transfer', () => setup(async (a, _l, c, _t, dir) => {
  await c.prepare(await c.evaluate(fixture())); a.quote.quote_id = 'fresh';
  const original = a.getConversion.bind(a); a.getConversion = async () => {
    const file = join(dir, logicalExecutionKey(fixture().payable.payable_id) + '.submission.json');
    const locked = JSON.parse(readFileSync(file, 'utf8')); locked.body += ' '; writeFileSync(file, JSON.stringify(locked)); return original();
  };
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /review/); assert.equal(a.conversions, 1); assert.equal(a.transfers, 0);
}));
test('Phase 8 missing claim cannot create a replacement', () => setup(async (a, l, c) => {
  await assert.rejects(c.continuePrepared(fixture().payable.payable_id), /No prepared claim/); assert.equal(l.hasClaim(fixture().payable.payable_id), false); zeroWrites(a);
}));
