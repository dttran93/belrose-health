"use strict";
// functions/src/services/blockchainSyncRetryService.ts
//
// Admin-triggered retry for the subset of blockchainSyncQueue entries that are signed by the
// permanent server-held admin wallet (see utils/adminWallet.ts) rather than an end user's own
// smart-account key. Only these 5 operations are retryable this way — everything else in the
// queue (permission grants, subject anchoring, verify/dispute, trustee actions, vouches) is
// signed client-side by the acting user's own session and can only ever be resubmitted from
// their own browser; a Cloud Function has no access to that key. addMemberBatch/
// bootstrapDependentTrustee (createDependentAccount.ts) are ALSO admin-wallet-signed but
// deliberately excluded — addMemberBatch's wallet addresses are generated fresh in-memory per
// attempt and never persisted before it succeeds (and the handler's outer catch deletes any
// residue on failure), so there's no durable data to replay from; bootstrapDependentTrustee has
// a hard on-chain dependency on addMemberBatch already having succeeded.
//
// Each of the 5 original handlers (memberRegistry.ts, unacceptedFlags.ts) inlines its contract
// call amid flow-specific Firestore reads/validation that a targeted retry doesn't need (e.g.
// initializeRoleOnChain's original handler also does an on-chain getAllRecordParticipants
// pre-check + Firestore self-heal). Rather than refactor those 3 live, working handlers to share
// code with this internal ops tool, this file duplicates the small amount of contract-call logic
// per action — see the "If you change this call's args/ABI, update REPLAY_REGISTRY" comments at
// each original call site.
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeReplay = executeReplay;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const ethers_1 = require("ethers");
const _shared_1 = require("../_shared/");
const typechain_1 = require("../_shared/typechain");
const adminWallet_1 = require("../utils/adminWallet");
const SUPPORTED_RETRY_ACTIONS = [
    'addMember',
    'setUserStatus',
    'initializeRoleOnChain',
    'flagUnacceptedUpdate',
    'revokeUnacceptedFlag',
];
// Mirrors MemberRoleManager.sol's MemberStatus enum — see memberRegistry.ts's own statusMap.
const STATUS_LABEL_TO_ENUM = {
    Inactive: 1,
    Active: 2,
    Verified: 3,
    VerifiedProvider: 4,
};
// ============================================================================
// CONTRACT ACCESSORS
// ============================================================================
function getMemberRoleManagerContract() {
    return typechain_1.MemberRoleManager__factory.connect(_shared_1.MEMBER_ROLE_MANAGER.proxy, (0, adminWallet_1.getAdminWallet)());
}
function getHealthRecordCoreContract() {
    return typechain_1.HealthRecordCore__factory.connect(_shared_1.HEALTH_RECORD_CORE.proxy, (0, adminWallet_1.getAdminWallet)());
}
function requireContextString(doc, field) {
    const value = doc.context[field];
    if (typeof value !== 'string' || !value) {
        throw new https_1.HttpsError('failed-precondition', `Sync entry is missing context.${field}`);
    }
    return value;
}
// ============================================================================
// REPLAY REGISTRY
// ============================================================================
const REPLAY_REGISTRY = {
    // If you change memberRegistry.ts's registerMemberOnChain call, update this entry too.
    addMember: {
        contractName: 'memberRoleManager',
        methodName: 'addMember',
        buildArgs: doc => {
            if (!doc.userWalletAddress) {
                throw new https_1.HttpsError('failed-precondition', 'Sync entry is missing userWalletAddress');
            }
            return [doc.userWalletAddress, ethers_1.ethers.id(doc.userId)];
        },
        alreadyDoneSubstrings: ['Wallet already registered'],
        applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
            const walletAddress = doc.userWalletAddress;
            const userRef = db.collection('users').doc(doc.userId);
            const userSnap = await userRef.get();
            const userData = userSnap.data();
            if (!userData)
                return; // user doc gone — nothing to mirror into
            const linkedWallets = userData.onChainIdentity?.linkedWallets ?? [];
            const alreadyLinked = linkedWallets.some(w => w.address?.toLowerCase() === walletAddress.toLowerCase());
            if (alreadyLinked)
                return; // already mirrored — don't duplicate the array entry
            const isSmartAccount = walletAddress.toLowerCase() === userData.wallet?.smartAccountAddress?.toLowerCase();
            await userRef.update({
                'onChainIdentity.userIdHash': ethers_1.ethers.id(doc.userId),
                'onChainIdentity.linkedWallets': firestore_1.FieldValue.arrayUnion({
                    address: walletAddress,
                    type: isSmartAccount ? 'smart-account' : 'eoa',
                    blockchainRef,
                    linkedAt: firestore_1.Timestamp.now(),
                    isWalletActive: true,
                }),
            });
        },
    },
    // If you change memberRegistry.ts's updateMemberStatus call, update this entry too.
    setUserStatus: {
        contractName: 'memberRoleManager',
        methodName: 'setUserStatus',
        buildArgs: doc => {
            const label = requireContextString(doc, 'newStatus');
            const statusEnum = STATUS_LABEL_TO_ENUM[label];
            if (!statusEnum) {
                throw new https_1.HttpsError('failed-precondition', `Unrecognized status label "${label}" in stored context`);
            }
            return [ethers_1.ethers.id(doc.userId), statusEnum];
        },
        alreadyDoneSubstrings: ['Already this status'],
        applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
            const label = doc.context.newStatus;
            await db
                .collection('users')
                .doc(doc.userId)
                .update({
                'onChainIdentity.onChainStatus': firestore_1.FieldValue.arrayUnion({
                    status: label,
                    statusUpdatedAt: firestore_1.Timestamp.now(),
                    statusBlockchainRef: blockchainRef,
                }),
            });
        },
    },
    // If you change memberRegistry.ts's initializeRoleOnChain call, update this entry too.
    initializeRoleOnChain: {
        contractName: 'memberRoleManager',
        methodName: 'initializeRecordRole',
        buildArgs: doc => [
            requireContextString(doc, 'recordIdHash'),
            requireContextString(doc, 'targetWalletAddress'),
            requireContextString(doc, 'role'),
        ],
        alreadyDoneSubstrings: ['Record already initialized'],
        applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
            const recordId = requireContextString(doc, 'recordId');
            await db
                .collection('records')
                .doc(recordId)
                .update({
                blockchainRoleInitialization: {
                    blockchainInitialized: true,
                    blockchainInitializedAt: firestore_1.Timestamp.now(),
                    blockchainRef,
                },
            });
        },
    },
    // If you change unacceptedFlags.ts's flagUnacceptedUpdate call, update this entry too.
    flagUnacceptedUpdate: {
        contractName: 'healthRecordCore',
        methodName: 'flagUnacceptedUpdate',
        buildArgs: doc => [
            ethers_1.ethers.id(requireContextString(doc, 'subjectId')),
            ethers_1.ethers.id(requireContextString(doc, 'recordId')),
            ethers_1.ethers.id(requireContextString(doc, 'reporterId')),
            requireContextString(doc, 'recordHash'),
        ],
        alreadyDoneSubstrings: ['Already flagged'],
        applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
            const subjectId = requireContextString(doc, 'subjectId');
            const recordId = requireContextString(doc, 'recordId');
            const reporterId = requireContextString(doc, 'reporterId');
            const recordHash = requireContextString(doc, 'recordHash');
            const flagRef = db.collection('unacceptedFlags').doc(`${subjectId}_${recordId}`);
            const flagSnap = await flagRef.get();
            if (flagSnap.exists)
                return; // already mirrored
            await flagRef.create({
                id: `${subjectId}_${recordId}`,
                subjectId,
                subjectIdHash: ethers_1.ethers.id(subjectId),
                recordId,
                recordIdHash: ethers_1.ethers.id(recordId),
                recordHash,
                reporterId,
                reporterIdHash: ethers_1.ethers.id(reporterId),
                isActive: true,
                createdAt: firestore_1.Timestamp.now(),
                chainStatus: 'confirmed',
                onChainHistory: [{ action: 'flagged', at: firestore_1.Timestamp.now(), blockchainRef }],
            });
        },
    },
    // If you change unacceptedFlags.ts's revokeUnacceptedFlag call, update this entry too.
    revokeUnacceptedFlag: {
        contractName: 'healthRecordCore',
        methodName: 'revokeUnacceptedFlag',
        buildArgs: doc => [
            ethers_1.ethers.id(requireContextString(doc, 'subjectId')),
            ethers_1.ethers.id(requireContextString(doc, 'recordId')),
        ],
        alreadyDoneSubstrings: ['Flag already revoked'],
        applyFirestoreMirror: async ({ db, doc, blockchainRef }) => {
            const subjectId = requireContextString(doc, 'subjectId');
            const recordId = requireContextString(doc, 'recordId');
            const flagRef = db.collection('unacceptedFlags').doc(`${subjectId}_${recordId}`);
            const flagSnap = await flagRef.get();
            if (!flagSnap.exists)
                return; // nothing to mirror into — the original flag was never written either
            await flagRef.update({
                isActive: false,
                lastModified: firestore_1.Timestamp.now(),
                chainStatus: 'confirmed',
                onChainHistory: firestore_1.FieldValue.arrayUnion({
                    action: 'revoked',
                    at: firestore_1.Timestamp.now(),
                    blockchainRef,
                }),
            });
        },
    },
};
// ============================================================================
// EXECUTOR
// ============================================================================
/**
 * Retries one blockchainSyncQueue entry. Rejects (via HttpsError, doc left untouched) if the
 * entry doesn't exist, is already confirmed, is already mid-retry, or its action isn't one of
 * the 5 supported operations. Otherwise: simulates the call first (staticCall — zero gas) to
 * distinguish "already applied on-chain" from a genuine failure before ever sending a real
 * transaction, applies the downstream Firestore mirror write on either success path, and always
 * increments retryCount exactly once regardless of outcome.
 */
