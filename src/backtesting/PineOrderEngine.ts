// ================================================================
// BreakoutEx AI — Pine Order Engine & Execution Model
//
// Canonical lifecycle and state manager for Pine strategy execution.
//
// Responsibilities:
//   - Order generation, queueing, and cancellation
//   - Limit/stop/stop-limit order simulation with 4-tick intrabar traversal
//   - Position sizing, pyramiding, and automatic reversal
//   - TP/SL exit bracket execution (loss, profit, stop, limit, trailing)
//   - Trade ledger construction, realized/unrealized P&L, equity curve
//   - Commission and slippage modeling
//   - Pine strategy.* runtime state synchronization
// ================================================================

import { Candle } from '../config/types';
import { PineStrategyState } from '../interpreter/PineExecutionContext';

// ================================================================
// Types & Interfaces
// ================================================================

export type PineOrderSide = 'long' | 'short';

export type PineOrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

export type PineOrderStatus =
    | 'created'
    | 'pending'
    | 'filled'
    | 'cancelled'
    | 'rejected';

export type PineOrderIntent = 'entry' | 'exit' | 'order' | 'close';

export interface PineOrder {
    readonly id: string;
    readonly intent: PineOrderIntent;
    readonly side: PineOrderSide;
    readonly type: PineOrderType;

    quantity?: number;
    quantityPercent?: number;

    limitPrice?: number;
    stopPrice?: number;

    fromEntry?: string;
    comment?: string;

    // Trail parameters
    trailPoints?: number;
    trailOffset?: number;
    trailPrice?: number;
    currentTrailingPrice?: number;
    trailActive?: boolean;

    // OCA (One-Cancels-All) parameters
    ocaName?: string;
    ocaType?: 'cancel' | 'reduce' | 'none';

    createdBarIndex: number;
    createdTimestamp: number;

    status: PineOrderStatus;
    filledBarIndex?: number;
    filledTimestamp?: number;
    filledPrice?: number;
    filledQuantity?: number;
}

export interface PinePosition {
    side: 'long' | 'short' | 'flat';
    size: number;
    avgPrice: number;
    initialCapital: number;
    equity: number;
    realizedPnl: number;
    unrealizedPnl: number;
    openBarIndex: number;
    openTimestamp: number;
    entries: { id: string; price: number; qty: number; timestamp: number }[];
}

export interface PineTradeRecord {
    readonly tradeNum: number;
    readonly entryId: string;
    readonly exitId: string;
    readonly side: PineOrderSide;
    readonly entryPrice: number;
    readonly exitPrice: number;
    readonly quantity: number;
    readonly entryTimestamp: number;
    readonly exitTimestamp: number;
    readonly entryBarIndex: number;
    readonly exitBarIndex: number;
    readonly grossPnl: number;
    readonly netPnl: number;
    readonly commission: number;
    readonly slippage: number;
    readonly returnPercent: number;
    readonly isWinner: boolean;
    readonly exitReason?: string;
}

export interface PineOrderEngineConfig {
    initialCapital?: number;
    defaultQtyType?: 'fixed' | 'percent_of_equity' | 'cash';
    defaultQtyValue?: number;
    pyramiding?: number;
    commissionType?: 'percent' | 'fixed_per_order' | 'fixed_per_contract';
    commissionValue?: number;
    slippageTicks?: number;
    tickSize?: number;
    processOrdersOnClose?: boolean;
}

// ================================================================
// PineOrderEngine Class
// ================================================================

export class PineOrderEngine {
    private readonly config: Required<PineOrderEngineConfig>;
    private readonly pendingOrders: PineOrder[] = [];
    private readonly orderHistory: PineOrder[] = [];
    private readonly trades: PineTradeRecord[] = [];

    private position: PinePosition;
    private currentBarIndex = 0;
    private currentCandle?: Candle;

