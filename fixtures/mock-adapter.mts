import type {AirwallexAdapter,QuotedFx,ConversionPayload,TransferPayload,TransferResult,ConversionResult} from '../src/airwallex-adapter.mts';
import {minor} from '../src/airwallex-adapter.mts';
export class MockAdapter implements AirwallexAdapter {
  usd = 1000000000n; eur = 1000n; quotes = 0; conversions = 0; transfers = 0; validations = 0;
  failTransfer = false; failConversion = false;
  conversionStatus = 'SETTLED'; lastConversion: ConversionResult | null = null; lastTransfer: TransferResult | null = null;
  quote: QuotedFx = { quote_id: 'synthetic-quote', source_currency: 'USD', target_currency: 'EUR', source_amount: 114n, target_amount: 100n, source_fee_amount: 0n, rate: '1.14', currency_pair: 'EURUSD', valid_from_at: '2026-10-04T15:00:00.000Z', expires_at: '2026-10-04T15:15:00.000Z', conversion_date: '2026-10-04', usage: 'MULTI_USE' };
  async getWalletBalances() { return [{ currency: 'USD', available: this.usd, pending: 0n, total: this.usd }, { currency: 'EUR', available: this.eur, pending: 0n, total: this.eur }]; }
  async createFxQuote() { this.quotes++; return {...structuredClone(this.quote), quote_id: 'synthetic-quote-'+this.quotes}; }
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