async function executeReplay(docId, adminUid) {
    const db = (0, firestore_1.getFirestore)();
    const docRef = db.collection('blockchainSyncQueue').doc(docId);
    const doc = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists)
            throw new https_1.HttpsError('not-found', 'Sync queue entry not found');
        const data = snap.data();
        if (data.status === 'confirmed') {
            throw new https_1.HttpsError('failed-precondition', 'This entry is already confirmed');
        }
        if (data.status === 'retrying') {
            throw new https_1.HttpsError('failed-precondition', 'A retry is already in progress for this entry');
        }
        if (!SUPPORTED_RETRY_ACTIONS.includes(data.action)) {
            throw new https_1.HttpsError('invalid-argument', `"${data.action}" is not a supported retry operation`);
        }
        tx.update(docRef, { status: 'retrying' });
        return data;
    });
    const def = REPLAY_REGISTRY[doc.action];
    const contract = def.contractName === 'memberRoleManager'
        ? getMemberRoleManagerContract()
        : getHealthRecordCoreContract();
    // Dynamic dispatch by method name — the registry's whole point is one generic executor over
    // differently-shaped contract calls, which necessarily costs static ABI type-checking here.
    const method = contract[def.methodName];
    const args = def.buildArgs(doc);
    const baseUpdate = {
        retryCount: firestore_1.FieldValue.increment(1),
        retriedBy: adminUid,
        lastRetryAt: firestore_1.Timestamp.now(),
    };
    const buildRef = (txHash, blockNumber) => def.contractName === 'memberRoleManager'
        ? (0, _shared_1.buildMemberRegistryRef)(txHash, blockNumber)
        : (0, _shared_1.buildHealthRecordRef)(txHash, blockNumber);
    const applyMirror = async (blockchainRef) => {
        try {
            await def.applyFirestoreMirror({ db, doc, blockchainRef });
        }
        catch (mirrorError) {
            // The chain action itself succeeded — don't fail the retry over a downstream Firestore
            // write, but leave a trace so an admin can follow up manually.
            console.error(`⚠️ Retry succeeded on-chain but Firestore mirror failed for ${docId}:`, mirrorError);
            await docRef.update({
                mirrorWriteError: mirrorError instanceof Error ? mirrorError.message : String(mirrorError),
            });
        }
    };
    // Simulate first — zero gas — to detect "already applied on-chain" without ever sending a
    // real transaction for a call we know will revert.
    try {
        await method.staticCall(...args);
    }
    catch (simError) {
        const raw = simError instanceof Error ? simError.message : String(simError);
        const decoded = (0, _shared_1.decodeRevertReason)(raw);
        const isAlreadyDone = decoded && def.alreadyDoneSubstrings.some(s => decoded.includes(s));
        if (isAlreadyDone) {
            await applyMirror(null);
            await docRef.update({
                ...baseUpdate,
                status: 'confirmed',
                resolutionType: 'already-done',
                softSuccessReason: decoded,
            });
            return { outcome: 'already-done', reason: decoded };
        }
        await docRef.update({
            ...baseUpdate,
            status: 'failed',
            lastRetryError: decoded ?? raw,
        });
        throw new https_1.HttpsError('internal', decoded ?? raw);
    }
    // Simulation succeeded — send the real transaction.
    const tx = await method(...args);
    const receipt = await tx.wait();
    if (!receipt) {
        await docRef.update({ ...baseUpdate, status: 'failed', lastRetryError: 'Transaction was dropped or replaced' });
        throw new https_1.HttpsError('internal', 'Transaction was dropped or replaced');
    }
    const blockchainRef = buildRef(tx.hash, receipt.blockNumber);
    await applyMirror(blockchainRef);
    await docRef.update({
        ...baseUpdate,
        status: 'confirmed',
        resolutionType: 'tx-confirmed',
        confirmedTxHash: tx.hash,
    });
    return { outcome: 'tx-confirmed', txHash: tx.hash };
}
//# sourceMappingURL=blockchainSyncRetryService.js.map