    constructor(config: PineOrderEngineConfig = {}) {
        this.config = {
            initialCapital: config.initialCapital ?? 10_000,
            defaultQtyType: config.defaultQtyType ?? 'percent_of_equity',
            defaultQtyValue: config.defaultQtyValue ?? 100,
            pyramiding: config.pyramiding ?? 1,
            commissionType: config.commissionType ?? 'percent',
            commissionValue: config.commissionValue ?? 0.04, // 0.04% default taker fee
            slippageTicks: config.slippageTicks ?? 1,
            tickSize: config.tickSize ?? 0.01,
            processOrdersOnClose: config.processOrdersOnClose ?? false,
        };

        this.position = {
            side: 'flat',
            size: 0,
            avgPrice: 0,
            initialCapital: this.config.initialCapital,
            equity: this.config.initialCapital,
            realizedPnl: 0,
            unrealizedPnl: 0,
            openBarIndex: -1,
            openTimestamp: 0,
            entries: [],
        };
    }

    // ============================================================
    // State Accessors
    // ============================================================

    getPosition(): Readonly<PinePosition> {
        return this.position;
    }

    getPendingOrders(): readonly PineOrder[] {
        return this.pendingOrders;
    }

    getTrades(): readonly PineTradeRecord[] {
        return this.trades;
    }

    getEquity(): number {
        return this.position.equity;
    }

    // ============================================================
    // Strategy API Hooks
    // ============================================================

    entry(
        id: string,
        direction: 'long' | 'short' | boolean | number,
        qty?: number,
        limit?: number,
        stop?: number,
        comment?: string
    ): void {
        const side: PineOrderSide =
            direction === 'short' || direction === false
                ? 'short'
                : 'long';

        // Check pyramiding rule
        if (this.position.side === side && this.position.entries.length >= this.config.pyramiding) {
            return;
        }

        // Cancel any pending orders from the same entry
        this.cancel(id);

        const orderType: PineOrderType =
            limit !== undefined && stop !== undefined
                ? 'stop_limit'
                : limit !== undefined
                ? 'limit'
                : stop !== undefined
                ? 'stop'
                : 'market';

        const order: PineOrder = {
            id,
            intent: 'entry',
            side,
            type: orderType,
            quantity: qty,
            limitPrice: limit,
            stopPrice: stop,
            comment,
            createdBarIndex: this.currentBarIndex,
            createdTimestamp: this.currentCandle?.timestamp ?? 0,
            status: 'pending',
        };

        this.pendingOrders.push(order);
    }

    order(
        id: string,
        direction: 'long' | 'short' | boolean | number,
        qty?: number,
        limit?: number,
        stop?: number,
        ocaName?: string,
        ocaType?: 'cancel' | 'reduce' | 'none',
        comment?: string
    ): void {
        const side: PineOrderSide =
            direction === 'short' || direction === false
                ? 'short'
                : 'long';

        // Same-ID replacement
        this.cancel(id);

        const orderType: PineOrderType =
            limit !== undefined && stop !== undefined
                ? 'stop_limit'
                : limit !== undefined
                ? 'limit'
                : stop !== undefined
                ? 'stop'
                : 'market';

        const order: PineOrder = {
            id,
            intent: 'order',
            side,
            type: orderType,
            quantity: qty,
            limitPrice: limit,
            stopPrice: stop,
            ocaName,
            ocaType: ocaType ?? (ocaName ? 'cancel' : undefined),
            comment,
            createdBarIndex: this.currentBarIndex,
            createdTimestamp: this.currentCandle?.timestamp ?? 0,
            status: 'pending',
        };

        this.pendingOrders.push(order);
    }

