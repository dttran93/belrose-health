// functions/src/handlers/memberRegistry.ts
// Backend functions for blockchain operations using admin wallet

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ethers } from 'ethers';
import { BlockchainRef, MEMBER_ROLE_MANAGER, NETWORK } from '../_shared/';
import { MemberRoleManager__factory } from '../_shared/typechain';
import type { MemberRoleManager } from '../_shared/typechain';
import { encryptPrivateKey, generateWallet } from '../services/backendWalletService';
import { computeSmartAccountAddress } from './wallet';

const MEMBER_ROLE_MANAGER_ADDRESS = MEMBER_ROLE_MANAGER.proxy;
const CHAIN_ID = NETWORK.chainId;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get admin wallet from environment
 */
function getAdminWallet(): ethers.Wallet {
  const privateKey = process.env.ADMIN_WALLET_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL || NETWORK.rpcUrlFallback;
  if (!privateKey) throw new Error('Admin wallet private key not found');
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(privateKey, provider);
}

function getAdminContract(): MemberRoleManager {
  return MemberRoleManager__factory.connect(MEMBER_ROLE_MANAGER_ADDRESS, getAdminWallet());
}

async function awaitTx(
  tx: ethers.ContractTransactionResponse
): Promise<ethers.ContractTransactionReceipt> {
  const receipt = await tx.wait();
  if (!receipt) throw new HttpsError('internal', 'Transaction was dropped or replaced');
  return receipt;
}

function buildMemberRegistryRef(txHash: string, blockNumber: number): BlockchainRef {
  return {
    txHash,
    chainId: CHAIN_ID,
    blockNumber,
    contractAddress: MEMBER_ROLE_MANAGER_ADDRESS,
  };
}

// ============================================================================
// MEMBER REGISTRATION & WALLET LINKING
// ============================================================================

export const registerMemberOnChainComplete = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');

    const { masterKeyHex } = request.data;
    const userId = request.auth.uid;

    if (!masterKeyHex) {
      throw new HttpsError('invalid-argument', 'masterKeyHex is required');
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data();

    if (!userData) throw new HttpsError('not-found', 'User not found');
    if (userData?.wallet?.address && !userData?.isGuest) {
      throw new HttpsError('already-exists', 'User already has a wallet');
    }

    console.log('🔐 Generating EOA wallet...');
    const wallet = generateWallet();
    console.log('✅ EOA address:', wallet.address);

    console.log('🧮 Computing smart account address...');
    const smartAccountAddress = await computeSmartAccountAddress(wallet.privateKey);
    console.log('✅ Smart account address:', smartAccountAddress);

    // Register both on-chain in one transaction
    console.log('⛓️ Registering both wallets on-chain via addMemberBatch...');
    const userIdHash = ethers.id(userId);
    const contract = getAdminContract();

    const tx = await contract.addMemberBatch([wallet.address, smartAccountAddress], userIdHash);
    const receipt = await awaitTx(tx);
    const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);
    console.log('✅ Both wallets registered on-chain:', tx.hash);

    // Encrypt wallet data
    const encryptedData = encryptPrivateKey(wallet.privateKey, masterKeyHex);
    const encryptedMnemonic = encryptPrivateKey(wallet.mnemonic || '', masterKeyHex);

    // Save everything to Firestore
    await userRef.update({
      wallet: {
        address: wallet.address.toLowerCase(),
        smartAccountAddress: smartAccountAddress.toLowerCase(),
        origin: 'generated',
        encryptedPrivateKey: encryptedData.encryptedKey,
        encryptedPrivateKeyIV: encryptedData.iv,
        keyAuthTag: encryptedData.authTag,
        keySalt: encryptedData.salt,
        encryptedMnemonic: encryptedMnemonic.encryptedKey,
        mnemonicIv: encryptedMnemonic.iv,
        mnemonicAuthTag: encryptedMnemonic.authTag,
        mnemonicSalt: encryptedMnemonic.salt,
      },
      onChainIdentity: {
        userIdHash,
        onChainStatus: [
          {
            status: 'Active',
            statusUpdatedAt: Timestamp.now(),
            statusBlockchainRef: blockchainRef,
          },
        ],
        linkedWallets: [
          {
            address: wallet.address.toLowerCase(),
            type: 'eoa',
            isWalletActive: true,
            registeredAt: Timestamp.now(),
            blockchainRef,
          },
          {
            address: smartAccountAddress.toLowerCase(),
            type: 'smartAccount',
            isWalletActive: true,
            registeredAt: Timestamp.now(),
            blockchainRef,
          },
        ],
      },
    });

    console.log('✅ Registration complete for user:', userId);

    return {
      success: true,
      walletAddress: wallet.address,
      smartAccountAddress,
      encryptedPrivateKey: encryptedData.encryptedKey,
      encryptedPrivateKeyIV: encryptedData.iv,
      authTag: encryptedData.authTag,
      blockchainRef,
    };
  }
);

