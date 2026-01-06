import { NextRequest, NextResponse } from 'next/server';
import { getEstimatedNetworkFee, getEstimatedNetworkFees, getFallbackFees } from '@/lib/rates/fees';

/**
 * Supported blockchains for fee estimation
 */
const SUPPORTED_BLOCKCHAINS = [
  'BTC', 'BCH', 'ETH', 'POL', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB',
  'USDT', 'USDC', 'USDC_ETH', 'USDC_POL', 'USDC_SOL'
];

/**
 * GET /api/fees
 * Get real-time network fee estimates for cryptocurrencies
 *
 * Query parameters:
 * - blockchain: Single blockchain code (e.g., "ETH", "USDC_POL")
 * - blockchains: Comma-separated list of blockchain codes
 *
 * If no parameters provided, returns fees for all supported blockchains
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const singleBlockchain = searchParams.get('blockchain');
    const multipleBlockchains = searchParams.get('blockchains');

    // Single blockchain request
    if (singleBlockchain) {
      const blockchain = singleBlockchain.toUpperCase();

      if (!SUPPORTED_BLOCKCHAINS.includes(blockchain)) {
        return NextResponse.json(
          {
            success: false,
            error: `Unsupported blockchain: ${blockchain}. Supported: ${SUPPORTED_BLOCKCHAINS.join(', ')}`
          },
          { status: 400 }
        );
      }

      const fee = await getEstimatedNetworkFee(blockchain);

      return NextResponse.json({
        success: true,
        blockchain,
        fee_usd: fee,
        cached: true, // Fee service has internal caching
        timestamp: new Date().toISOString(),
      });
    }

    // Multiple blockchains request
    let blockchainsToFetch: string[];

    if (multipleBlockchains) {
      blockchainsToFetch = multipleBlockchains
        .split(',')
        .map(b => b.trim().toUpperCase())
        .filter(b => SUPPORTED_BLOCKCHAINS.includes(b));

      if (blockchainsToFetch.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: `No valid blockchains provided. Supported: ${SUPPORTED_BLOCKCHAINS.join(', ')}`
          },
          { status: 400 }
        );
      }
    } else {
      // Return all supported blockchains
      blockchainsToFetch = SUPPORTED_BLOCKCHAINS;
    }

    const fees = await getEstimatedNetworkFees(blockchainsToFetch);

    // Format response with additional metadata
    const feesWithMetadata = Object.entries(fees).map(([blockchain, fee]) => ({
      blockchain,
      fee_usd: fee,
      display: fee < 0.01 ? `~$${fee.toFixed(4)}` : fee < 1 ? `~$${fee.toFixed(2)}` : `~$${fee.toFixed(2)}`,
    }));

    return NextResponse.json({
      success: true,
      fees: feesWithMetadata,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Fee estimation error:', error);

    // Return fallback fees on error
    const fallbackFees = getFallbackFees();

    return NextResponse.json({
      success: true,
      fees: Object.entries(fallbackFees).map(([blockchain, fee]) => ({
        blockchain,
        fee_usd: fee,
        display: fee < 0.01 ? `~$${fee.toFixed(4)}` : fee < 1 ? `~$${fee.toFixed(2)}` : `~$${fee.toFixed(2)}`,
        fallback: true,
      })),
      fallback: true,
      timestamp: new Date().toISOString(),
    });
  }
}