    exit(
        id: string,
        fromEntry?: string,
        qty?: number,
        profit?: number,
        limit?: number,
        loss?: number,
        stop?: number,
        trailPrice?: number,
        trailPoints?: number,
        trailOffset?: number,
        comment?: string,
        qtyPercent?: number
    ): void {
        const hasPendingEntry = this.pendingOrders.some(o => (o.intent === 'entry' || o.intent === 'order') && o.status === 'pending');
        if (this.position.side === 'flat' && !hasPendingEntry) {
            return;
        }

        // Cancel previous exit order with same ID (replacement)
        this.cancel(id);

        const activeSide = this.position.side !== 'flat'
            ? this.position.side
            : (this.pendingOrders.find(o => o.intent === 'entry' || o.intent === 'order')?.side ?? 'long');

        const exitSide: PineOrderSide =
            activeSide === 'long' ? 'short' : 'long';

        // Calculate reference price for profit / loss distances
        let refPrice = this.position.avgPrice;
        if (fromEntry) {
            const entryMatch = this.position.entries.find(e => e.id === fromEntry);
            if (entryMatch) {
                refPrice = entryMatch.price;
            }
        }

        let targetLimit = limit;
        if (targetLimit === undefined && profit !== undefined && refPrice > 0) {
            targetLimit =
                this.position.side === 'long'
                    ? refPrice + profit * this.config.tickSize
                    : refPrice - profit * this.config.tickSize;
        }

        let targetStop = stop;
        if (targetStop === undefined && loss !== undefined && refPrice > 0) {
            targetStop =
                this.position.side === 'long'
                    ? refPrice - loss * this.config.tickSize
                    : refPrice + loss * this.config.tickSize;
        }

        // Quantity calculations
        let exitQty = qty;
        if (exitQty === undefined && qtyPercent !== undefined) {
            exitQty = this.position.size * (qtyPercent / 100);
        }
        if (exitQty === undefined) {
            if (fromEntry) {
                const entryMatch = this.position.entries.find(e => e.id === fromEntry);
                exitQty = entryMatch ? entryMatch.qty : this.position.size;
            } else {
                exitQty = this.position.size;
            }
        }

        const orderType: PineOrderType =
            targetLimit !== undefined && targetStop !== undefined
                ? 'stop_limit'
                : targetLimit !== undefined
                ? 'limit'
                : 'stop';

        const order: PineOrder = {
            id,
            intent: 'exit',
            fromEntry,
            side: exitSide,
            type: orderType,
            quantity: exitQty,
            limitPrice: targetLimit,
            stopPrice: targetStop,
            trailPrice,
            trailPoints,
            trailOffset,
            trailActive: trailPrice !== undefined ? false : true,
            comment,
            createdBarIndex: this.currentBarIndex,
            createdTimestamp: this.currentCandle?.timestamp ?? 0,
            status: 'pending',
        };

        this.pendingOrders.push(order);
    }

    close(id: string, qty?: number, comment?: string, qtyPercent?: number): void {
        const hasPendingEntry = this.pendingOrders.some(o => (o.intent === 'entry' || o.intent === 'order') && o.status === 'pending');
        if (this.position.side === 'flat' && !hasPendingEntry) return;

        const activeSide = this.position.side !== 'flat'
            ? this.position.side
            : (this.pendingOrders.find(o => o.intent === 'entry' || o.intent === 'order')?.side ?? 'long');

        const exitSide: PineOrderSide =
            activeSide === 'long' ? 'short' : 'long';

        let targetQty = qty;
        if (targetQty === undefined && qtyPercent !== undefined) {
            targetQty = this.position.size * (qtyPercent / 100);
        }
        if (targetQty === undefined) {
            const entryMatch = this.position.entries.find(e => e.id === id);
            targetQty = entryMatch ? entryMatch.qty : this.position.size;
        }

        const order: PineOrder = {
            id: `close_${id}`,
            intent: 'close',
            fromEntry: id,
            side: exitSide,
            type: 'market',
            quantity: Math.min(targetQty, this.position.size),
            comment,
            createdBarIndex: this.currentBarIndex,
            createdTimestamp: this.currentCandle?.timestamp ?? 0,
            status: 'pending',
        };

        this.pendingOrders.push(order);
    }

