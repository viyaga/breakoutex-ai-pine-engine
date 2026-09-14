// ================================================================
// BreakoutEx AI - Broker Adapter Registry & Factory
// Resolves BrokerAdapter instances by brokerType
// ================================================================

import { BrokerAdapter } from './BrokerAdapter';
import { BrokerType } from './BrokerTypes';

export class BrokerRegistry {
    private static instance: BrokerRegistry;
    private adapters: Map<BrokerType, BrokerAdapter> = new Map();

    private constructor() {}

    public static getInstance(): BrokerRegistry {
        if (!BrokerRegistry.instance) {
            BrokerRegistry.instance = new BrokerRegistry();
        }
        return BrokerRegistry.instance;
    }

    public register(broker: BrokerType, adapter: BrokerAdapter): void {
        this.adapters.set(broker, adapter);
    }

    public get(broker: BrokerType): BrokerAdapter {
        const adapter = this.adapters.get(broker);
        if (!adapter) {
            throw new Error(`[BrokerRegistry] No adapter registered for broker: ${broker}`);
        }
        return adapter;
    }

    public has(broker: BrokerType): boolean {
        return this.adapters.has(broker);
    }

    public getRegisteredBrokers(): BrokerType[] {
        return Array.from(this.adapters.keys());
    }
}
