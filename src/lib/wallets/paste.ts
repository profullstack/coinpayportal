import { SUPPORTED_CRYPTOCURRENCIES, type Cryptocurrency } from './service';

export interface ParsedWalletPasteItem {
  cryptocurrency: Cryptocurrency;
  wallet_address: string;
}

export interface ParsedWalletPasteResult {
  wallets: ParsedWalletPasteItem[];
  invalidLines: string[];
  unsupportedCryptocurrencies: string[];
  duplicateCryptocurrencies: string[];
}

const supportedCryptocurrencies = new Set<string>(SUPPORTED_CRYPTOCURRENCIES);

export function parseWalletPasteText(text: string): ParsedWalletPasteResult {
  const invalidLines: string[] = [];
  const unsupportedCryptocurrencies: string[] = [];
  const duplicateCryptocurrencies: string[] = [];
  const seen = new Set<string>();
  const deduped = new Map<Cryptocurrency, ParsedWalletPasteItem>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
      invalidLines.push(line);
      continue;
    }

    const cryptocurrency = line.slice(0, separatorIndex).trim().toUpperCase();
    const walletAddress = line.slice(separatorIndex + 1).trim();

    if (!supportedCryptocurrencies.has(cryptocurrency)) {
      unsupportedCryptocurrencies.push(cryptocurrency);
      continue;
    }

    if (!walletAddress) {
      invalidLines.push(line);
      continue;
    }

    if (seen.has(cryptocurrency)) {
      duplicateCryptocurrencies.push(cryptocurrency);
    }

    seen.add(cryptocurrency);
    deduped.set(cryptocurrency as Cryptocurrency, {
      cryptocurrency: cryptocurrency as Cryptocurrency,
      wallet_address: walletAddress,
    });
  }

  return {
    wallets: Array.from(deduped.values()),
    invalidLines,
    unsupportedCryptocurrencies: [...new Set(unsupportedCryptocurrencies)],
    duplicateCryptocurrencies: [...new Set(duplicateCryptocurrencies)],
  };
}
