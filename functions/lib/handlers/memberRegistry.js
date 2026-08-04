"use strict";
// functions/src/handlers/memberRegistry.ts
// Backend functions for blockchain operations using admin wallet
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeRoleOnChainForRequester = exports.initializeRoleOnChain = exports.reactivateWalletOnChain = exports.deactivateWalletOnChain = exports.updateMemberStatus = exports.registerMemberOnChain = exports.registerMemberOnChainComplete = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const ethers_1 = require("ethers");
const _shared_1 = require("../_shared/");
const typechain_1 = require("../_shared/typechain");
const backendWalletService_1 = require("../services/backendWalletService");
const wallet_1 = require("./wallet");
const MEMBER_ROLE_MANAGER_ADDRESS = _shared_1.MEMBER_ROLE_MANAGER.proxy;
const CHAIN_ID = _shared_1.NETWORK.chainId;
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Get admin wallet from environment
 */
function getAdminWallet() {
    const privateKey = process.env.ADMIN_WALLET_PRIVATE_KEY;
    const rpcUrl = process.env.RPC_URL || _shared_1.NETWORK.rpcUrlFallback;
    if (!privateKey)
        throw new Error('Admin wallet private key not found');
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
    return new ethers_1.ethers.Wallet(privateKey, provider);
}
function getAdminContract() {
    return typechain_1.MemberRoleManager__factory.connect(MEMBER_ROLE_MANAGER_ADDRESS, getAdminWallet());
}
async function awaitTx(tx) {
    const receipt = await tx.wait();
    if (!receipt)
        throw new https_1.HttpsError('internal', 'Transaction was dropped or replaced');
    return receipt;
}
function buildMemberRegistryRef(txHash, blockNumber) {
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
exports.registerMemberOnChainComplete = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    const { masterKeyHex } = request.data;
    const userId = request.auth.uid;
    if (!masterKeyHex) {
        throw new https_1.HttpsError('invalid-argument', 'masterKeyHex is required');
    }
    const db = (0, firestore_1.getFirestore)();
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data();
    if (!userData)
        throw new https_1.HttpsError('not-found', 'User not found');
    if (userData?.wallet?.address && !userData?.isGuest) {
        throw new https_1.HttpsError('already-exists', 'User already has a wallet');
    }
    console.log('🔐 Generating EOA wallet...');
    const wallet = (0, backendWalletService_1.generateWallet)();
    console.log('✅ EOA address:', wallet.address);
    console.log('🧮 Computing smart account address...');
    const smartAccountAddress = await (0, wallet_1.computeSmartAccountAddress)(wallet.privateKey);
    console.log('✅ Smart account address:', smartAccountAddress);
    // Register both on-chain in one transaction
    console.log('⛓️ Registering both wallets on-chain via addMemberBatch...');
    const userIdHash = ethers_1.ethers.id(userId);
    const contract = getAdminContract();
    const tx = await contract.addMemberBatch([wallet.address, smartAccountAddress], userIdHash);
    const receipt = await awaitTx(tx);
    const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);
    console.log('✅ Both wallets registered on-chain:', tx.hash);
    // Encrypt wallet data
    const encryptedData = (0, backendWalletService_1.encryptPrivateKey)(wallet.privateKey, masterKeyHex);
    const encryptedMnemonic = (0, backendWalletService_1.encryptPrivateKey)(wallet.mnemonic || '', masterKeyHex);
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
                    statusUpdatedAt: firestore_1.Timestamp.now(),
                    statusBlockchainRef: blockchainRef,
                },
            ],
            linkedWallets: [
                {
                    address: wallet.address.toLowerCase(),
                    type: 'eoa',
                    isWalletActive: true,
                    registeredAt: firestore_1.Timestamp.now(),
                    blockchainRef,
                },
                {
                    address: smartAccountAddress.toLowerCase(),
                    type: 'smartAccount',
                    isWalletActive: true,
                    registeredAt: firestore_1.Timestamp.now(),
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
});
/**
 * Register a new member/Wallet combination on the blockchain
 * One member can be associated with multiple wallets
 */