    closeAll(comment?: string): void {
        if (this.position.side === 'flat') return;

        const exitSide: PineOrderSide =
            this.position.side === 'long' ? 'short' : 'long';

        const order: PineOrder = {
            id: 'close_all',
            intent: 'close',
            fromEntry: 'all',
            side: exitSide,
            type: 'market',
            quantity: this.position.size,
            comment,
            createdBarIndex: this.currentBarIndex,
            createdTimestamp: this.currentCandle?.timestamp ?? 0,
            status: 'pending',
        };

        this.pendingOrders.push(order);
    }

    cancel(id: string): void {
        for (let i = this.pendingOrders.length - 1; i >= 0; i--) {
            if (this.pendingOrders[i].id === id) {
                const [order] = this.pendingOrders.splice(i, 1);
                order.status = 'cancelled';
                this.orderHistory.push(order);
            }
        }
    }

    cancelAll(): void {
        while (this.pendingOrders.length > 0) {
            const order = this.pendingOrders.pop()!;
            order.status = 'cancelled';
            this.orderHistory.push(order);
        }
    }

    // ============================================================
    // Bar Iteration & Order Simulation
    // ============================================================

    processBar(barIndex: number, candle: Candle): void {
        this.currentBarIndex = barIndex;
        this.currentCandle = candle;

        // Process pending orders against current candle prices
        this.simulateOrderFills(candle);

        // Update mark-to-market unrealized P&L
        this.updateUnrealizedPnl(candle.close);
    }

