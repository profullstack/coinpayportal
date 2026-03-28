export interface WalletCopyItem {
  cryptocurrency: string;
  wallet_address: string;
  label?: string | null;
}

export function formatWalletAddressCopyText(
  wallets: WalletCopyItem[],
  includeAllFields: boolean
): string {
  return wallets
    .map((wallet) => {
      if (!includeAllFields) {
        return `${wallet.cryptocurrency}: ${wallet.wallet_address}`;
      }

      return `${wallet.cryptocurrency}${wallet.label ? ` (${wallet.label})` : ''}: ${wallet.wallet_address}`;
    })
    .join('\n');
}