exports.registerMemberOnChain = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    const { walletAddress } = request.data;
    const userId = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    // Validate wallet address
    if (!walletAddress || !ethers_1.ethers.isAddress(walletAddress)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid wallet address');
    }
    console.log('🔗 Registering member on blockchain:', { userId, walletAddress });
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        if (!userData)
            throw new https_1.HttpsError('not-found', 'User profile not found');
        // IDEMPOTENCY CHECK: Don't re-register if this specific wallet is already in our array
        const existingWallets = userData.onChainIdentity?.linkedWallets || [];
        const alreadyLinked = existingWallets.some((w) => w.address.toLowerCase() === walletAddress.toLowerCase());
        if (alreadyLinked) {
            return { success: true, message: 'Wallet already registered in Firestore' };
        }
        const isSmartAccount = walletAddress.toLowerCase() === userData.wallet?.smartAccountAddress?.toLowerCase();
        const walletLabel = isSmartAccount ? 'smart-account' : 'eoa';
        // 3. Contract Call
        const userIdHash = ethers_1.ethers.id(userId);
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
            'onChainIdentity.linkedWallets': firestore_1.FieldValue.arrayUnion({
                address: walletAddress,
                type: walletLabel,
                blockchainRef,
                linkedAt: firestore_1.Timestamp.now(),
                isWalletActive: true,
            }),
        });
        return { success: true, blockchainRef };
    }
    catch (error) {
        console.error('❌ Member registration failed:', error);
        // Handle "already registered" from smart contract
        if (error.message?.includes('Wallet already registered')) {
            return { success: true, message: 'Wallet already registered on chain' };
        }
        throw new https_1.HttpsError('internal', error.message);
    }
});
// ============================================================================
// MEMBER STATUS
// ============================================================================
/**
 * Update member status (e.g., after identity verification)
 * Called by backend after Persona verification completes
 */
exports.updateMemberStatus = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    const { userId, status } = request.data;
    if (!userId || ![1, 2, 3, 4, 5].includes(status)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid userId or status');
    }
    try {
        const userIdHash = ethers_1.ethers.id(userId);
        const contract = getAdminContract();
        const tx = await contract.setUserStatus(userIdHash, status);
        const receipt = await awaitTx(tx);
        const blockchainRef = buildMemberRegistryRef(tx.hash, receipt.blockNumber);
        // Sync the status change to Firestore
        const statusMap = {
            1: 'Inactive',
            2: 'Active',
            3: 'Verified',
            4: 'VerifiedProvider',
            5: 'Guest',
        };
        await (0, firestore_1.getFirestore)()
            .collection('users')
            .doc(userId)
            .update({
            'onChainIdentity.onChainStatus': firestore_1.FieldValue.arrayUnion({
                status: statusMap[status],
                statusUpdatedAt: firestore_1.Timestamp.now(),
                statusBlockchainRef: blockchainRef,
            }),
        });
        return { success: true, blockchainRef };
    }
    catch (error) {
        console.error('❌ Status update failed:', error);
        throw new https_1.HttpsError('internal', error.message);
    }
});
// ============================================================================
// WALLET STATUS (INDIVIDUAL WALLET)
// ============================================================================
/**
 * Deactivate a specific wallet on the blockchain
 * The user's identity remains active, but this wallet cannot transact
 */
exports.deactivateWalletOnChain = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    const { walletAddress } = request.data;
    const userId = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    if (!walletAddress || !ethers_1.ethers.isAddress(walletAddress)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid wallet address');
    }
    console.log('🔗 Deactivating wallet on blockchain:', { userId, walletAddress });
    try {
        // Verify wallet belongs to this user
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        if (!userData)
            throw new https_1.HttpsError('not-found', 'User profile not found');
        const linkedWallets = userData.onChainIdentity?.linkedWallets || [];
        const walletEntry = linkedWallets.find((w) => w.address.toLowerCase() === walletAddress.toLowerCase());
        if (!walletEntry) {
            throw new https_1.HttpsError('permission-denied', 'Wallet not linked to your account');
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
        const updatedWallets = linkedWallets.map((w) => w.address.toLowerCase() === walletAddress.toLowerCase()
            ? {
                ...w,
                isWalletActive: false,
                deactivatedAt: firestore_1.Timestamp.now(),
                blockchainRef,
            }
            : w);
        await db.collection('users').doc(userId).update({
            'onChainIdentity.linkedWallets': updatedWallets,
        });
        console.log('✅ Wallet deactivated:', tx.hash);
        return { success: true, blockchainRef };
    }
    catch (error) {
        console.error('❌ Wallet deactivation failed:', error);
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', error.message);
    }
});
/**
 * Reactivate a specific wallet on the blockchain
 */