    private simulateOrderFills(candle: Candle): void {
        for (let i = 0; i < this.pendingOrders.length; i++) {
            const order = this.pendingOrders[i];
            if (order.status !== 'pending') continue;

            // Don't execute orders on the same bar they were created unless processOrdersOnClose is set
            if (order.createdBarIndex === this.currentBarIndex && !this.config.processOrdersOnClose) {
                continue;
            }

            // ── Fill Evaluation ───────────────────────────────────────
            let fillPrice: number | null = null;

            if (order.type === 'market') {
                fillPrice = candle.open;
            } else if (order.type === 'limit' && order.limitPrice !== undefined) {
                if (order.side === 'long' && candle.low <= order.limitPrice) {
                    fillPrice = Math.min(candle.open, order.limitPrice);
                } else if (order.side === 'short' && candle.high >= order.limitPrice) {
                    fillPrice = Math.max(candle.open, order.limitPrice);
                }
            } else if (order.type === 'stop' && order.stopPrice !== undefined) {
                if (order.side === 'long' && candle.high >= order.stopPrice) {
                    fillPrice = Math.max(candle.open, order.stopPrice);
                } else if (order.side === 'short' && candle.low <= order.stopPrice) {
                    fillPrice = order.currentTrailingPrice !== undefined
                        ? order.stopPrice
                        : Math.min(candle.open, order.stopPrice);
                }
            } else if (order.type === 'stop_limit') {
                // Bracket order with both TP (limit) and SL (stop)
                const isLongPosExit = order.side === 'short';
                const tpTriggered = isLongPosExit
                    ? (order.limitPrice !== undefined && candle.high >= order.limitPrice)
                    : (order.limitPrice !== undefined && candle.low <= order.limitPrice);

                const slTriggered = isLongPosExit
                    ? (order.stopPrice !== undefined && candle.low <= order.stopPrice)
                    : (order.stopPrice !== undefined && candle.high >= order.stopPrice);

                if (tpTriggered && slTriggered) {
                    // Intrabar Collision Policy:
                    // When both TP and SL are touched in the same bar, evaluate candle trajectory:
                    // If candle.open is closer to SL, SL hit first. Otherwise if closer to TP, TP hit first.
                    // If equal, default conservative risk management: SL takes priority.
                    const slDist = Math.abs(candle.open - (order.stopPrice ?? 0));
                    const tpDist = Math.abs(candle.open - (order.limitPrice ?? 0));
                    if (tpDist < slDist) {
                        fillPrice = isLongPosExit ? Math.max(candle.open, order.limitPrice!) : Math.min(candle.open, order.limitPrice!);
                    } else {
                        fillPrice = isLongPosExit ? Math.min(candle.open, order.stopPrice!) : Math.max(candle.open, order.stopPrice!);
                    }
                } else if (slTriggered && order.stopPrice !== undefined) {
                    fillPrice = isLongPosExit ? Math.min(candle.open, order.stopPrice) : Math.max(candle.open, order.stopPrice);
                } else if (tpTriggered && order.limitPrice !== undefined) {
                    fillPrice = isLongPosExit ? Math.max(candle.open, order.limitPrice) : Math.min(candle.open, order.limitPrice);
                }
            }

            if (fillPrice !== null) {
                this.executeFill(order, fillPrice, candle);
                this.pendingOrders.splice(i, 1);
                i--;
                continue;
            }

            // ── Trailing Stop Advancement for Next Bar ────────────────
            if (order.trailPoints !== undefined || order.trailOffset !== undefined || order.trailPrice !== undefined) {
                const isLongExit = order.side === 'short'; // exit order for a long position is 'short'
                const isShortExit = order.side === 'long'; // exit order for a short position is 'long'
                const offset = (order.trailOffset ?? order.trailPoints ?? 0) * this.config.tickSize;

                if (isLongExit) {
                    // Check trail activation
                    if (!order.trailActive && order.trailPrice !== undefined) {
                        if (candle.high >= order.trailPrice) {
                            order.trailActive = true;
                            order.currentTrailingPrice = candle.high - offset;
                        }
                    } else if (order.trailActive) {
                        const newTrail = candle.high - offset;
                        if (order.currentTrailingPrice === undefined || newTrail > order.currentTrailingPrice) {
                            order.currentTrailingPrice = newTrail;
                        }
                    }
                    if (order.currentTrailingPrice !== undefined) {
                        order.stopPrice = Math.max(order.stopPrice ?? 0, order.currentTrailingPrice);
                    }
                } else if (isShortExit) {
                    if (!order.trailActive && order.trailPrice !== undefined) {
                        if (candle.low <= order.trailPrice) {
                            order.trailActive = true;
                            order.currentTrailingPrice = candle.low + offset;
                        }
                    } else if (order.trailActive) {
                        const newTrail = candle.low + offset;
                        if (order.currentTrailingPrice === undefined || newTrail < order.currentTrailingPrice) {
                            order.currentTrailingPrice = newTrail;
                        }
                    }
                    if (order.currentTrailingPrice !== undefined) {
                        order.stopPrice = Math.min(order.stopPrice ?? Infinity, order.currentTrailingPrice);
                    }
                }
            }
        }
    }

