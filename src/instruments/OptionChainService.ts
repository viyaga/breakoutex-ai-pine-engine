// ================================================================
// BreakoutEx AI - Indian Option Selection Engine (Option Buying V1)
// Selects appropriate Strike (ATM/ITM), Expiry, and CE/PE contract
// ================================================================

import { Instrument } from '../brokers/core/BrokerTypes';
import { InstrumentService } from './InstrumentService';

export type OptionStrikePreference = 'ATM' | 'ITM1' | 'ITM2' | 'OTM1';
export type OptionExpiryPreference = 'NEAREST_WEEKLY' | 'NEXT_WEEKLY' | 'MONTHLY';
export type OptionDirectionMode = 'AI_DIRECTIONAL' | 'CE_ONLY' | 'PE_ONLY';

export interface OptionSelectionRequest {
    underlying: 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | string;
    underlyingPrice: number;
    signalDirection: 'LONG' | 'SHORT';
    mode: OptionDirectionMode;
    strikePreference: OptionStrikePreference;
    expiryPreference: OptionExpiryPreference;
}

export interface SelectedOptionContract {
    instrument: Instrument;
    underlyingPrice: number;
    targetStrike: number;
    optionType: 'CE' | 'PE';
    lotSize: number;
    tradingsymbol: string;
    expiry: string;
}

export class OptionChainService {
    private instrumentService: InstrumentService;

    // Standard strike steps for Indian major indices
    private static STRIKE_STEPS: Record<string, number> = {
        'NIFTY': 50,
        'BANKNIFTY': 100,
        'FINNIFTY': 50,
        'MIDCPNIFTY': 25,
        'SENSEX': 100,
    };

    constructor() {
        this.instrumentService = InstrumentService.getInstance();
    }

    /**
     * Get strike interval step for underlying
     */
    public static getStrikeStep(underlying: string): number {
        return OptionChainService.STRIKE_STEPS[underlying.toUpperCase()] || 50;
    }

    /**
     * Resolves the target strike based on preference (ATM, ITM1, ITM2, OTM1)
     */
    public calculateTargetStrike(
        underlying: string,
        spotPrice: number,
        optionType: 'CE' | 'PE',
        preference: OptionStrikePreference
    ): number {
        const step = OptionChainService.getStrikeStep(underlying);
        const atm = Math.round(spotPrice / step) * step;

        if (preference === 'ATM') return atm;

        if (optionType === 'CE') {
            // For Call Options (CE): In-The-Money is below ATM, Out-of-The-Money is above ATM
            switch (preference) {
                case 'ITM1': return atm - step;
                case 'ITM2': return atm - (step * 2);
                case 'OTM1': return atm + step;
                default: return atm;
            }
        } else {
            // For Put Options (PE): In-The-Money is above ATM, Out-of-The-Money is below ATM
            switch (preference) {
                case 'ITM1': return atm + step;
                case 'ITM2': return atm + (step * 2);
                case 'OTM1': return atm - step;
                default: return atm;
            }
        }
    }

    /**
     * Selects unique expiries sorted ascending
     */
    public getSortedExpiries(underlying: string): string[] {
        const chain = this.instrumentService.getOptionChain(underlying);
        const expiries = new Set<string>();
        for (const c of chain) {
            if (c.expiry) expiries.add(c.expiry);
        }
        return Array.from(expiries).sort();
    }

    /**
     * Core V1 Option Buying Contract Derivation
     */
    public selectOptionContract(req: OptionSelectionRequest): SelectedOptionContract | null {
        // 1. Determine CE or PE based on strategy signal & user mode
        let optionType: 'CE' | 'PE' = 'CE';
        if (req.mode === 'CE_ONLY') {
            optionType = 'CE';
        } else if (req.mode === 'PE_ONLY') {
            optionType = 'PE';
        } else {
            // AI Directional: BUY CE on LONG, BUY PE on SHORT
            optionType = req.signalDirection === 'LONG' ? 'CE' : 'PE';
        }

        // 2. Determine target strike
        const targetStrike = this.calculateTargetStrike(
            req.underlying,
            req.underlyingPrice,
            optionType,
            req.strikePreference
        );

        // 3. Resolve eligible expiries
        const sortedExpiries = this.getSortedExpiries(req.underlying);
        if (sortedExpiries.length === 0) {
            // Fallback: Generate synthetic contract for paper testing if master not yet synced
            const lotSize = this.instrumentService.getLotSize(req.underlying);
            const synthExpiry = new Date(Date.now() + 86400000 * 4).toISOString().split('T')[0];
            const synthSymbol = `${req.underlying}${synthExpiry.replace(/-/g, '').slice(2)}${targetStrike}${optionType}`;

            return {
                instrument: {
                    exchange: 'NFO',
                    instrumentToken: synthSymbol,
                    tradingsymbol: synthSymbol,
                    underlying: req.underlying,
                    expiry: synthExpiry,
                    strike: targetStrike,
                    optionType,
                    lotSize,
                    tickSize: 0.05,
                },
                underlyingPrice: req.underlyingPrice,
                targetStrike,
                optionType,
                lotSize,
                tradingsymbol: synthSymbol,
                expiry: synthExpiry,
            };
        }

        let selectedExpiry = sortedExpiries[0]; // Nearest weekly default
        if (req.expiryPreference === 'NEXT_WEEKLY' && sortedExpiries.length > 1) {
            selectedExpiry = sortedExpiries[1];
        } else if (req.expiryPreference === 'MONTHLY') {
            selectedExpiry = sortedExpiries[sortedExpiries.length - 1];
        }

        // 4. Match instrument in option chain
        const chain = this.instrumentService.getOptionChain(req.underlying, selectedExpiry);
        const match = chain.find(
            inst => inst.optionType === optionType && inst.strike === targetStrike
        );

        if (match) {
            return {
                instrument: match,
                underlyingPrice: req.underlyingPrice,
                targetStrike,
                optionType,
                lotSize: match.lotSize,
                tradingsymbol: match.tradingsymbol,
                expiry: selectedExpiry,
            };
        }

        return null;
    }
}