exports.reactivateWalletOnChain = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    const { walletAddress } = request.data;
    const userId = request.auth.uid;
    const db = (0, firestore_1.getFirestore)();
    if (!walletAddress || !ethers_1.ethers.isAddress(walletAddress)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid wallet address');
    }
    console.log('🔗 Reactivating wallet on blockchain:', { userId, walletAddress });
    try {
        // Verify wallet belongs to this user
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        if (!userData)
            throw new https_1.HttpsError('not-found', 'User profile not found');
        const linkedWallets = userData.onChainIdentity?.linkedWallets || [];
        const walletEntry = linkedWallets.find((w) => w.address.toLowerCase() === walletAddress.toLowerCase());
        if (!walletEntry) {
            throw new https_1.HttpsError('permission-denied', 'Wallet not linked to your account');
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
        const updatedWallets = linkedWallets.map((w) => w.address.toLowerCase() === walletAddress.toLowerCase()
            ? {
                ...w,
                isWalletActive: true,
                reactivatedAt: firestore_1.Timestamp.now(),
                blockchainRef,
            }
            : w);
        await db.collection('users').doc(userId).update({
            'onChainIdentity.linkedWallets': updatedWallets,
        });
        console.log('✅ Wallet reactivated:', tx.hash);
        return { success: true, blockchainRef };
    }
    catch (error) {
        console.error('❌ Wallet reactivation failed:', error);
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', error.message);
    }
});
// ============================================================================
// RECORD INITIALIZATION
// ============================================================================
exports.initializeRoleOnChain = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    const { recordId, walletAddress, role } = request.data;
    const userId = request.auth.uid;
    if (!recordId || !ethers_1.ethers.isAddress(walletAddress)) {
        throw new https_1.HttpsError('invalid-argument', 'Missing recordId or walletAddress');
    }
    if (role !== 'administrator' && role !== 'owner') {
        throw new https_1.HttpsError('invalid-argument', 'Role must be "administrator" or "owner"');
    }
    const db = (0, firestore_1.getFirestore)();
    // 1. Fetch User and Record Data
    const [userDoc, recordDoc] = await Promise.all([
        db.collection('users').doc(userId).get(),
        db.collection('records').doc(recordId).get(),
    ]);
    const userData = userDoc.data();
    const recordData = recordDoc.data();
    if (!userData || !recordData)
        throw new https_1.HttpsError('not-found', 'Data not found');
    const recordIdHash = recordData.recordIdHash ?? ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(recordId));
    // 2. Validate multi-wallet ownership via our new array
    const linkedWallets = userData.onChainIdentity?.linkedWallets || [];
    const isAuthorized = linkedWallets.some((w) => w.address.toLowerCase() === walletAddress.toLowerCase() && w.isWalletActive);
    if (!isAuthorized) {
        throw new https_1.HttpsError('permission-denied', 'Wallet not linked or inactive');
    }
    if (recordData?.uploadedBy !== userId) {
        throw new https_1.HttpsError('permission-denied', 'Only the creator can initialize roles');
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
            throw new https_1.HttpsError('already-exists', 'Record already initialized on chain');
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
                blockchainInitializedAt: firestore_1.Timestamp.now(),
                blockchainRef,
            },
        });
        return { success: true, blockchainRef };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', `Blockchain error: ${error.message}`);
    }
});
/**
 * Cloud function for guest access fulfillment flow — initializes record on-chain with requester as admin
 * Rather than the creator themselves. In this flow the guest has no wallet, so the admin wallet calls initializeRecordRole directly with the requester's linked wallet.
 */
exports.initializeRoleOnChainForRequester = (0, https_1.onCall)({ secrets: ['ADMIN_WALLET_PRIVATE_KEY', 'RPC_URL'] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    const { recordId, requesterUserId, role } = request.data;
    if (!recordId || !requesterUserId) {
        throw new https_1.HttpsError('invalid-argument', 'Missing recordId or requesterUserId');
    }
    if (role !== 'administrator' && role !== 'owner') {
        throw new https_1.HttpsError('invalid-argument', 'Role must be administrator or owner');
    }
    const db = (0, firestore_1.getFirestore)();
    // Verify caller uploaded this record
    const recordDoc = await db.collection('records').doc(recordId).get();
    const recordData = recordDoc.data();
    if (!recordData)
        throw new https_1.HttpsError('not-found', 'Record not found');
    if (recordData.uploadedBy !== request.auth.uid) {
        throw new https_1.HttpsError('permission-denied', 'Only the uploader can initialize roles');
    }
    // Resolve recordIdHash — prefer stored value, compute as fallback
    const recordIdHash = recordData.recordIdHash ?? ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(recordId));
    // Get requester's wallet
    const requesterDoc = await db.collection('users').doc(requesterUserId).get();
    const requesterData = requesterDoc.data();
    if (!requesterData)
        throw new https_1.HttpsError('not-found', 'Requester not found');
    const linkedWallets = requesterData.onChainIdentity?.linkedWallets || [];
    const activeWallet = linkedWallets.find((w) => w.isWalletActive);
    if (!activeWallet) {
        throw new https_1.HttpsError('failed-precondition', 'Requester has no active wallet');
    }
    try {
        const contract = getAdminContract();
        // Idempotency check
        const { owners, admins } = await contract.getAllRecordParticipants(recordIdHash);
        if (owners.length > 0 || admins.length > 0) {
            throw new https_1.HttpsError('already-exists', 'Record already initialized on chain');
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
                blockchainInitializedAt: firestore_1.Timestamp.now(),
                blockchainRef,
            },
        });
        return { success: true, blockchainRef };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError('internal', `Blockchain error: ${error.message}`);
    }
});
//# sourceMappingURL=memberRegistry.js.map