/**
 * Register a new member/Wallet combination on the blockchain
 * One member can be associated with multiple wallets
 */
export const registerMemberOnChain = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');

    const { walletAddress } = request.data;
    const userId = request.auth.uid;
    const db = getFirestore();

    // Validate wallet address
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      throw new HttpsError('invalid-argument', 'Invalid wallet address');
    }

    console.log('🔗 Registering member on blockchain:', { userId, walletAddress });

    try {
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();
      if (!userData) throw new HttpsError('not-found', 'User profile not found');

      // IDEMPOTENCY CHECK: Don't re-register if this specific wallet is already in our array
      const existingWallets = userData.onChainIdentity?.linkedWallets || [];
      const alreadyLinked = existingWallets.some(
        (w: any) => w.address.toLowerCase() === walletAddress.toLowerCase()
      );

      if (alreadyLinked) {
        return { success: true, message: 'Wallet already registered in Firestore' };
      }

      const isSmartAccount =
        walletAddress.toLowerCase() === userData.wallet?.smartAccountAddress?.toLowerCase();
      const walletLabel = isSmartAccount ? 'smart-account' : 'eoa';

      // 3. Contract Call
      const userIdHash = ethers.id(userId);
      const contract = getAdminContract();

      // Smart Contract Call
      const tx = await contract.addMember(walletAddress, userIdHash);
      const receipt = await awaitTx(tx);
      const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);

      //4. Update Firestore
      await db
        .collection('users')
        .doc(userId)
        .update({
          'onChainIdentity.userIdHash': userIdHash,
          'onChainIdentity.linkedWallets': FieldValue.arrayUnion({
            address: walletAddress,
            type: walletLabel,
            blockchainRef,
            linkedAt: Timestamp.now(),
            isWalletActive: true,
          }),
        });

      return { success: true, blockchainRef };
    } catch (error: any) {
      console.error('❌ Member registration failed:', error);

      // Handle "already registered" from smart contract
      if (error.message?.includes('Wallet already registered')) {
        return { success: true, message: 'Wallet already registered on chain' };
      }

      throw new HttpsError('internal', error.message);
    }
  }
);

// ============================================================================
// MEMBER STATUS
// ============================================================================

/**
 * Update member status (e.g., after identity verification)
 * Called by backend after Persona verification completes
 */
