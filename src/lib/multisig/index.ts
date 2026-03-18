/**
 * Multisig Escrow Module
 *
 * Non-custodial 2-of-3 multisig escrow secured via multisignature.
 * CoinPay is a dispute mediator and multisig co-signer — never a custodian.
 */

// Core engine
export {
  createMultisigEscrow,
  proposeTransaction,
  signProposal,
  broadcastTransaction,
  disputeMultisigEscrow,
  getMultisigEscrow,
  getProposals,
  getSignatures,
  isMultisigEnabled,
  isMultisigDefault,
} from './engine';

// Types
export type {
  MultisigChain,
  EvmChain,
  UtxoChain,
  SolanaChain,
  MultisigEscrow,
  MultisigProposal,
  MultisigSignature,
  CreateMultisigEscrowInput,
  CreateMultisigEscrowResult,
  ProposeResult,
  SignResult,
  BroadcastResultResponse,
  DisputeResult,
  SignerRole,
  ProposalType,
  ProposalStatus,
  MultisigEscrowStatus,
  DisputeStatus,
} from './types';

// Validation schemas
export {
  createMultisigEscrowSchema,
<<<<<<< HEAD
  prepareTransactionSchema,
=======
  proposeTransactionSchema,
>>>>>>> feat/multisig-escrow
  signProposalSchema,
  broadcastTransactionSchema,
  disputeSchema,
  multisigChainSchema,
} from './validation';

// Adapter interface (for custom adapters)
export type { ChainAdapter } from './adapters/interface';
export { getAdapterType } from './adapters/interface';
