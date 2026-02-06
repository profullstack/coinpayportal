import { deriveKeyForChain } from '../src/lib/web-wallet/keys';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env.prod');
const envContent = fs.readFileSync(envPath, 'utf-8');

// Parse all SYSTEM_MNEMONIC entries
const mnemonics: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^SYSTEM_MNEMONIC_(\w+)="([^"]+)"/);
  if (match) {
    mnemonics[match[1]] = match[2];
  }
}

async function main() {
  console.log('# Derived PLATFORM_FEE_WALLET addresses from SYSTEM_MNEMONIC\n');
  
  const chains = ['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB', 
                  'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDT_ETH', 'USDT_POL', 'USDT_SOL'];
  
  for (const chain of chains) {
    const mnemonic = mnemonics[chain];
    if (!mnemonic) {
      console.log(`# SKIP ${chain}: no SYSTEM_MNEMONIC_${chain} found`);
      continue;
    }
    
    try {
      const key = await deriveKeyForChain(mnemonic, chain as any, 0);
      console.log(`PLATFORM_FEE_WALLET_${chain}=${key.address}`);
    } catch (err: any) {
      console.log(`# ERROR ${chain}: ${err.message}`);
    }
  }
}

main();
