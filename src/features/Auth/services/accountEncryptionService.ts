// src/features/Auth/services/accountEncryptionService.ts
//
// Shared E2EE account-bootstrap logic, extracted out of RegistrationForm/
// DependentAccountService/GuestClaimAccountModal, which previously each duplicated
// this crypto-generation sequence near byte-for-byte. All key material is generated
// here, client-side, via WebCrypto — the server never sees a plaintext master key.

import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { SharingKeyManagementService } from '@/features/Sharing/services/sharingKeyManagementService';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';
import { MemberRegistryBlockchain } from './memberRegistryBlockchain';
import { WalletGenerationService } from './walletGenerationService';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/utils/dataFormattingUtils';
import { BlockchainRef } from '@belrose/shared';

export interface EncryptionBootstrapBundle {
  masterKey: CryptoKey; // live key — caller decides if/when to setSessionKey
  encryptedMasterKey: string;
  masterKeyIV: string;
  masterKeySalt: string;
  recoveryKey: string; // plaintext 24-word mnemonic — caller displays once, never persists
  recoveryKeyHash: string;
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedPrivateKeyIV: string;
}

export interface WalletRegistrationResult {
  masterKeyHex: string;
  walletAddress: string;
  smartAccountAddress: string;
  blockchainRef: BlockchainRef;
}

export class AccountEncryptionService {
  /**
   * Generates a full E2EE identity for a new account: a master key wrapped with
   * `password`, a 24-word recovery key derived from it, and an RSA keypair whose
   * private key is encrypted with the master key. Pure crypto generation — no
   * Firestore/session/network side effects; the caller decides what to do with
   * the result (persist it, call EncryptionKeyManager.setSessionKey, etc).
   */
  static async generateEncryptionBundle(password: string): Promise<EncryptionBootstrapBundle> {
    const masterKey = await EncryptionKeyManager.generateMasterKey();

    const { encryptedKey, iv, salt } = await EncryptionKeyManager.wrapMasterKeyWithPassword(
      masterKey,
      password
    );

    const recoveryKey = await EncryptionKeyManager.generateRecoveryKeyFromMasterKey(masterKey);
    const recoveryKeyHash = await EncryptionKeyManager.hashRecoveryKey(recoveryKey);

    const { publicKey, privateKey } = await SharingKeyManagementService.generateUserKeyPair();

    const privateKeyBytes = base64ToArrayBuffer(privateKey);
    const { encrypted: encryptedPrivateKeyBuffer, iv: privateKeyIV } =
      await EncryptionService.encryptFile(privateKeyBytes, masterKey);

    return {
      masterKey,
      encryptedMasterKey: encryptedKey,
      masterKeyIV: iv,
      masterKeySalt: salt,
      recoveryKey,
      recoveryKeyHash,
      publicKey,
      encryptedPrivateKey: arrayBufferToBase64(encryptedPrivateKeyBuffer),
      encryptedPrivateKeyIV: arrayBufferToBase64(privateKeyIV),
    };
  }

  /**
   * Converts the master key to hex, then calls the registerMemberOnChainComplete
   * Cloud Function, which generates the wallet server-side and registers it
   * on-chain using the admin wallet as signer (the user has no wallet/signer yet —
   * that's what this call creates). masterKeyHex is sent to the function
   * transiently so it can encrypt the new wallet's private key before persisting
   * it; the hex itself is never stored server-side.
   */
  static async registerWalletOnChain(masterKey: CryptoKey): Promise<WalletRegistrationResult> {
    const masterKeyHex = await WalletGenerationService.convertMasterKeyToHex(masterKey);
    const { walletAddress, smartAccountAddress, blockchainRef } =
      await MemberRegistryBlockchain.registerMemberOnChainComplete(masterKeyHex);

    return { masterKeyHex, walletAddress, smartAccountAddress, blockchainRef };
  }
}
