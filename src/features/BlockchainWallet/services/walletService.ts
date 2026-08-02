// src/features/BlockchainWallet/services/walletService.ts
//
// wallet service that handles:
// - MetaMask browser connections
// - Firestore wallet data (CRUD)
// - Transaction signing (MetaMask + generated wallets)

import { ethers, Signer, JsonRpcProvider, BrowserProvider } from 'ethers';
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { WalletOrigin, UserWallet } from '@/types/core';
import { hexToUint8Array } from '@/utils/dataFormattingUtils';
import { buildRpcUrl } from '@belrose/shared';
import { requireEnv } from '@/utils/utils';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from MetaMask connection
 */
export interface WalletConnection {
  address: string;
  provider: any;
  balance?: string;
}

/**
 * Result from getSigner()
 */
export interface SignerResult {
  signer: Signer;
  address: string;
  origin: WalletOrigin;
}

/**
 * Result from canSign check
 */
export interface CanSignResult {
  canSign: boolean;
  reason?: string;
  walletOrigin?: WalletOrigin;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const RPC_URL = buildRpcUrl(requireEnv('VITE_ALCHEMY_API_KEY'));

// ============================================================================
// HELPER FUNCTIONS (Private)
// ============================================================================

/**
 * Derive decryption key from master key hex using PBKDF2
 * Matches the backend encryption in backendWalletService.ts
 */
async function deriveDecryptionKey(masterKeyHex: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(masterKeyHex);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

/**
 * Decrypt the wallet private key using the master key
 */
async function decryptWalletPrivateKey(
  encryptedKey: string,
  iv: string,
  authTag: string,
  salt: string,
  masterKey: CryptoKey
): Promise<string> {
  // Export master key to hex (this is what was used to encrypt)
  const masterKeyRaw = await crypto.subtle.exportKey('raw', masterKey);
  const masterKeyHex = Array.from(new Uint8Array(masterKeyRaw))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const encryptedData = hexToUint8Array(encryptedKey);
  const ivArray = hexToUint8Array(iv);
  const authTagArray = hexToUint8Array(authTag);
  const saltArray = hexToUint8Array(salt);

  // Derive the decryption key
  const decryptionKey = await deriveDecryptionKey(masterKeyHex, saltArray);

  // Combine encrypted data with auth tag (AES-GCM expects this format)
  const dataWithTag = new Uint8Array(encryptedData.length + authTagArray.length);
  dataWithTag.set(encryptedData, 0);
  dataWithTag.set(authTagArray, encryptedData.length);

  // Decrypt
  const decryptedData = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivArray.buffer as ArrayBuffer,
    },
    decryptionKey,
    dataWithTag
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

// ============================================================================
// WALLET SERVICE
// ============================================================================

export class WalletService {
  // Store MetaMask provider reference for the session
  private static metamaskProvider: any = null;

  // ==========================================================================
  // SECTION 1: METAMASK BROWSER CONNECTION
  // ==========================================================================

  /**
   * Check if MetaMask is installed
   */
  static isMetaMaskInstalled(): boolean {
    return typeof window !== 'undefined' && !!window.ethereum;
  }

  /**
   * Check if MetaMask is currently connected (has a cached provider)
   */
  static isMetaMaskConnected(): boolean {
    return this.metamaskProvider !== null;
  }

  /**
   * Connect to MetaMask browser extension
   * Triggers the MetaMask popup for user approval
   */
  static async connectMetaMask(): Promise<WalletConnection> {
    console.log('🦊 Starting MetaMask connection...');

    if (!this.isMetaMaskInstalled()) {
      throw new Error('MetaMask not installed. Please install MetaMask to continue.');
    }

    try {
      // Request account access
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new Error('No accounts found in MetaMask');
      }

      const address = accounts[0];
      console.log('✅ Connected to MetaMask:', address);

      // Get balance
      const balance = (await window.ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      })) as string;

      // Store provider reference
      this.metamaskProvider = window.ethereum;

      return {
        address,
        provider: window.ethereum,
        balance: balance ? parseInt(balance, 16).toString() : undefined,
      };
    } catch (error: any) {
      console.error('MetaMask connection failed:', error);

      // Handle specific MetaMask errors
      let errorMessage = error?.message || 'Unknown error';
      if (error?.code === 4001) {
        errorMessage = 'User rejected the connection request';
      } else if (error?.code === -32002) {
        errorMessage = 'Connection request already pending. Please check MetaMask.';
      }

      throw new Error(`MetaMask connection failed: ${errorMessage}`);
    }
  }

  /**
   * Disconnect MetaMask (clears cached provider)
   */
  static disconnectMetaMask(): void {
    this.metamaskProvider = null;
    console.log('🦊 MetaMask disconnected');
  }

  /**
   * Get current MetaMask wallet info (if connected)
   */
  static async getMetaMaskInfo(): Promise<{ address: string; balance?: string } | null> {
    if (!this.metamaskProvider) {
      return null;
    }

    try {
      const accounts = (await this.metamaskProvider.request({
        method: 'eth_accounts',
      })) as string[];

      if (!accounts || accounts.length === 0 || !accounts[0]) {
        return null;
      }

      const address = accounts[0];
      const balance = (await this.metamaskProvider.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      })) as string;

      return {
        address,
        balance: balance ? parseInt(balance, 16).toString() : undefined,
      };
    } catch (error) {
      console.error('Failed to get MetaMask info:', error);
      return null;
    }
  }

  // ==========================================================================
  // SECTION 2: FIRESTORE WALLET DATA
  // ==========================================================================

  /**
   * Get user's wallet data from Firestore
   */
  static async getUserWallet(userId: string): Promise<UserWallet | null> {
    const db = getFirestore();
    const userDoc = await getDoc(doc(db, 'users', userId));

    if (!userDoc.exists()) {
      return null;
    }

    return userDoc.data()?.wallet || null;
  }

  /**
   * Get user's wallet address (convenience method)
   */
  static async getUserWalletAddress(userId: string): Promise<string | null> {
    const wallet = await this.getUserWallet(userId);
    return wallet?.address || null;
  }

  /**
   * Like getUserWallet, but also reports whether the user profile document exists at all —
   * for callers (e.g. PermissionsService) that give a different error message for "this user
   * has never signed up" versus "this user exists but hasn't linked a wallet yet".
   */
  static async getUserWalletStatus(
    userId: string
  ): Promise<{ profileExists: boolean; wallet: UserWallet | null }> {
    const db = getFirestore();
    const userDoc = await getDoc(doc(db, 'users', userId));

    if (!userDoc.exists()) {
      return { profileExists: false, wallet: null };
    }

    return { profileExists: true, wallet: userDoc.data()?.wallet || null };
  }

  /**
   * Get current authenticated user's wallet
   */
  static async getCurrentUserWallet(): Promise<UserWallet | null> {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return this.getUserWallet(user.uid);
  }

  /**
   * Check if user has a wallet set up
   */
  static async hasWallet(userId: string): Promise<boolean> {
    const wallet = await this.getUserWallet(userId);
    return !!wallet?.address;
  }

  /**
   * Get user's wallet address, throwing if none is linked. Convenience for Firestore-first
   * flows that need to fail fast (before writing anything) when a chain-write step further
   * down will need a wallet — see e.g. SubjectService's anchor/unanchor methods.
   */
  static async requireUserWalletAddress(userId: string): Promise<string> {
    const walletAddress = await this.getUserWalletAddress(userId);

    if (!walletAddress) {
      throw new Error('You must have a linked wallet to perform blockchain actions');
    }

    return walletAddress;
  }

  /**
   * Save/link an external wallet (MetaMask, etc.) to user's account
   */
  static async saveExternalWallet(
    userId: string,
    address: string,
    origin: WalletOrigin = 'metamask'
  ): Promise<void> {
    const db = getFirestore();
    const userRef = doc(db, 'users', userId);

    const walletData: UserWallet = {
      address: address.toLowerCase(),
      origin,
    };

    await updateDoc(userRef, {
      wallet: walletData,
      updatedAt: serverTimestamp(),
    });

    console.log('💾 Wallet saved to Firestore:', address);
  }

  /**
   * Remove wallet from user's account
   * WARNING: For generated wallets, this removes encrypted keys permanently
   */
  static async removeWallet(userId: string): Promise<void> {
    const db = getFirestore();
    const userRef = doc(db, 'users', userId);

    await updateDoc(userRef, {
      wallet: null,
      updatedAt: serverTimestamp(),
    });

    console.log('🗑️ Wallet removed from Firestore');
  }

  /**
   * Check if a wallet address is already registered to another user
   */
  static async isWalletAvailable(
    walletAddress: string,
    excludeUserId?: string
  ): Promise<{ available: boolean; error?: string }> {
    try {
      const db = getFirestore();
      const normalizedAddress = walletAddress.toLowerCase();

      // Query for existing wallet
      const walletQuery = query(
        collection(db, 'users'),
        where('wallet.address', '==', normalizedAddress)
      );

      const results = await getDocs(walletQuery);

      // Check if any other user has this wallet
      const otherUserHasWallet = results.docs.some(doc => doc.id !== excludeUserId);

      if (otherUserHasWallet) {
        return {
          available: false,
          error: 'This wallet is already registered to another account.',
        };
      }

      return { available: true };
    } catch (error) {
      console.error('Error checking wallet availability:', error);
      return { available: true }; // Allow to proceed, blockchain will be final check
    }
  }

  // ==========================================================================
  // SECTION 3: TRANSACTION SIGNING
  // ==========================================================================

  /**
   * Get a signer for the current user
   * Automatically handles MetaMask vs generated wallet
   */
  static async getSigner(): Promise<SignerResult> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('User must be authenticated to get a signer');
    }

    const wallet = await this.getUserWallet(user.uid);

    if (!wallet) {
      throw new Error('No wallet found. Please set up a wallet first.');
    }

    let signer: Signer;

    switch (wallet.origin) {
      case 'metamask':
      case 'walletconnect':
      case 'hardware':
        signer = await this.getMetaMaskSigner(wallet.address);
        break;

      case 'generated':
        signer = await this.getGeneratedWalletSigner(wallet);
        break;

      default:
        throw new Error(`Unknown wallet origin: ${wallet.origin}`);
    }

    return {
      signer,
      address: wallet.address,
      origin: wallet.origin,
    };
  }

  /**
   * Get signer from MetaMask
   * Verifies the connected wallet matches the registered wallet
   */
  private static async getMetaMaskSigner(expectedAddress: string): Promise<Signer> {
    if (!this.isMetaMaskInstalled()) {
      throw new Error('MetaMask is not installed.');
    }

    // Ensure MetaMask is connected
    await window.ethereum.request({ method: 'eth_requestAccounts' });

    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    // Verify connected wallet matches registered wallet
    const connectedAddress = await signer.getAddress();
    if (connectedAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(
        `Wrong wallet connected. Expected ${expectedAddress.slice(0, 6)}...${expectedAddress.slice(-4)}, ` +
          `but MetaMask has ${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}. ` +
          `Please switch wallets in MetaMask.`
      );
    }

    return signer;
  }

  /**
   * Get signer from generated wallet
   * Decrypts private key using the session master key
   */
  private static async getGeneratedWalletSigner(wallet: UserWallet): Promise<Signer> {
    // Verify we have encrypted key data
    if (
      !wallet.encryptedPrivateKey ||
      !wallet.encryptedPrivateKeyIV ||
      !wallet.keyAuthTag ||
      !wallet.keySalt
    ) {
      throw new Error('Generated wallet is missing encryption data');
    }

    // Get master key from session
    const masterKey = await EncryptionKeyManager.getSessionKey();
    if (!masterKey) {
      throw new Error('Session expired. Please log in again to sign transactions.');
    }

    // Decrypt private key
    const privateKey = await decryptWalletPrivateKey(
      wallet.encryptedPrivateKey,
      wallet.encryptedPrivateKeyIV,
      wallet.keyAuthTag,
      wallet.keySalt,
      masterKey
    );

    // Create wallet with provider
    const provider = new JsonRpcProvider(RPC_URL);
    const walletSigner = new ethers.Wallet(privateKey, provider);

    // Verify address matches
    if (walletSigner.address.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error('Decrypted wallet address does not match. Data may be corrupted.');
    }

    return walletSigner;
  }

  /**
   * Check if user can currently sign transactions
   */
  static async canSign(): Promise<CanSignResult> {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      return { canSign: false, reason: 'Not authenticated' };
    }

    const wallet = await this.getUserWallet(user.uid);

    if (!wallet) {
      return { canSign: false, reason: 'No wallet configured' };
    }

    // Check based on wallet type
    if (wallet.origin === 'generated') {
      const masterKey = await EncryptionKeyManager.getSessionKey();
      if (!masterKey) {
        return {
          canSign: false,
          reason: 'Session expired. Please log in again.',
          walletOrigin: wallet.origin,
        };
      }
    } else {
      // External wallet - check MetaMask
      if (!this.isMetaMaskInstalled()) {
        return {
          canSign: false,
          reason: 'MetaMask not installed',
          walletOrigin: wallet.origin,
        };
      }
    }

    return { canSign: true, walletOrigin: wallet.origin };
  }

  // ==========================================================================
  // SECTION 4: UTILITY METHODS
  // ==========================================================================

  /**
   * Get wallet origin for current user
   */
  static async getWalletOrigin(): Promise<WalletOrigin | null> {
    const wallet = await this.getCurrentUserWallet();
    return wallet?.origin || null;
  }

  /**
   * Check if current user has a generated wallet
   */
  static async isGeneratedWallet(): Promise<boolean> {
    const wallet = await this.getCurrentUserWallet();
    return wallet?.origin === 'generated';
  }

  /**
   * Verify that MetaMask wallet matches the registered wallet
   */
  static async verifyMetaMaskMatch(userId: string): Promise<boolean> {
    const wallet = await this.getUserWallet(userId);
    if (!wallet) return false;

    const metamaskInfo = await this.getMetaMaskInfo();
    if (!metamaskInfo) return false;

    return wallet.address.toLowerCase() === metamaskInfo.address.toLowerCase();
  }
}

// ============================================================================
// TYPESCRIPT DECLARATIONS
// ============================================================================

declare global {
  interface Window {
    ethereum?: any;
  }
}
