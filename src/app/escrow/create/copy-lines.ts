export interface EscrowCopySeries {
  id?: string | number | null;
  interval?: string | number | null;
  max_periods?: string | number | null;
  next_charge_at?: string | number | null;
}

export interface EscrowCopyBase {
  id: string;
  escrow_address: string;
  chain: string;
  amount: number;
  amount_usd: number | null;
  fee_amount: number | null;
  status: string;
  expires_at: string;
}

export interface EscrowCopyCustodial extends EscrowCopyBase {
  escrow_model?: 'custodial';
  depositor_address: string;
  beneficiary_address: string;
  release_token: string;
  beneficiary_token: string;
  allow_auto_release?: boolean;
}

export interface EscrowCopyMultisig extends EscrowCopyBase {
  escrow_model: 'multisig_2of3';
  depositor_pubkey: string;
  beneficiary_pubkey: string;
  arbiter_pubkey: string;
}

export type EscrowCopyInput = EscrowCopyCustodial | EscrowCopyMultisig;

function isMultisigEscrow(escrow: EscrowCopyInput): escrow is EscrowCopyMultisig {
  return escrow.escrow_model === 'multisig_2of3';
}

export function buildEscrowCopyLines(
  createdEscrow: EscrowCopyInput,
  createdSeries: EscrowCopySeries | null,
  includeAllFields: boolean
): string[] {
  if (!includeAllFields) {
    return [
      `Coin: ${createdEscrow.chain}`,
      `Address: ${createdEscrow.escrow_address}`,
    ];
  }

  const createdIsMultisig = isMultisigEscrow(createdEscrow);
  const custodialEscrow = createdIsMultisig ? null : createdEscrow;
  const multisigEscrow = createdIsMultisig ? createdEscrow : null;

  return [
    ...(createdSeries ? [
      `Series ID: ${String(createdSeries.id)}`,
      `Interval: ${String(createdSeries.interval)}`,
      ...(createdSeries.max_periods ? [`Max Periods: ${String(createdSeries.max_periods)}`] : []),
      ...(createdSeries.next_charge_at ? [`Next Payment: ${new Date(String(createdSeries.next_charge_at)).toLocaleString()}`] : []),
      '',
    ] : []),
    `Escrow ID: ${createdEscrow.id}`,
    `Deposit Address: ${createdEscrow.escrow_address}`,
    `Amount: ${createdEscrow.amount} ${createdEscrow.chain}`,
    ...(createdEscrow.amount_usd ? [`USD Value: ≈ $${createdEscrow.amount_usd.toFixed(2)}`] : []),
    `Status: ${createdEscrow.status}`,
    `Depositor: ${createdIsMultisig ? multisigEscrow!.depositor_pubkey : custodialEscrow!.depositor_address}`,
    `Beneficiary: ${createdIsMultisig ? multisigEscrow!.beneficiary_pubkey : custodialEscrow!.beneficiary_address}`,
    ...(createdIsMultisig ? [`Arbiter: ${multisigEscrow!.arbiter_pubkey}`] : []),
    `Expires: ${new Date(createdEscrow.expires_at).toLocaleString()}`,
    ...(!createdIsMultisig ? [
      `Auto-release at expiry: ${custodialEscrow!.allow_auto_release ? 'Enabled' : 'Disabled'}`,
      `Release Token: ${custodialEscrow!.release_token}`,
      `Beneficiary Token: ${custodialEscrow!.beneficiary_token}`,
    ] : []),
    ...(createdEscrow.fee_amount ? [`Commission: ${createdEscrow.fee_amount} ${createdEscrow.chain}`] : []),
  ];
}
