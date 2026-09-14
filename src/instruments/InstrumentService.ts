// ================================================================
// BreakoutEx AI - Instrument & Option Chain Service
// Resolves contract specifications, dynamic lot sizes, ATM strikes
// ================================================================

import { Instrument } from '../brokers/core/BrokerTypes';

export class InstrumentService {
    private static instance: InstrumentService;
    private instruments: Map<string, Instrument> = new Map(); // key: tradingsymbol
    private tokenMap: Map<string | number, Instrument> = new Map(); // key: instrumentToken
    private underlyingIndex: Map<string, Instrument[]> = new Map(); // key: underlying (e.g. 'NIFTY')

    private constructor() {}

    public static getInstance(): InstrumentService {
        if (!InstrumentService.instance) {
            InstrumentService.instance = new InstrumentService();
        }
        return InstrumentService.instance;
    }

    /**
     * Batch load instruments from broker instrument master dump
     */
    public loadInstruments(instruments: Instrument[]): void {
        for (const inst of instruments) {
            this.instruments.set(inst.tradingsymbol, inst);
            this.tokenMap.set(inst.instrumentToken, inst);

            const underlying = inst.underlying?.toUpperCase() || inst.tradingsymbol;
            const existing = this.underlyingIndex.get(underlying) || [];
            existing.push(inst);
            this.underlyingIndex.set(underlying, existing);
        }
    }

    /**
     * Retrieve instrument by tradingsymbol
     */
    public getBySymbol(symbol: string): Instrument | undefined {
        return this.instruments.get(symbol);
    }

    /**
     * Retrieve instrument by token
     */
    public getByToken(token: string | number): Instrument | undefined {
        return this.tokenMap.get(token);
    }

    /**
     * Dynamically resolve lot size from broker master.
     * Never relies on hardcoded values.
     */
    public getLotSize(symbolOrUnderlying: string): number {
        // First check exact symbol
        const exact = this.instruments.get(symbolOrUnderlying);
        if (exact && exact.lotSize > 0) {
            return exact.lotSize;
        }

        // Then check underlying index
        const list = this.underlyingIndex.get(symbolOrUnderlying.toUpperCase());
        if (list && list.length > 0 && list[0].lotSize > 0) {
            return list[0].lotSize;
        }

        // Default to 1 if not an option / futures lot contract
        return 1;
    }

    /**
     * Find nearest ATM strike based on underlying spot price and standard strike step
     */
    public static calculateAtmStrike(underlyingPrice: number, strikeStep: number): number {
        if (strikeStep <= 0) return Math.round(underlyingPrice);
        return Math.round(underlyingPrice / strikeStep) * strikeStep;
    }

    /**
     * Get active option chain for an underlying
     */
    public getOptionChain(underlying: string, expiry?: string): Instrument[] {
        const list = this.underlyingIndex.get(underlying.toUpperCase()) || [];
        const options = list.filter(i => i.optionType === 'CE' || i.optionType === 'PE');
        if (!expiry) return options;
        return options.filter(i => i.expiry === expiry);
    }

    /**
     * Clear all cached instruments (used on daily refresh)
     */
    public clear(): void {
        this.instruments.clear();
        this.tokenMap.clear();
        this.underlyingIndex.clear();
    }
}
