import { CoinPayClient, SupportedCoinsParams, SupportedCoinsResponse, TokensResponse } from './client.js';

export interface TokenDiscoveryParams extends SupportedCoinsParams {
  /** API key — required if `client` is not provided */
  apiKey?: string;
  /** Existing CoinPayClient instance */
  client?: CoinPayClient;
}

/** List checkout-friendly tokens for a business. */
export function getTokens(params?: TokenDiscoveryParams): Promise<TokensResponse>;

/** List supported payment coins for a business. */
export function getSupportedCoins(params?: TokenDiscoveryParams): Promise<SupportedCoinsResponse>;
