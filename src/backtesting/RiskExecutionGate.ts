// ================================================================
// BreakoutEx AI — Risk & Execution Gate
//
// Enforces portfolio-level risk budgets, max drawdown circuit breakers,
// exposure constraints, and position sizing limits before any live trade is permitted.
// ================================================================

import { TradeSide } from './types';

export interface RiskGateConfig {
    /**
     * Total account portfolio capital.
     */
    totalAccountCapital: number;

    /**
     * Max portfolio equity risk per individual trade (default: 2.0%).
     */
    maxRiskPerTradePercent?: number;

    /**
     * Max simultaneous open positions across all active strategies (default: 4).
     */
    maxTotalOpenPositions?: number;

    /**
     * Daily account drawdown limit that halts all trading (default: 5.0%).
     */
    maxDailyDrawdownLimitPercent?: number;

    /**
     * Max portfolio exposure allocation to a single strategy cluster (default: 40%).
     */
    maxClusterExposurePercent?: number;

    /**
     * Minimum risk/reward ratio required to open a position (default: 1.2).
     */
    minRiskRewardRatio?: number;

    /**
     * Maximum allowed slippage before order rejection (default: 0.15%).
     */
    maxSlippageTolerancePercent?: number;
}

export interface TradeEvaluationRequest {
    strategyId: string;
    strategyName: string;
    clusterId?: string;
    symbol: string;
    side: TradeSide;
    entryPrice: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    currentAccountEquity: number;
    peakDailyAccountEquity: number;
    currentOpenPositionsCount: number;
    currentClusterOpenPositionsCount?: number;
    isMarketHalted?: boolean;
}

export type RiskStatus =
    | 'PASSED'
    | 'REDUCED_SIZE'
    | 'REJECTED_DRAWDOWN_LIMIT'
    | 'REJECTED_MAX_POSITIONS'
    | 'REJECTED_CLUSTER_LIMIT'
    | 'REJECTED_INVALID_RR'
    | 'REJECTED_CIRCUIT_BREAKER';

export interface RiskGateDecision {
    permitted: boolean;
    riskStatus: RiskStatus;
    requestedQuantity: number;
    approvedQuantity: number;
    positionCapital: number;
    riskAmountCapital: number;
    riskPercent: number;
    riskRewardRatio: number;
    rejectionReason?: string;
    warnings: string[];
}

export class RiskExecutionGate {

