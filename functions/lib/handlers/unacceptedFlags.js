"use strict";
// functions/src/handlers/unacceptedFlags.ts
//
// Admin-only: flags/revokes a "patient refused to anchor this record" signal on-chain
// (HealthRecordCore.sol's flagUnacceptedUpdate/revokeUnacceptedFlag, both onlyAdmin — only the
// platform's own backend wallet can call them, not an end user's smart account), then mirrors the
// result into Firestore. Mirrors functions/src/handlers/memberRegistry.ts's admin-wallet-signed
// write pattern end to end (shares its getAdminWallet() from utils/adminWallet.ts; awaitTx() is
// still a local copy, matching that file's own convention for small duplicated helpers).
//
// Deliberately kept in handlers/ (an operational admin action), not credibility/ (reserved for
// the pure batch-computation math that later reads unacceptedFlags — see earnedTrust.ts).
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeUnacceptedFlag = exports.flagUnacceptedUpdate = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const ethers_1 = require("ethers");
const _shared_1 = require("../_shared/");
const typechain_1 = require("../_shared/typechain");
const adminWallet_1 = require("../utils/adminWallet");
const blockchainSyncQueue_1 = require("../utils/blockchainSyncQueue");
const HEALTH_RECORD_CORE_ADDRESS = _shared_1.HEALTH_RECORD_CORE.proxy;
const CHAIN_ID = _shared_1.NETWORK.chainId;
// ============================================================================
// HELPERS
// ============================================================================
function getHealthRecordCoreContract() {
    return typechain_1.HealthRecordCore__factory.connect(HEALTH_RECORD_CORE_ADDRESS, (0, adminWallet_1.getAdminWallet)());
}
async function awaitTx(tx) {
    const receipt = await tx.wait();
    if (!receipt)
        throw new https_1.HttpsError('internal', 'Transaction was dropped or replaced');
    return receipt;
}
function requireString(value, field) {
    if (!value || typeof value !== 'string') {
        throw new https_1.HttpsError('invalid-argument', `${field} is required`);
    }
    return value;
}
// ============================================================================
// FLAG / REVOKE
// ============================================================================
/**
 * Flags that a patient refused an anchor request for a record a provider created/verified —
 * without exposing the record's content, just that the flag exists. See HealthRecordCore.sol's
 * flagUnacceptedUpdate doc comment for the full provenance/legal-tension rationale.
 */
