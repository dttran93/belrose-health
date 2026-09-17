// functions/src/handlers/createDependentAccount.ts
// Creates a dependent account on behalf of a guardian.
// Client generates all crypto material; this CF handles the identity operations
// that require Admin SDK: Firebase Auth user creation, Firestore writes to another
// user's document, blockchain registration with the admin wallet, and the active
// trustee relationship (which Firestore rules require to start as 'pending' from
// the client — bypassed here because the guardian is the one giving consent).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { MEMBER_ROLE_MANAGER, NETWORK } from '../_shared/';
import { MemberRoleManager__factory } from '../_shared/typechain';
import type { MemberRoleManager } from '../_shared/typechain';
import { encryptPrivateKey, generateWallet } from '../services/backendWalletService';
import { computeSmartAccountAddress } from './wallet';
import { getAdminWallet } from '../utils/adminWallet';
import {
  startBlockchainSyncAttempt,
  recordBlockchainSyncSuccess,
  recordBlockchainSyncFailure,
} from '../utils/blockchainSyncQueue';

interface CreateDependentAccountRequest {
  email: string; // real email or placeholder (dep-{id}@placeholder.belrose.health)
  password: string;
  firstName: string;
  lastName: string;

  // Pre-generated encrypted crypto material (all generated client-side before this call)
  encryptedMasterKey: string;
  masterKeyIV: string;
  masterKeySalt: string;
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedPrivateKeyIV: string;
  recoveryKeyHash: string;
  masterKeyHex: string; // used server-side only to encrypt the blockchain wallet private key
}

interface CreateDependentAccountResult {
  uid: string;
  walletAddress: string;
  smartAccountAddress: string;
}

const MEMBER_ROLE_MANAGER_ADDRESS = MEMBER_ROLE_MANAGER.proxy;
const CHAIN_ID = NETWORK.chainId;

