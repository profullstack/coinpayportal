import { deriveKeyForChain, generateMnemonic } from '../src/lib/web-wallet/keys';

async function main() {
  const mnemonic = generateMnemonic(12);
  console.log('# PLATFORM SEED PHRASE (SAVE THIS SECURELY!)');
  console.log(`PLATFORM_SEEDPHRASE="${mnemonic}"`);
  console.log('\n# Platform Fee Wallet Addresses\n');

  const chains = ['BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB'] as const;

  for (const chain of chains) {
    try {
      const key = await deriveKeyForChain(mnemonic, chain, 0);
      console.log(`PLATFORM_FEE_WALLET_${chain}=${key.address}`);
    } catch (err: any) {
      console.error(`# ERROR ${chain}: ${err.message}`);
    }
  }
}

main();