exports.flagUnacceptedUpdate = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth?.token?.platformAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Not authorized');
    }
    const subjectId = requireString(request.data?.subjectId, 'subjectId');
    const recordId = requireString(request.data?.recordId, 'recordId');
    const reporterId = requireString(request.data?.reporterId, 'reporterId');
    try {
        const db = (0, firestore_1.getFirestore)();
        // Server-fetches recordHash from the record doc rather than trusting a caller-supplied
        // value — avoids admin-tool typos/staleness, mirrors how DisputeDoc.recordScoreAtCreation
        // is stamped server-side rather than client-trusted.
        const recordDoc = await db.collection('records').doc(recordId).get();
        if (!recordDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Record not found');
        }
        const recordHash = recordDoc.data().recordHash;
        const subjectIdHash = ethers_1.ethers.id(subjectId);
        const recordIdHash = ethers_1.ethers.id(recordId);
        const reporterIdHash = ethers_1.ethers.id(reporterId);
        const contract = getHealthRecordCoreContract();
        const syncId = await (0, blockchainSyncQueue_1.startBlockchainSyncAttempt)({
            contract: 'HealthRecordCore',
            action: 'flagUnacceptedUpdate',
            userId: subjectId,
            chainId: CHAIN_ID,
            contractAddress: HEALTH_RECORD_CORE_ADDRESS,
            context: { type: 'flagUnacceptedUpdate', recordId, recordHash, subjectId, reporterId },
        });
        let blockchainRef;
        try {
            const tx = await contract.flagUnacceptedUpdate(subjectIdHash, recordIdHash, reporterIdHash, recordHash);
            const receipt = await awaitTx(tx);
            blockchainRef = (0, _shared_1.buildHealthRecordRef)(tx.hash, receipt.blockNumber);
            await (0, blockchainSyncQueue_1.recordBlockchainSyncSuccess)(syncId, { txHash: tx.hash, blockNumber: receipt.blockNumber });
        }
        catch (chainError) {
            await (0, blockchainSyncQueue_1.recordBlockchainSyncFailure)(syncId, chainError instanceof Error ? chainError.message : String(chainError));
            throw chainError;
        }
        // .create(), not .set() — mirrors the contract's own "Already flagged" invariant: this
        // doc should never already exist for this subject+record pair (a revoked flag's on-chain
        // slot is never reused, so neither should its Firestore mirror be overwritten).
        await db
            .collection('unacceptedFlags')
            .doc(`${subjectId}_${recordId}`)
            .create({
            id: `${subjectId}_${recordId}`,
            subjectId,
            subjectIdHash,
            recordId,
            recordIdHash,
            recordHash,
            reporterId,
            reporterIdHash,
            isActive: true,
            createdAt: firestore_1.Timestamp.now(),
            chainStatus: 'confirmed',
            onChainHistory: [{ action: 'flagged', at: firestore_1.Timestamp.now(), blockchainRef }],
        });
        return { success: true, blockchainRef };
    }
    catch (error) {
        console.error('❌ flagUnacceptedUpdate failed:', error);
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', error.message);
    }
});
/**
 * Revokes a previously-set unaccepted-record flag (e.g. the patient later anchored, or the flag
 * was made in error).
 */
exports.revokeUnacceptedFlag = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth?.token?.platformAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Not authorized');
    }
    const subjectId = requireString(request.data?.subjectId, 'subjectId');
    const recordId = requireString(request.data?.recordId, 'recordId');
    try {
        const subjectIdHash = ethers_1.ethers.id(subjectId);
        const recordIdHash = ethers_1.ethers.id(recordId);
        const contract = getHealthRecordCoreContract();
        const syncId = await (0, blockchainSyncQueue_1.startBlockchainSyncAttempt)({
            contract: 'HealthRecordCore',
            action: 'revokeUnacceptedFlag',
            userId: subjectId,
            chainId: CHAIN_ID,
            contractAddress: HEALTH_RECORD_CORE_ADDRESS,
            context: { type: 'revokeUnacceptedFlag', recordId, subjectId },
        });
        let blockchainRef;
        try {
            const tx = await contract.revokeUnacceptedFlag(subjectIdHash, recordIdHash);
            const receipt = await awaitTx(tx);
            blockchainRef = (0, _shared_1.buildHealthRecordRef)(tx.hash, receipt.blockNumber);
            await (0, blockchainSyncQueue_1.recordBlockchainSyncSuccess)(syncId, { txHash: tx.hash, blockNumber: receipt.blockNumber });
        }
        catch (chainError) {
            await (0, blockchainSyncQueue_1.recordBlockchainSyncFailure)(syncId, chainError instanceof Error ? chainError.message : String(chainError));
            throw chainError;
        }
        await (0, firestore_1.getFirestore)()
            .collection('unacceptedFlags')
            .doc(`${subjectId}_${recordId}`)
            .update({
            isActive: false,
            lastModified: firestore_1.Timestamp.now(),
            chainStatus: 'confirmed',
            onChainHistory: firestore_1.FieldValue.arrayUnion({
                action: 'revoked',
                at: firestore_1.Timestamp.now(),
                blockchainRef,
            }),
        });
        return { success: true, blockchainRef };
    }
    catch (error) {
        console.error('❌ revokeUnacceptedFlag failed:', error);
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', error.message);
    }
});
//# sourceMappingURL=unacceptedFlags.js.map