    private executeFill(order: PineOrder, rawPrice: number, candle: Candle): void {
        const slippage = this.config.slippageTicks * this.config.tickSize;
        const fillPrice = order.side === 'long' ? rawPrice + slippage : rawPrice - slippage;
        const qty = order.quantity ?? this.calculateDefaultQuantity(fillPrice);

        order.status = 'filled';
        order.filledBarIndex = this.currentBarIndex;
        order.filledTimestamp = candle.timestamp;
        order.filledPrice = fillPrice;
        order.filledQuantity = qty;
        this.orderHistory.push(order);

        // Handle OCA Group
        if (order.ocaName) {
            this.handleOCAFill(order.ocaName, order.id, order.ocaType ?? 'cancel', qty);
        }

        // Position change & P&L
        if (order.intent === 'entry') {
            if (this.position.side === 'flat') {
                // Open new position
                this.position.side = order.side;
                this.position.size = qty;
                this.position.avgPrice = fillPrice;
                this.position.openBarIndex = this.currentBarIndex;
                this.position.openTimestamp = candle.timestamp;
                this.position.entries = [{ id: order.id, price: fillPrice, qty, timestamp: candle.timestamp }];
            } else if (this.position.side === order.side) {
                // Pyramiding add
                const totalCost = this.position.avgPrice * this.position.size + fillPrice * qty;
                this.position.size += qty;
                this.position.avgPrice = totalCost / this.position.size;
                this.position.entries.push({ id: order.id, price: fillPrice, qty, timestamp: candle.timestamp });
            } else {
                // Reversal: close current position and open reverse
                this.closePositionAndRecordTrade(fillPrice, candle, order.id, 'reversal', this.position.size);
                this.position.side = order.side;
                this.position.size = qty;
                this.position.avgPrice = fillPrice;
                this.position.openBarIndex = this.currentBarIndex;
                this.position.openTimestamp = candle.timestamp;
                this.position.entries = [{ id: order.id, price: fillPrice, qty, timestamp: candle.timestamp }];
            }
        } else if (order.intent === 'order') {
            // strategy.order() semantics: direct addition, reduction, or reversal
            if (this.position.side === 'flat') {
                this.position.side = order.side;
                this.position.size = qty;
                this.position.avgPrice = fillPrice;
                this.position.openBarIndex = this.currentBarIndex;
                this.position.openTimestamp = candle.timestamp;
                this.position.entries = [{ id: order.id, price: fillPrice, qty, timestamp: candle.timestamp }];
            } else if (this.position.side === order.side) {
                // Direct position increase (independent of pyramiding limit)
                const totalCost = this.position.avgPrice * this.position.size + fillPrice * qty;
                this.position.size += qty;
                this.position.avgPrice = totalCost / this.position.size;
                this.position.entries.push({ id: order.id, price: fillPrice, qty, timestamp: candle.timestamp });
            } else {
                // Opposite direction order
                if (qty < this.position.size) {
                    // Partial position reduction (e.g. LONG 10 -> reduce 4 -> LONG 6)
                    this.closePositionAndRecordTrade(fillPrice, candle, order.id, 'reduction', qty);
                } else if (qty === this.position.size) {
                    // Exact flat close
                    this.closePositionAndRecordTrade(fillPrice, candle, order.id, 'close', qty);
                } else {
                    // Position reversal with excess quantity (e.g. LONG 10 -> order SHORT 15 -> close 10 + open SHORT 5)
                    const closedQty = this.position.size;
                    const excessQty = qty - closedQty;
                    this.closePositionAndRecordTrade(fillPrice, candle, order.id, 'reversal', closedQty);

                    this.position.side = order.side;
                    this.position.size = excessQty;
                    this.position.avgPrice = fillPrice;
                    this.position.openBarIndex = this.currentBarIndex;
                    this.position.openTimestamp = candle.timestamp;
                    this.position.entries = [{ id: order.id, price: fillPrice, qty: excessQty, timestamp: candle.timestamp }];
                }
            }
        } else if (order.intent === 'exit' || order.intent === 'close') {
            this.closePositionAndRecordTrade(fillPrice, candle, order.id, order.comment ?? 'exit', Math.min(qty, this.position.size));
        }
    }

    private handleOCAFill(ocaName: string, filledOrderId: string, ocaType: 'cancel' | 'reduce' | 'none', filledQty: number): void {
        if (ocaType === 'none') return;

        for (let i = this.pendingOrders.length - 1; i >= 0; i--) {
            const pending = this.pendingOrders[i];
            if (pending.id !== filledOrderId && pending.ocaName === ocaName) {
                if (ocaType === 'cancel') {
                    const [cancelled] = this.pendingOrders.splice(i, 1);
                    cancelled.status = 'cancelled';
                    this.orderHistory.push(cancelled);
                } else if (ocaType === 'reduce') {
                    if (pending.quantity !== undefined) {
                        pending.quantity = Math.max(0, pending.quantity - filledQty);
                        if (pending.quantity === 0) {
                            const [cancelled] = this.pendingOrders.splice(i, 1);
                            cancelled.status = 'cancelled';
                            this.orderHistory.push(cancelled);
                        }
                    }
                }
            }
        }
    }