export const createDependentAccount = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async (request): Promise<CreateDependentAccountResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Guardian must be authenticated');

    const guardianUid = request.auth.uid;
    const db = getFirestore();

    // Dependents cannot create other dependents
    const guardianDoc = await db.collection('users').doc(guardianUid).get();
    if (!guardianDoc.exists) throw new HttpsError('not-found', 'Guardian profile not found');
    if (guardianDoc.data()?.isDependent) {
      throw new HttpsError('permission-denied', 'Dependent accounts cannot create other accounts');
    }

    const {
      email,
      password,
      firstName,
      lastName,
      encryptedMasterKey,
      masterKeyIV,
      masterKeySalt,
      publicKey,
      encryptedPrivateKey,
      encryptedPrivateKeyIV,
      recoveryKeyHash,
      masterKeyHex,
    } = request.data as CreateDependentAccountRequest;

    if (
      !email ||
      !password ||
      !firstName ||
      !lastName ||
      !encryptedMasterKey ||
      !masterKeyIV ||
      !masterKeySalt ||
      !publicKey ||
      !encryptedPrivateKey ||
      !encryptedPrivateKeyIV ||
      !recoveryKeyHash ||
      !masterKeyHex
    ) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // ── Step 1: Create Firebase Auth user ─────────────────────────────────────
    const isPlaceholder = email.endsWith('@placeholder.belrose.health');
    let dependentUid: string;
    try {
      const displayName = `${firstName} ${lastName}`.trim();
      const authUser = await admin
        .auth()
        .createUser({ email, password, displayName, emailVerified: isPlaceholder });
      dependentUid = authUser.uid;
      console.log('✅ Firebase Auth user created:', dependentUid);
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      console.error('❌ Firebase Auth user creation failed:', err);
      throw new HttpsError('internal', 'Failed to create account');
    }

    const dependentRef = db.collection('users').doc(dependentUid);
    const now = Timestamp.now();

    try {
      // ── Step 2: Create Firestore user document ─────────────────────────────
      const displayName = `${firstName} ${lastName}`.trim();
      await dependentRef.set({
        uid: dependentUid,
        email,
        emailVerified: isPlaceholder,
        displayName,
        displayNameLower: displayName.toLowerCase(),
        firstName,
        lastName,
        isDependent: true,
        dependentCreatedBy: guardianUid,
        identityVerified: false,
        createdAt: now,
        updatedAt: now,
        encryption: {
          enabled: true,
          encryptedMasterKey,
          masterKeyIV,
          masterKeySalt,
          encryptedPrivateKey,
          encryptedPrivateKeyIV,
          publicKey,
          recoveryKeyHash,
          setupAt: now.toDate().toISOString(),
        },
      });
      console.log('✅ Firestore user document created');

      // ── Step 3: Wallet generation + on-chain registration ──────────────────
      // Mirrors registerMemberOnChainComplete but uses dependentUid rather than
      // request.auth.uid (guardian is the caller; dependent has no active session).
      console.log('🔐 Generating EOA wallet...');
      const wallet = generateWallet();

      console.log('🧮 Computing smart account address...');
      const smartAccountAddress = await computeSmartAccountAddress(wallet.privateKey);

      console.log('⛓️ Registering both wallets on-chain...');
      const userIdHash = ethers.id(dependentUid);
      const contract: MemberRoleManager = MemberRoleManager__factory.connect(
        MEMBER_ROLE_MANAGER_ADDRESS,
        getAdminWallet()
      );
      // Tracked in blockchainSyncQueue purely for observability — this function already rolls
      // the whole operation back on any failure (see the outer catch), so this doesn't change
      // that control flow, it just makes the attempt visible in the same dashboard client-side
      // writes show up in.
      const memberSyncId = await startBlockchainSyncAttempt({
        contract: 'MemberRoleManager',
        action: 'addMemberBatch',
        userId: guardianUid,
        chainId: CHAIN_ID,
        contractAddress: MEMBER_ROLE_MANAGER_ADDRESS,
        context: { type: 'memberRegistry', newStatus: 'Active' },
      });
      let blockchainRef;
      try {
        const tx = await contract.addMemberBatch([wallet.address, smartAccountAddress], userIdHash);
        const receipt = await tx.wait();
        if (!receipt) throw new Error('Transaction was dropped or replaced');
        blockchainRef = {
          txHash: tx.hash,
          chainId: CHAIN_ID,
          blockNumber: receipt.blockNumber,
          contractAddress: MEMBER_ROLE_MANAGER_ADDRESS,
        };
        await recordBlockchainSyncSuccess(memberSyncId, {
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
        });
      } catch (err) {
        await recordBlockchainSyncFailure(
          memberSyncId,
          err instanceof Error ? err.message : String(err)
        );
        throw err;
      }
      console.log('✅ Both wallets registered on-chain:', blockchainRef.txHash);

      // Bootstrap on-chain trustee relationship.
      // Dependent accounts have no independent signer at creation time, so the normal
      // propose → accept two-wallet flow is not possible. The admin wallet writes the
      // Active + Controller relationship directly in the same admin batch as addMemberBatch.
      // Revocation uses the normal onlyActiveMember flow — no admin involvement after this.
      //
      // gasLimit is set explicitly to skip ethers' automatic eth_estimateGas pre-flight call.
      // Confirmed via direct diagnostic (block-lag + userStatus readback) that a load-balanced
      // RPC provider can serve that estimation call from a backend node that hasn't yet caught
      // up to the addMemberBatch confirmation above — the resulting stale read reverts the
      // estimation with "Trustor not registered" before the transaction is ever submitted, even
      // though the member registration is already confirmed. Skipping estimation avoids that
      // stale read entirely; the transaction itself is still correctly sequenced by Base's
      // sequencer once submitted. 300,000 gas is generously above this function's actual usage
      // (5 requires, one array push, one struct write, two events).
      const guardianIdHash = ethers.id(guardianUid);
      const trusteeSyncId = await startBlockchainSyncAttempt({
        contract: 'MemberRoleManager',
        action: 'bootstrapDependentTrustee',
        userId: guardianUid,
        chainId: CHAIN_ID,
        contractAddress: MEMBER_ROLE_MANAGER_ADDRESS,
        context: {
          type: 'trustee-accept',
          trustorId: dependentUid,
          trustorIdHash: userIdHash,
          trusteeId: guardianUid,
          trusteeIdHash: guardianIdHash,
        },
      });
      let trusteeBlockchainRef;
      try {
        const trusteeTx = await contract.bootstrapDependentTrustee(userIdHash, guardianIdHash, {
          gasLimit: 300_000,
        });
        const trusteeReceipt = await trusteeTx.wait();
        if (!trusteeReceipt) throw new Error('Trustee transaction was dropped or replaced');
        trusteeBlockchainRef = {
          txHash: trusteeTx.hash,
          chainId: CHAIN_ID,
          blockNumber: trusteeReceipt.blockNumber,
          contractAddress: MEMBER_ROLE_MANAGER_ADDRESS,
        };
        await recordBlockchainSyncSuccess(trusteeSyncId, {
          txHash: trusteeTx.hash,
          blockNumber: trusteeReceipt.blockNumber,
        });
      } catch (err) {
        await recordBlockchainSyncFailure(
          trusteeSyncId,
          err instanceof Error ? err.message : String(err)
        );
        throw err;
      }
      console.log('✅ On-chain trustee relationship bootstrapped:', trusteeBlockchainRef.txHash);

      const encryptedWallet = encryptPrivateKey(wallet.privateKey, masterKeyHex);
      const encryptedMnemonic = encryptPrivateKey(wallet.mnemonic || '', masterKeyHex);

      await dependentRef.update({
        wallet: {
          address: wallet.address.toLowerCase(),
          smartAccountAddress: smartAccountAddress.toLowerCase(),
          origin: 'generated',
          encryptedPrivateKey: encryptedWallet.encryptedKey,
          encryptedPrivateKeyIV: encryptedWallet.iv,
          keyAuthTag: encryptedWallet.authTag,
          keySalt: encryptedWallet.salt,
          encryptedMnemonic: encryptedMnemonic.encryptedKey,
          mnemonicIv: encryptedMnemonic.iv,
          mnemonicAuthTag: encryptedMnemonic.authTag,
          mnemonicSalt: encryptedMnemonic.salt,
        },
        onChainIdentity: {
          userIdHash,
          onChainStatus: [
            { status: 'Active', statusUpdatedAt: now, statusBlockchainRef: blockchainRef },
          ],
          linkedWallets: [
            {
              address: wallet.address.toLowerCase(),
              type: 'eoa',
              isWalletActive: true,
              registeredAt: now,
              blockchainRef,
            },
            {
              address: smartAccountAddress.toLowerCase(),
              type: 'smartAccount',
              isWalletActive: true,
              registeredAt: now,
              blockchainRef,
            },
          ],
        },
      });
      console.log('✅ Wallet data saved to Firestore');

      // ── Step 4: Active controller trustee relationship + trusteeHistory audit entries ──────
      // trustorId = dependent (account owner), trusteeId = guardian (account manager).
      // Written via Admin SDK to bypass the client Firestore rule that requires
      // new relationships to start as status:'pending' / isActive:false.
      //
      // The two trusteeHistory entries mirror prepareTrusteeHistoryEventData/
      // buildTrusteeHistoryDocId (src/features/Trustee/services/writeTrusteeHistoryEvent.ts —
      // a frontend module using the client SDK, so replicated inline here rather than imported)
      // so findMatchingTrusteeHistoryForProposedEvent/ForAcceptedEvent
      // (functions/src/chainIndexer/reconciliationRules.ts) pick these up the same way as every
      // client-orchestrated trustee action. Without this, the TrusteeProposed/TrusteeAccepted
      // events bootstrapDependentTrustee emits on-chain always classify as admin_untracked even
      // though Firestore genuinely has the relationship recorded (belrose-health#810).
      // blockchainRef is set directly (not null + backfilled later) since the confirmed receipt
      // is already in hand at write time — unlike the client-orchestrated flow, there's no
      // separate deferred chain call to wait on here.
      const relationshipId = `${dependentUid}_${guardianUid}`;
      const relationshipRef = db.collection('trusteeRelationships').doc(relationshipId);
      const trusteeHistoryCollection = relationshipRef.collection('trusteeHistory');
      const buildHistoryDocId = () => `${Date.now()}_${guardianUid}_${randomUUID().slice(0, 8)}`;
      const baseHistoryEvent = {
        relationshipId,
        trustorId: dependentUid,
        trustorIdHash: userIdHash,
        trusteeId: guardianUid,
        trusteeIdHash: guardianIdHash,
        changedBy: guardianUid,
        changedByIdHash: guardianIdHash,
        changedAt: now,
        blockchainRef: trusteeBlockchainRef,
      };

      const relationshipBatch = db.batch();
      relationshipBatch.set(relationshipRef, {
        trustorId: dependentUid,
        trusteeId: guardianUid,
        trustLevel: 'controller',
        isActive: true,
        status: 'active',
        isDependentRelationship: true,
        createdAt: now,
        respondedAt: now,
        revokedAt: null,
        revokedBy: null,
        statusUpdateReason: null,
        inviteBlockchainRef: trusteeBlockchainRef,
        acceptBlockchainRef: trusteeBlockchainRef,
        revocationBlockchainRef: null,
        editBlockchainRef: null,
      });
      relationshipBatch.set(trusteeHistoryCollection.doc(buildHistoryDocId()), {
        ...baseHistoryEvent,
        action: 'propose',
        trustLevel: 'controller',
      });
      relationshipBatch.set(trusteeHistoryCollection.doc(buildHistoryDocId()), {
        ...baseHistoryEvent,
        action: 'accept',
      });
      await relationshipBatch.commit();
      console.log('✅ Controller trustee relationship + trusteeHistory entries created');

      return { uid: dependentUid, walletAddress: wallet.address, smartAccountAddress };
    } catch (err) {
      // Best-effort cleanup: remove the Auth user AND the Firestore users/{uid} doc from Step 2,
      // so a failure after that point doesn't leave an orphaned Firestore doc with no matching
      // Auth account behind forever. Each cleanup step is independent — a failure in one must
      // not prevent the other from being attempted. dependentRef.delete() is a safe no-op if
      // Step 2 itself never ran (e.g. Auth creation succeeded but the Firestore write failed).
      console.error('❌ Dependent account setup failed, cleaning up:', err);
      try {
        await admin.auth().deleteUser(dependentUid);
      } catch (cleanupErr) {
        console.error('❌ Auth user cleanup failed — may be orphaned:', cleanupErr);
      }
      try {
        await dependentRef.delete();
      } catch (cleanupErr) {
        console.error('❌ Firestore user doc cleanup failed — may be orphaned:', cleanupErr);
      }
      throw new HttpsError('internal', 'Failed to set up dependent account');
    }
  }
);
