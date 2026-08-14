// functions/src/handlers/unacceptedFlags.ts
//
// Admin-only: flags/revokes a "patient refused to anchor this record" signal on-chain
// (HealthRecordCore.sol's flagUnacceptedUpdate/revokeUnacceptedFlag, both onlyAdmin — only the
// platform's own backend wallet can call them, not an end user's smart account), then mirrors the
// result into Firestore. Mirrors functions/src/handlers/memberRegistry.ts's admin-wallet-signed
// write pattern end to end (its own local getAdminWallet()/awaitTx() helpers, duplicated here
// rather than shared, matching that file's own convention).
//
// Deliberately kept in handlers/ (an operational admin action), not credibility/ (reserved for
// the pure batch-computation math that later reads unacceptedFlags — see earnedTrust.ts).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { ethers } from 'ethers';
import { BlockchainRef, HEALTH_RECORD_CORE, NETWORK, buildHealthRecordRef } from '../_shared/';
import { HealthRecordCore__factory } from '../_shared/typechain';
import type { HealthRecordCore } from '../_shared/typechain';
import {
  startBlockchainSyncAttempt,
  recordBlockchainSyncSuccess,
  recordBlockchainSyncFailure,
} from '../utils/blockchainSyncQueue';

const HEALTH_RECORD_CORE_ADDRESS = HEALTH_RECORD_CORE.proxy;
const CHAIN_ID = NETWORK.chainId;

// ============================================================================
// HELPERS
// ============================================================================

function getAdminWallet(): ethers.Wallet {
  const privateKey = process.env.ADMIN_WALLET_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL || NETWORK.rpcUrlFallback;
  if (!privateKey) throw new Error('Admin wallet private key not found');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

function getHealthRecordCoreContract(): HealthRecordCore {
  return HealthRecordCore__factory.connect(HEALTH_RECORD_CORE_ADDRESS, getAdminWallet());
}

async function awaitTx(
  tx: ethers.ContractTransactionResponse
): Promise<ethers.ContractTransactionReceipt> {
  const receipt = await tx.wait();
  if (!receipt) throw new HttpsError('internal', 'Transaction was dropped or replaced');
  return receipt;
}

function requireString(value: unknown, field: string): string {
  if (!value || typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} is required`);
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
export const flagUnacceptedUpdate = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth?.token?.platformAdmin) {
      throw new HttpsError('permission-denied', 'Not authorized');
    }

    const subjectId = requireString(request.data?.subjectId, 'subjectId');
    const recordId = requireString(request.data?.recordId, 'recordId');
    const reporterId = requireString(request.data?.reporterId, 'reporterId');

    try {
      const db = getFirestore();

      // Server-fetches recordHash from the record doc rather than trusting a caller-supplied
      // value — avoids admin-tool typos/staleness, mirrors how DisputeDoc.recordScoreAtCreation
      // is stamped server-side rather than client-trusted.
      const recordDoc = await db.collection('records').doc(recordId).get();
      if (!recordDoc.exists) {
        throw new HttpsError('not-found', 'Record not found');
      }
      const recordHash = recordDoc.data()!.recordHash as string;

      const subjectIdHash = ethers.id(subjectId);
      const recordIdHash = ethers.id(recordId);
      const reporterIdHash = ethers.id(reporterId);
      const contract = getHealthRecordCoreContract();

      const syncId = await startBlockchainSyncAttempt({
        contract: 'HealthRecordCore',
        action: 'flagUnacceptedUpdate',
        userId: subjectId,
        chainId: CHAIN_ID,
        contractAddress: HEALTH_RECORD_CORE_ADDRESS,
        context: { type: 'flagUnacceptedUpdate', recordId, recordHash, subjectId, reporterId },
      });

      let blockchainRef: BlockchainRef;
      try {
        const tx = await contract.flagUnacceptedUpdate(
          subjectIdHash,
          recordIdHash,
          reporterIdHash,
          recordHash
        );
        const receipt = await awaitTx(tx);
        blockchainRef = buildHealthRecordRef(tx.hash, receipt.blockNumber);
        await recordBlockchainSyncSuccess(syncId, { txHash: tx.hash, blockNumber: receipt.blockNumber });
      } catch (chainError) {
        await recordBlockchainSyncFailure(
          syncId,
          chainError instanceof Error ? chainError.message : String(chainError)
        );
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
          createdAt: Timestamp.now(),
          chainStatus: 'confirmed',
          onChainHistory: [{ action: 'flagged', at: Timestamp.now(), blockchainRef }],
        });

      return { success: true, blockchainRef };
    } catch (error: any) {
      console.error('❌ flagUnacceptedUpdate failed:', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Revokes a previously-set unaccepted-record flag (e.g. the patient later anchored, or the flag
 * was made in error).
 */
export const revokeUnacceptedFlag = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth?.token?.platformAdmin) {
      throw new HttpsError('permission-denied', 'Not authorized');
    }

    const subjectId = requireString(request.data?.subjectId, 'subjectId');
    const recordId = requireString(request.data?.recordId, 'recordId');

    try {
      const subjectIdHash = ethers.id(subjectId);
      const recordIdHash = ethers.id(recordId);
      const contract = getHealthRecordCoreContract();

      const syncId = await startBlockchainSyncAttempt({
        contract: 'HealthRecordCore',
        action: 'revokeUnacceptedFlag',
        userId: subjectId,
        chainId: CHAIN_ID,
        contractAddress: HEALTH_RECORD_CORE_ADDRESS,
        context: { type: 'revokeUnacceptedFlag', recordId, subjectId },
      });

      let blockchainRef: BlockchainRef;
      try {
        const tx = await contract.revokeUnacceptedFlag(subjectIdHash, recordIdHash);
        const receipt = await awaitTx(tx);
        blockchainRef = buildHealthRecordRef(tx.hash, receipt.blockNumber);
        await recordBlockchainSyncSuccess(syncId, { txHash: tx.hash, blockNumber: receipt.blockNumber });
      } catch (chainError) {
        await recordBlockchainSyncFailure(
          syncId,
          chainError instanceof Error ? chainError.message : String(chainError)
        );
        throw chainError;
      }

      await getFirestore()
        .collection('unacceptedFlags')
        .doc(`${subjectId}_${recordId}`)
        .update({
          isActive: false,
          lastModified: Timestamp.now(),
          chainStatus: 'confirmed',
          onChainHistory: FieldValue.arrayUnion({
            action: 'revoked',
            at: Timestamp.now(),
            blockchainRef,
          }),
        });

      return { success: true, blockchainRef };
    } catch (error: any) {
      console.error('❌ revokeUnacceptedFlag failed:', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', error.message);
    }
  }
);
