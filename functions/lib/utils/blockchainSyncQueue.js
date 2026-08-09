"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBlockchainSyncAttempt = startBlockchainSyncAttempt;
exports.recordBlockchainSyncSuccess = recordBlockchainSyncSuccess;
exports.recordBlockchainSyncFailure = recordBlockchainSyncFailure;
const firestore_1 = require("firebase-admin/firestore");
/** Opens a durable 'pending' entry before attempting a chain write. Returns the doc ID to pass to recordBlockchainSyncSuccess/Failure once the attempt resolves. */
async function startBlockchainSyncAttempt(params) {
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection('blockchainSyncQueue').doc();
    const now = firestore_1.Timestamp.now();
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
async function recordBlockchainSyncSuccess(id, tx) {
    const db = (0, firestore_1.getFirestore)();
    await db
        .collection('blockchainSyncQueue')
        .doc(id)
        .update({
        status: 'confirmed',
        ...tx,
        lastAttemptAt: firestore_1.Timestamp.now(),
    });
}
async function recordBlockchainSyncFailure(id, error) {
    const db = (0, firestore_1.getFirestore)();
    try {
        await db.collection('blockchainSyncQueue').doc(id).update({
            status: 'failed',
            error,
            lastAttemptAt: firestore_1.Timestamp.now(),
        });
    }
    catch (updateError) {
        console.error('❌ Failed to record blockchain sync attempt failure:', updateError);
    }
}
//# sourceMappingURL=blockchainSyncQueue.js.map