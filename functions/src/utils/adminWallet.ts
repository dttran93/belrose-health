// functions/src/utils/adminWallet.ts
//
// The permanent server-held signer used by the small set of admin-only on-chain writes
// (member registration/status, first-role initialization, dependent-account bootstrap,
// unaccepted-flag actions) — the on-chain `admin` address on both MemberRoleManager and
// HealthRecordCore. Extracted from memberRegistry.ts/unacceptedFlags.ts/createDependentAccount.ts,
// which each carried a byte-identical copy of this function.

import { ethers } from 'ethers';
import { NETWORK } from '../_shared/';

export function getAdminWallet(): ethers.Wallet {
  const privateKey = process.env.ADMIN_WALLET_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL || NETWORK.rpcUrlFallback;
  if (!privateKey) throw new Error('Admin wallet private key not found');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}