    private closePositionAndRecordTrade(
        exitPrice: number,
        candle: Candle,
        exitId: string,
        reason: string,
        closedQty = this.position.size
    ): void {
        if (this.position.side === 'flat' || this.position.size <= 0 || closedQty <= 0) return;

        const side = this.position.side as PineOrderSide;
        const entryPrice = this.position.avgPrice;
        const qty = closedQty;

        const grossPnl =
            side === 'long'
                ? (exitPrice - entryPrice) * qty
                : (entryPrice - exitPrice) * qty;

        const commission =
            this.config.commissionType === 'percent'
                ? (entryPrice * qty + exitPrice * qty) * (this.config.commissionValue / 100)
                : this.config.commissionValue * 2;

        const netPnl = grossPnl - commission;
        const returnPercent = (netPnl / (entryPrice * qty)) * 100;

        const trade: PineTradeRecord = {
            tradeNum: this.trades.length + 1,
            entryId: this.position.entries[0]?.id ?? 'unknown',
            exitId,
            side,
            entryPrice,
            exitPrice,
            quantity: qty,
            entryTimestamp: this.position.openTimestamp,
            exitTimestamp: candle.timestamp,
            entryBarIndex: this.position.openBarIndex,
            exitBarIndex: this.currentBarIndex,
            grossPnl,
            netPnl,
            commission,
            slippage: this.config.slippageTicks * this.config.tickSize * 2,
            returnPercent,
            isWinner: netPnl > 0,
            exitReason: reason,
        };

        this.trades.push(trade);

        // Update capital
        this.position.realizedPnl += netPnl;
        this.position.equity += netPnl;

        if (closedQty >= this.position.size) {
            // Full reset
            this.position.side = 'flat';
            this.position.size = 0;
            this.position.avgPrice = 0;
            this.position.unrealizedPnl = 0;
            this.position.entries = [];
        } else {
            // Partial reduction: decrement size
            this.position.size -= closedQty;
        }
    }

    private updateUnrealizedPnl(currentPrice: number): void {
        if (this.position.side === 'flat') {
            this.position.unrealizedPnl = 0;
            return;
        }

        const rawPnl =
            this.position.side === 'long'
                ? (currentPrice - this.position.avgPrice) * this.position.size
                : (this.position.avgPrice - currentPrice) * this.position.size;

        this.position.unrealizedPnl = rawPnl;
        this.position.equity = this.config.initialCapital + this.position.realizedPnl + rawPnl;
    }

    private calculateDefaultQuantity(price: number): number {
        if (price <= 0) return 1;
        if (this.config.defaultQtyType === 'percent_of_equity') {
            const alloc = (this.position.equity * (this.config.defaultQtyValue / 100));
            return alloc / price;
        } else if (this.config.defaultQtyType === 'cash') {
            return this.config.defaultQtyValue / price;
        }
        return this.config.defaultQtyValue;
    }

    // ============================================================
    // Sync with PineStrategyState
    // ============================================================

    syncStrategyState(state: PineStrategyState): void {
        state.positionDirection = this.position.side === 'flat' ? 'none' : this.position.side;
        state.positionSize = this.position.side === 'short' ? -this.position.size : this.position.size;
        state.averagePrice = this.position.avgPrice;
        state.opentrades = this.position.side === 'flat' ? 0 : this.position.entries.length;
        state.closedtrades = this.trades.length;
        state.netProfit = this.position.realizedPnl;
        state.equity = this.position.equity;
    }
}