export const updateMemberStatus = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    const { userId, status } = request.data;

    if (!userId || ![1, 2, 3, 4, 5].includes(status)) {
      throw new HttpsError('invalid-argument', 'Invalid userId or status');
    }

    try {
      const userIdHash = ethers.id(userId);
      const contract = getAdminContract();
      const tx = await contract.setUserStatus(userIdHash, status);
      const receipt = await awaitTx(tx);
      const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);

      // Sync the status change to Firestore
      const statusMap: Record<number, string> = {
        1: 'Inactive',
        2: 'Active',
        3: 'Verified',
        4: 'VerifiedProvider',
        5: 'Guest',
      };
      await getFirestore()
        .collection('users')
        .doc(userId)
        .update({
          'onChainIdentity.onChainStatus': FieldValue.arrayUnion({
            status: statusMap[status],
            statusUpdatedAt: Timestamp.now(),
            statusBlockchainRef: blockchainRef,
          }),
        });

      return { success: true, blockchainRef };
    } catch (error: any) {
      console.error('❌ Status update failed:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

// ============================================================================
// WALLET STATUS (INDIVIDUAL WALLET)
// ============================================================================

/**
 * Deactivate a specific wallet on the blockchain
 * The user's identity remains active, but this wallet cannot transact
 */
export const deactivateWalletOnChain = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');

    const { walletAddress } = request.data;
    const userId = request.auth.uid;
    const db = getFirestore();

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      throw new HttpsError('invalid-argument', 'Invalid wallet address');
    }

    console.log('🔗 Deactivating wallet on blockchain:', { userId, walletAddress });

    try {
      // Verify wallet belongs to this user
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();
      if (!userData) throw new HttpsError('not-found', 'User profile not found');

      const linkedWallets = userData.onChainIdentity?.linkedWallets || [];
      const walletEntry = linkedWallets.find(
        (w: any) => w.address.toLowerCase() === walletAddress.toLowerCase()
      );

      if (!walletEntry) {
        throw new HttpsError('permission-denied', 'Wallet not linked to your account');
      }

      if (!walletEntry.isWalletActive) {
        return { success: true, message: 'Wallet already inactive' };
      }

      // Call smart contract
      const contract = getAdminContract();
      const tx = await contract.deactivateWallet(walletAddress);
      const receipt = await awaitTx(tx);
      const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);

      // Update Firestore - mark wallet as inactive
      const updatedWallets = linkedWallets.map((w: any) =>
        w.address.toLowerCase() === walletAddress.toLowerCase()
          ? {
              ...w,
              isWalletActive: false,
              deactivatedAt: Timestamp.now(),
              blockchainRef,
            }
          : w
      );

      await db.collection('users').doc(userId).update({
        'onChainIdentity.linkedWallets': updatedWallets,
      });

      console.log('✅ Wallet deactivated:', tx.hash);
      return { success: true, blockchainRef };
    } catch (error: any) {
      console.error('❌ Wallet deactivation failed:', error);

      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', error.message);
    }
  }
);

/**
 * Reactivate a specific wallet on the blockchain
 */
export const reactivateWalletOnChain = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');

    const { walletAddress } = request.data;
    const userId = request.auth.uid;
    const db = getFirestore();

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      throw new HttpsError('invalid-argument', 'Invalid wallet address');
    }

    console.log('🔗 Reactivating wallet on blockchain:', { userId, walletAddress });

    try {
      // Verify wallet belongs to this user
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();
      if (!userData) throw new HttpsError('not-found', 'User profile not found');

      const linkedWallets = userData.onChainIdentity?.linkedWallets || [];
      const walletEntry = linkedWallets.find(
        (w: any) => w.address.toLowerCase() === walletAddress.toLowerCase()
      );

      if (!walletEntry) {
        throw new HttpsError('permission-denied', 'Wallet not linked to your account');
      }

      if (walletEntry.isWalletActive) {
        return { success: true, message: 'Wallet already active' };
      }

      // Call smart contract
      const contract = getAdminContract();
      const tx = await contract.reactivateWallet(walletAddress);
      const receipt = await awaitTx(tx);
      const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);

      // Update Firestore - mark wallet as active
      const updatedWallets = linkedWallets.map((w: any) =>
        w.address.toLowerCase() === walletAddress.toLowerCase()
          ? {
              ...w,
              isWalletActive: true,
              reactivatedAt: Timestamp.now(),
              blockchainRef,
            }
          : w
      );

      await db.collection('users').doc(userId).update({
        'onChainIdentity.linkedWallets': updatedWallets,
      });

      console.log('✅ Wallet reactivated:', tx.hash);
      return { success: true, blockchainRef };
    } catch (error: any) {
      console.error('❌ Wallet reactivation failed:', error);

      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', error.message);
    }
  }
);

// ============================================================================
// RECORD INITIALIZATION
// ============================================================================

