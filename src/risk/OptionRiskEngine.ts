// ================================================================
// BreakoutEx AI - Option Risk & Sizing Engine (Option Buying V1)
// Dynamic lot sizing, risk-per-trade limits, circuit breakers
// ================================================================

export interface OptionRiskParams {
    totalCapital: number;           // in INR (e.g. 50000)
    maxRiskPerTradePercent: number; // e.g. 1.0 (%)
    optionPremium: number;          // e.g. 120 (₹ per share)
    lotSize: number;                // e.g. 75 (dynamic from instrument master)
    stopLossPercent: number;        // e.g. 20 (%)
    maxLotsLimit: number;           // user ceiling (e.g. 5 lots)
    currentDailyLoss: number;       // total losses realized today
    maxDailyLossLimit: number;      // e.g. 2000 (circuit breaker)
}

export interface OptionSizingResult {
    allowed: boolean;
    lots: number;
    totalQuantity: number;
    estimatedCapitalRequired: number;
    riskAmount: number;
    slPrice: number;
    tpPrice: number;
    reason?: string;
}

export class OptionRiskEngine {
    /**
     * Compute safe lot size for Option Buying
     */
    public static calculateOptionSizing(params: OptionRiskParams): OptionSizingResult {
        // 1. Daily Loss Limit Circuit Breaker
        if (params.currentDailyLoss >= params.maxDailyLossLimit) {
            return {
                allowed: false,
                lots: 0,
                totalQuantity: 0,
                estimatedCapitalRequired: 0,
                riskAmount: 0,
                slPrice: 0,
                tpPrice: 0,
                reason: `Circuit Breaker: Daily loss limit (₹${params.maxDailyLossLimit}) reached.`,
            };
        }

        if (params.optionPremium <= 0 || params.lotSize <= 0) {
            return {
                allowed: false,
                lots: 0,
                totalQuantity: 0,
                estimatedCapitalRequired: 0,
                riskAmount: 0,
                slPrice: 0,
                tpPrice: 0,
                reason: 'Invalid premium or lot size',
            };
        }

        // 2. Risk Calculations per lot
        const premiumPerLot = params.optionPremium * params.lotSize;
        const riskPerLot = premiumPerLot * (params.stopLossPercent / 100);
        const maxRiskAmount = params.totalCapital * (params.maxRiskPerTradePercent / 100);

        // 3. Sizing by Risk
        let calculatedLots = Math.floor(maxRiskAmount / riskPerLot);

        // Ensure at least 1 lot if user has enough capital for 1 lot premium
        if (calculatedLots < 1 && params.totalCapital >= premiumPerLot) {
            calculatedLots = 1;
        }

        // Respect user ceiling and capital constraint
        const maxLotsByCapital = Math.floor(params.totalCapital / premiumPerLot);
        calculatedLots = Math.min(calculatedLots, maxLotsByCapital, params.maxLotsLimit);

        if (calculatedLots < 1) {
            return {
                allowed: false,
                lots: 0,
                totalQuantity: 0,
                estimatedCapitalRequired: premiumPerLot,
                riskAmount: 0,
                slPrice: 0,
                tpPrice: 0,
                reason: `Insufficient capital: ₹${premiumPerLot.toFixed(2)} required for 1 lot (Capital: ₹${params.totalCapital}).`,
            };
        }

        const totalQuantity = calculatedLots * params.lotSize;
        const estimatedCapitalRequired = totalQuantity * params.optionPremium;
        const riskAmount = estimatedCapitalRequired * (params.stopLossPercent / 100);
        const slPrice = Math.max(0.05, params.optionPremium * (1 - params.stopLossPercent / 100));
        const tpPrice = params.optionPremium * (1 + (params.stopLossPercent * 2) / 100); // 1:2 default R:R

        return {
            allowed: true,
            lots: calculatedLots,
            totalQuantity,
            estimatedCapitalRequired,
            riskAmount,
            slPrice: parseFloat(slPrice.toFixed(2)),
            tpPrice: parseFloat(tpPrice.toFixed(2)),
        };
    }
}
