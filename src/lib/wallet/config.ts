import { http, createConfig, cookieStorage, createStorage } from 'wagmi';
import { mainnet, polygon, sepolia, polygonAmoy } from 'wagmi/chains';

// WalletConnect/Reown Project ID - should be set in environment variables
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Metadata for WalletConnect
export const metadata = {
  name: 'CoinPay',
  description: 'Non-Custodial Cryptocurrency Payment Gateway',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://coinpayportal.com',
  icons: ['https://coinpayportal.com/logo.svg'],
};

// Wagmi config for EVM chains
export const wagmiConfig = createConfig({
  chains: [mainnet, polygon, sepolia, polygonAmoy],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [sepolia.id]: http(),
    [polygonAmoy.id]: http(),
  },
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
});

// Supported chains for display
export const supportedChains = [
  {
    id: mainnet.id,
    name: 'Ethereum',
    symbol: 'ETH',
    icon: '/icons/eth.svg',
    testnet: false,
  },
  {
    id: polygon.id,
    name: 'Polygon',
    symbol: 'MATIC',
    icon: '/icons/matic.svg',
    testnet: false,
  },
  {
    id: sepolia.id,
    name: 'Sepolia',
    symbol: 'ETH',
    icon: '/icons/eth.svg',
    testnet: true,
  },
  {
    id: polygonAmoy.id,
    name: 'Polygon Amoy',
    symbol: 'MATIC',
    icon: '/icons/matic.svg',
    testnet: true,
  },
];

// Wallet types
export type WalletType = 'metamask' | 'walletconnect' | 'phantom' | 'coinbase';

export interface WalletInfo {
  type: WalletType;
  name: string;
  icon: string;
  description: string;
  chains: ('evm' | 'solana')[];
}

export const walletOptions: WalletInfo[] = [
  {
    type: 'metamask',
    name: 'MetaMask',
    icon: '/icons/metamask.svg',
    description: 'Connect using MetaMask browser extension',
    chains: ['evm'],
  },
  {
    type: 'walletconnect',
    name: 'WalletConnect',
    icon: '/icons/walletconnect.svg',
    description: 'Scan with WalletConnect compatible wallet',
    chains: ['evm'],
  },
  {
    type: 'phantom',
    name: 'Phantom',
    icon: '/icons/phantom.svg',
    description: 'Connect using Phantom wallet',
    chains: ['solana', 'evm'],
  },
  {
    type: 'coinbase',
    name: 'Coinbase Wallet',
    icon: '/icons/coinbase.svg',
    description: 'Connect using Coinbase Wallet',
    chains: ['evm'],
  },
];