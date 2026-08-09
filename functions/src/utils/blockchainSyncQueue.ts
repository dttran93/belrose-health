// functions/src/utils/blockchainSyncQueue.ts
//
// Server-side (Admin SDK) counterpart to src/features/BlockchainWallet/services/
// blockchainSyncQueueService.ts — writes to the same `blockchainSyncQueue` collection, in the
// same document shape, so BackendChainParity's dashboard (SyncFailuresTable/useSyncFailures)
// shows every blockchain write in one place regardless of whether it originated client-side or
// from a Cloud Function. Admin SDK writes bypass firestore.rules entirely, so there's no rules
// concern here the way there is for the client version.
//
// Unlike the client version, this is NOT part of a "best-effort, don't block the user" contract
// — the Cloud Functions that use this (e.g. createDependentAccount) already have their own
// atomic all-or-nothing behavior (roll back the whole operation on any chain failure). This is
// purely for observability/audit — every blockchain write gets a queue entry, full stop — not
// for controlling whether the calling function proceeds.
//
// Reach for this only when there's no meaningful client-side wrapper to attach tracking to
// instead — see the "client-side vs server-side" rule documented in blockchainSyncQueueService.ts
// above. Most Cloud-Function-mediated blockchain writes (an admin wallet signing on the client's
// behalf) should still be tracked client-side, next to whatever other orchestration the caller is
// already doing around the call.

import { getFirestore, Timestamp } from 'firebase-admin/firestore';

export type BlockchainContract = 'MemberRoleManager' | 'HealthRecordCore' | 'BelrosePaymaster';

interface StartBlockchainSyncAttemptParams {
  contract: BlockchainContract;
  action: string;
  userId: string;
  userWalletAddress?: string;
  chainId: number;
  contractAddress: string;
  // Loosely typed rather than importing the client's full SyncContext union — this file has no
  // dependency on src/, and the dashboard renders context fields generically either way.
  context: Record<string, unknown> & { type: string };
}

/** Opens a durable 'pending' entry before attempting a chain write. Returns the doc ID to pass to recordBlockchainSyncSuccess/Failure once the attempt resolves. */
export async function startBlockchainSyncAttempt(
  params: StartBlockchainSyncAttemptParams
): Promise<string> {
  const db = getFirestore();
  const ref = db.collection('blockchainSyncQueue').doc();
  const now = Timestamp.now();

  await ref.set({
    contract: params.contract,
    action: params.action,
    userId: params.userId,
    ...(params.userWalletAddress && { userWalletAddress: params.userWalletAddress }),
    chainId: params.chainId,
    contractAddress: params.contractAddress,
    context: params.context,
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    lastAttemptAt: now,
  });

  return ref.id;
}

export async function recordBlockchainSyncSuccess(
  id: string,
  tx: { txHash: string; blockNumber: number }
): Promise<void> {
  const db = getFirestore();
  await db
    .collection('blockchainSyncQueue')
    .doc(id)
    .update({
      status: 'confirmed',
      ...tx,
      lastAttemptAt: Timestamp.now(),
    });
}

export async function recordBlockchainSyncFailure(id: string, error: string): Promise<void> {
  const db = getFirestore();
  try {
    await db.collection('blockchainSyncQueue').doc(id).update({
      status: 'failed',
      error,
      lastAttemptAt: Timestamp.now(),
    });
  } catch (updateError) {
    console.error('❌ Failed to record blockchain sync attempt failure:', updateError);
  }
}
