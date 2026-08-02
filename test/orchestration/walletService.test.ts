// test/orchestration/walletService.test.ts
//
// Layer 3 (orchestration) — WalletService's Firestore-backed wallet lookups. Real Firestore
// emulator, no mocking needed for these methods. MetaMask/signing methods aren't covered here —
// they need a browser wallet provider, not a Firestore emulator.
//
// requireUserWalletAddress previously lived on the now-retired SubjectBlockchainService (a
// near-identical duplicate) — consolidated here since wallet lookups are WalletService's job.

import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { doc, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedUser } from './helpers/testFirestore';
import { WalletService } from '../../src/features/BlockchainWallet/services/walletService';

const WALLETED_USER = 'wallet-service-walleted-user';
const NO_WALLET_USER = 'wallet-service-no-wallet-user';

const db = connectTestFirestore('belrose-orchestration-wallet-service');

describe('WalletService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    await seedUser(db, WALLETED_USER, '0xWallet');
    await setDoc(doc(db, 'users', NO_WALLET_USER), {}); // profile exists but has no wallet
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('getUserWalletAddress', () => {
    it('returns null when the user profile does not exist', async () => {
      await expect(WalletService.getUserWalletAddress('nonexistent')).resolves.toBeNull();
    });

    it('returns null when the user has no wallet', async () => {
      await expect(WalletService.getUserWalletAddress(NO_WALLET_USER)).resolves.toBeNull();
    });

    it('returns the wallet address when present', async () => {
      await expect(WalletService.getUserWalletAddress(WALLETED_USER)).resolves.toBe('0xWallet');
    });
  });

  describe('requireUserWalletAddress', () => {
    it('throws when there is no wallet', async () => {
      await expect(WalletService.requireUserWalletAddress(NO_WALLET_USER)).rejects.toThrow(
        'You must have a linked wallet to perform blockchain actions'
      );
    });

    it('returns the address when present', async () => {
      await expect(WalletService.requireUserWalletAddress(WALLETED_USER)).resolves.toBe(
        '0xWallet'
      );
    });
  });

  describe('getUserWalletStatus', () => {
    it('reports profileExists: false and a null wallet when the profile does not exist', async () => {
      await expect(WalletService.getUserWalletStatus('nonexistent')).resolves.toEqual({
        profileExists: false,
        wallet: null,
      });
    });

    it('reports profileExists: true and a null wallet when the profile has no wallet linked', async () => {
      await expect(WalletService.getUserWalletStatus(NO_WALLET_USER)).resolves.toEqual({
        profileExists: true,
        wallet: null,
      });
    });

    it('reports profileExists: true and the wallet when present', async () => {
      await expect(WalletService.getUserWalletStatus(WALLETED_USER)).resolves.toEqual({
        profileExists: true,
        wallet: { address: '0xWallet' },
      });
    });
  });
});