export const initializeRoleOnChain = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');

    const { recordId, walletAddress, role } = request.data;
    const userId = request.auth.uid;

    if (!recordId || !ethers.isAddress(walletAddress)) {
      throw new HttpsError('invalid-argument', 'Missing recordId or walletAddress');
    }

    if (role !== 'administrator' && role !== 'owner') {
      throw new HttpsError('invalid-argument', 'Role must be "administrator" or "owner"');
    }

    const db = getFirestore();

    // 1. Fetch User and Record Data
    const [userDoc, recordDoc] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('records').doc(recordId).get(),
    ]);

    const userData = userDoc.data();
    const recordData = recordDoc.data();

    if (!userData || !recordData) throw new HttpsError('not-found', 'Data not found');

    const recordIdHash = recordData.recordIdHash ?? ethers.keccak256(ethers.toUtf8Bytes(recordId));

    // 2. Validate multi-wallet ownership via our new array
    const linkedWallets = userData.onChainIdentity?.linkedWallets || [];
    const isAuthorized = linkedWallets.some(
      (w: any) => w.address.toLowerCase() === walletAddress.toLowerCase() && w.isWalletActive
    );

    if (!isAuthorized) {
      throw new HttpsError('permission-denied', 'Wallet not linked or inactive');
    }

    if (recordData?.uploadedBy !== userId) {
      throw new HttpsError('permission-denied', 'Only the creator can initialize roles');
    }

    // 3. Authority Check
    try {
      const contract = getAdminContract();
      const { owners, admins } = await contract.getAllRecordParticipants(recordIdHash);

      if (owners.length > 0 || admins.length > 0) {
        // Self-heal Firestore if needed
        if (!recordData?.blockchainRoleInitialization?.blockchainInitialized) {
          await db.collection('records').doc(recordId).update({
            'blockchainRoleInitialization.blockchainInitialized': true,
            'blockchainRoleInitialization.syncedFromChain': true,
          });
        }
        throw new HttpsError('already-exists', 'Record already initialized on chain');
      }

      // 4. Execution
      const tx = await contract.initializeRecordRole(recordIdHash, walletAddress, role);
      const receipt = await awaitTx(tx);
      const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);

      await db
        .collection('records')
        .doc(recordId)
        .update({
          blockchainRoleInitialization: {
            blockchainInitialized: true,
            blockchainInitializedAt: Timestamp.now(),
            blockchainRef,
          },
        });

      return { success: true, blockchainRef };
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', `Blockchain error: ${error.message}`);
    }
  }
);

/**
 * Cloud function for guest access fulfillment flow — initializes record on-chain with requester as admin
 * Rather than the creator themselves. In this flow the guest has no wallet, so the admin wallet calls initializeRecordRole directly with the requester's linked wallet.
 */
export const initializeRoleOnChainForRequester = onCall(
  { secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');

    const { recordId, requesterUserId, role } = request.data;

    if (!recordId || !requesterUserId) {
      throw new HttpsError('invalid-argument', 'Missing recordId or requesterUserId');
    }
    if (role !== 'administrator' && role !== 'owner') {
      throw new HttpsError('invalid-argument', 'Role must be administrator or owner');
    }

    const db = getFirestore();

    // Verify caller uploaded this record
    const recordDoc = await db.collection('records').doc(recordId).get();
    const recordData = recordDoc.data();
    if (!recordData) throw new HttpsError('not-found', 'Record not found');
    if (recordData.uploadedBy !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the uploader can initialize roles');
    }

    // Resolve recordIdHash — prefer stored value, compute as fallback
    const recordIdHash = recordData.recordIdHash ?? ethers.keccak256(ethers.toUtf8Bytes(recordId));

    // Get requester's wallet
    const requesterDoc = await db.collection('users').doc(requesterUserId).get();
    const requesterData = requesterDoc.data();
    if (!requesterData) throw new HttpsError('not-found', 'Requester not found');

    const linkedWallets = requesterData.onChainIdentity?.linkedWallets || [];
    const activeWallet = linkedWallets.find((w: any) => w.isWalletActive);
    if (!activeWallet) {
      throw new HttpsError('failed-precondition', 'Requester has no active wallet');
    }

    try {
      const contract = getAdminContract();

      // Idempotency check
      const { owners, admins } = await contract.getAllRecordParticipants(recordIdHash);
      if (owners.length > 0 || admins.length > 0) {
        throw new HttpsError('already-exists', 'Record already initialized on chain');
      }

      const tx = await contract.initializeRecordRole(recordIdHash, activeWallet.address, role);
      const receipt = await awaitTx(tx);
      const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);

      await db
        .collection('records')
        .doc(recordId)
        .update({
          blockchainRoleInitialization: {
            blockchainInitialized: true,
            blockchainInitializedAt: Timestamp.now(),
            blockchainRef,
          },
        });

      return { success: true, blockchainRef };
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', `Blockchain error: ${error.message}`);
    }
  }
);