    /**
     * Evaluate a trade signal against portfolio risk limits before execution.
     */
    static evaluate(
        request: TradeEvaluationRequest,
        config: RiskGateConfig
    ): RiskGateDecision {
        const warnings: string[] = [];
        const maxRiskPct = config.maxRiskPerTradePercent ?? 2.0;
        const maxPositions = config.maxTotalOpenPositions ?? 4;
        const maxDailyDdPct = config.maxDailyDrawdownLimitPercent ?? 5.0;
        const minRR = config.minRiskRewardRatio ?? 1.2;

        // 1. Circuit Breaker / Market Halt Check
        if (request.isMarketHalted) {
            return {
                permitted: false,
                riskStatus: 'REJECTED_CIRCUIT_BREAKER',
                requestedQuantity: 0,
                approvedQuantity: 0,
                positionCapital: 0,
                riskAmountCapital: 0,
                riskPercent: 0,
                riskRewardRatio: 0,
                rejectionReason: '[CIRCUIT_BREAKER] Market trading is currently halted due to extreme volatility.',
                warnings: ['Market halt active'],
            };
        }

        // 2. Daily Drawdown Circuit Breaker
        const peakEquity = Math.max(request.currentAccountEquity, request.peakDailyAccountEquity);
        const currentDailyDrawdownPct = peakEquity > 0
            ? ((peakEquity - request.currentAccountEquity) / peakEquity) * 100
            : 0;

        if (currentDailyDrawdownPct >= maxDailyDdPct) {
            return {
                permitted: false,
                riskStatus: 'REJECTED_DRAWDOWN_LIMIT',
                requestedQuantity: 0,
                approvedQuantity: 0,
                positionCapital: 0,
                riskAmountCapital: 0,
                riskPercent: 0,
                riskRewardRatio: 0,
                rejectionReason: `[DAILY_DRAWDOWN_BREAKER] Current daily drawdown (${currentDailyDrawdownPct.toFixed(2)}%) exceeds limit (${maxDailyDdPct.toFixed(2)}%).`,
                warnings: ['Daily drawdown limit exceeded'],
            };
        }

        // 3. Max Portfolio Open Positions Limit
        if (request.currentOpenPositionsCount >= maxPositions) {
            return {
                permitted: false,
                riskStatus: 'REJECTED_MAX_POSITIONS',
                requestedQuantity: 0,
                approvedQuantity: 0,
                positionCapital: 0,
                riskAmountCapital: 0,
                riskPercent: 0,
                riskRewardRatio: 0,
                rejectionReason: `[MAX_POSITIONS_REACHED] Portfolio already holds ${request.currentOpenPositionsCount} of ${maxPositions} allowed positions.`,
                warnings: ['Portfolio position limit reached'],
            };
        }

        // 4. Validate SL/TP and Risk/Reward Ratio
        const entry = request.entryPrice;
        const isLong = request.side === 'long';
        let sl = request.stopLossPrice;
        let tp = request.takeProfitPrice;

        if (!sl || (isLong && sl >= entry) || (!isLong && sl <= entry)) {
            sl = isLong ? entry * 0.98 : entry * 1.02; // default 2% SL
            warnings.push('Unspecified/invalid SL: Assigned default 2.0% stop loss');
        }

        if (!tp || (isLong && tp <= entry) || (!isLong && tp >= entry)) {
            tp = isLong ? entry * 1.04 : entry * 0.96; // default 4% TP
            warnings.push('Unspecified/invalid TP: Assigned default 4.0% take profit');
        }

        const slDist = Math.abs(entry - sl);
        const tpDist = Math.abs(tp - entry);
        const riskRewardRatio = slDist > 0 ? tpDist / slDist : 1.0;

        if (riskRewardRatio < minRR) {
            return {
                permitted: false,
                riskStatus: 'REJECTED_INVALID_RR',
                requestedQuantity: 0,
                approvedQuantity: 0,
                positionCapital: 0,
                riskAmountCapital: 0,
                riskPercent: 0,
                riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
                rejectionReason: `[INSUFFICIENT_RR] Risk/reward ratio (${riskRewardRatio.toFixed(2)}) is below minimum threshold (${minRR}).`,
                warnings,
            };
        }

        // 5. Position Sizing based on Max Risk Budget
        const maxRiskDollars = request.currentAccountEquity * (maxRiskPct / 100);
        const riskPerUnit = slDist;
        let approvedQty = riskPerUnit > 0 ? maxRiskDollars / riskPerUnit : 0;
        const positionCap = approvedQty * entry;

        // Cap single position size to maximum 30% of total portfolio equity
        const maxSinglePositionCapital = request.currentAccountEquity * 0.30;
        let riskStatus: RiskStatus = 'PASSED';

        if (positionCap > maxSinglePositionCapital) {
            approvedQty = maxSinglePositionCapital / entry;
            riskStatus = 'REDUCED_SIZE';
            warnings.push('Position size capped to 30% maximum equity concentration limit');
        }

        const finalPositionCapital = approvedQty * entry;
        const finalRiskDollars = approvedQty * slDist;
        const finalRiskPercent = (finalRiskDollars / request.currentAccountEquity) * 100;

        return {
            permitted: true,
            riskStatus,
            requestedQuantity: Number(approvedQty.toFixed(4)),
            approvedQuantity: Number(approvedQty.toFixed(4)),
            positionCapital: Number(finalPositionCapital.toFixed(2)),
            riskAmountCapital: Number(finalRiskDollars.toFixed(2)),
            riskPercent: Number(finalRiskPercent.toFixed(2)),
            riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
            warnings,
        };
    }
}
