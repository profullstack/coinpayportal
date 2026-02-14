/**
 * Auth SDK Module Types
 */

import { CoinPayClient } from './client.js';

/**
 * Merchant object returned from auth operations
 */
export interface Merchant {
  id: string;
  email: string;
  name?: string;
  created_at: string;
  updated_at?: string;
  [key: string]: any;
}

/**
 * Auth response for register/login
 */
export interface AuthResponse {
  success: boolean;
  merchant: Merchant;
  token: string;
}

/**
 * Register params
 */
export interface RegisterParams {
  email: string;
  password: string;
  name?: string;
}

/**
 * Login params
 */
export interface LoginParams {
  email: string;
  password: string;
}

/**
 * Register a new merchant account
 * @param client - CoinPay client (can be unauthenticated)
 * @param params - Registration parameters
 * @returns Promise with registration response
 */
export function registerMerchant(
  client: CoinPayClient,
  params: RegisterParams
): Promise<AuthResponse>;

/**
 * Login to merchant account
 * @param client - CoinPay client (can be unauthenticated)
 * @param params - Login parameters
 * @returns Promise with login response
 */
export function loginMerchant(
  client: CoinPayClient,
  params: LoginParams
): Promise<AuthResponse>;

/**
 * Get current authenticated merchant info
 * @param client - Authenticated CoinPay client
 * @returns Promise with merchant information
 */
export function getMe(client: CoinPayClient): Promise<Merchant>;