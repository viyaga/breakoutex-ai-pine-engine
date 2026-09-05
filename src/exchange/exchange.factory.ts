// ================================================================
// Exchange Factory
// Instantiates the appropriate exchange client (Delta, Binance, Bybit)
// based on bot configuration.
// ================================================================

import { PineBotConfig } from '../config/types';
import { IExchangeClient } from './exchange.interface';
import { DeltaClient } from './delta.client';
import { BinanceClient } from './binance.client';
import { BybitClient } from './bybit.client';

export function createExchangeClient(c: PineBotConfig, logger?: any): IExchangeClient {
    const exchange = (c.EXCHANGE || 'delta').toLowerCase().trim();
    let client: IExchangeClient;

    switch (exchange) {
        case 'binance':
            client = new BinanceClient(
                c.API_KEY,
                c.SECRET_KEY,
                c.BASE_URL && c.BASE_URL.includes('binance') ? c.BASE_URL : 'https://fapi.binance.com'
            );
            break;

        case 'bybit':
            client = new BybitClient(
                c.API_KEY,
                c.SECRET_KEY,
                c.BASE_URL && c.BASE_URL.includes('bybit') ? c.BASE_URL : 'https://api.bybit.com'
            );
            break;

        case 'delta':
        default:
            client = new DeltaClient(
                c.API_KEY,
                c.SECRET_KEY,
                c.BASE_URL || 'https://api.india.delta.exchange/v2'
            );
            break;
    }

    if (client.setLogger) {
        client.setLogger(logger, c.id);
    }

    return client;
}
