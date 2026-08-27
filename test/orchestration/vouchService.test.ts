// test/orchestration/vouchService.test.ts
//
// Layer 3 (orchestration) — vouchService.ts, same Firestore-first shape as
// verificationService.test.ts/disputeService.test.ts (see verificationService.test.ts's header
// for the general pattern). Notably simpler: vouchService.ts takes voucherId as an explicit
// param and never calls getAuth() itself, so no firebase/auth mock is needed here at all.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore, seedVouch } from './helpers/testFirestore';

const { walletMocks, vouchMocks } = vi.hoisted(() => ({
  walletMocks: {
    requireUserWalletAddress: vi.fn(),
  },
  vouchMocks: {
    giveVouch: vi.fn(),
    retractVouch: vi.fn(),
  },
}));

vi.mock('@/features/BlockchainWallet/services/walletService', () => ({
  WalletService: walletMocks,
}));

vi.mock('@/features/CredibilityUser/services/blockchainVouchService', () => ({
  blockchainVouchService: vouchMocks,
}));

import {
  createVouch,
  retractVouch,
  getVouch,
  getVouchesGiven,
  getVouchesReceived,
  getActiveVouchesGiven,
  getActiveVouchesReceived,
  getVouchId,
} from '@/features/CredibilityUser/services/vouchService';

const VOUCHER = 'vouch-service-voucher';
const VOUCHEE = 'vouch-service-vouchee';
const OTHER_VOUCHEE = 'vouch-service-other-vouchee';

const db = connectTestFirestore('belrose-orchestration-vouch-service');

describe('vouchService (orchestration)', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    vouchMocks.giveVouch.mockResolvedValue({ txHash: '0xvouch', blockNumber: 40 });
    vouchMocks.retractVouch.mockResolvedValue({ txHash: '0xretract', blockNumber: 41 });
    walletMocks.requireUserWalletAddress.mockResolvedValue('0xWallet');
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('createVouch', () => {
    it('creates pending then confirms Active on blockchain success, with a "vouched" event', async () => {
      const id = await createVouch(VOUCHER, VOUCHEE);
      expect(id).toBe(getVouchId(VOUCHER, VOUCHEE));

      const snap = await getDoc(doc(db, 'vouches', id));
      expect(snap.data()).toMatchObject({ chainStatus: 'Active', voucherId: VOUCHER, voucheeId: VOUCHEE });
      expect(snap.data()?.onChainHistory).toHaveLength(1);
      expect(snap.data()?.onChainHistory[0]).toMatchObject({
        action: 'vouched',
        blockchainRef: { txHash: '0xvouch', blockNumber: 40 },
      });
    });

    it('blocks a duplicate only when the existing vouch is Active', async () => {
      await seedVouch(db, VOUCHER, VOUCHEE, { chainStatus: 'Active' });
      await expect(createVouch(VOUCHER, VOUCHEE)).rejects.toThrow(
        'You are already vouching for this user.'
      );
    });

    it.each(['Pending', 'Failed', 'Retracted'] as const)(
      'allows retry/re-vouch when the existing vouch is %s',
      async chainStatus => {
        await seedVouch(db, VOUCHER, VOUCHEE, { chainStatus });
        await expect(createVouch(VOUCHER, VOUCHEE)).resolves.toBeTruthy();
      }
    );

    it('re-vouching after a retraction appends a "re-vouched" event, not "vouched"', async () => {
      await seedVouch(db, VOUCHER, VOUCHEE, { chainStatus: 'Retracted', onChainHistory: [] });
      await createVouch(VOUCHER, VOUCHEE);

      const snap = await getDoc(doc(db, 'vouches', getVouchId(VOUCHER, VOUCHEE)));
      expect(snap.data()?.chainStatus).toBe('Active');
      expect(snap.data()?.onChainHistory).toHaveLength(1);
      expect(snap.data()?.onChainHistory[0]).toMatchObject({ action: 're-vouched' });
    });

    it('throws before any write when the caller has no linked wallet', async () => {
      walletMocks.requireUserWalletAddress.mockRejectedValue(
        new Error('You must have a linked wallet to perform blockchain actions')
      );
      await expect(createVouch(VOUCHER, VOUCHEE)).rejects.toThrow('linked wallet');
      const snap = await getDoc(doc(db, 'vouches', getVouchId(VOUCHER, VOUCHEE)));
      expect(snap.exists()).toBe(false);
    });

    it('lets the Firestore vouch stand even when the blockchain call fails', async () => {
      vouchMocks.giveVouch.mockRejectedValue(new Error('transaction reverted'));

      await expect(createVouch(VOUCHER, VOUCHEE)).resolves.toBeTruthy();

      const snap = await getDoc(doc(db, 'vouches', getVouchId(VOUCHER, VOUCHEE)));
      expect(snap.data()?.chainStatus).toBe('Failed');
      expect(snap.data()?.onChainHistory).toEqual([]);

      const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
      expect(syncDocs.docs[0]!.data()).toMatchObject({
        status: 'failed',
        action: 'giveVouch',
        error: 'transaction reverted',
      });
    });

    // firestore.rules independently rejects this too (see test/rules/vouches.test.ts) — this
    // client-side check just gives a clear message instead of a generic permission-denied error,
    // and fails before any write is even attempted.
    it('blocks a self-vouch with a clear message, before any write', async () => {
      await expect(createVouch(VOUCHER, VOUCHER)).rejects.toThrow('You cannot vouch for yourself.');
      const snap = await getDoc(doc(db, 'vouches', getVouchId(VOUCHER, VOUCHER)));
      expect(snap.exists()).toBe(false);
    });
  });

  describe('retractVouch', () => {
    beforeEach(async () => {
      await createVouch(VOUCHER, VOUCHEE);
    });

    it('retracts and confirms on blockchain success', async () => {
      await retractVouch(VOUCHER, VOUCHEE);
      const snap = await getDoc(doc(db, 'vouches', getVouchId(VOUCHER, VOUCHEE)));
      expect(snap.data()).toMatchObject({ chainStatus: 'Retracted' });
      expect(snap.data()?.onChainHistory).toHaveLength(2);
      expect(snap.data()?.onChainHistory[1]).toMatchObject({ action: 'retracted' });
    });

    it('throws for a nonexistent vouch', async () => {
      await expect(retractVouch(VOUCHER, OTHER_VOUCHEE)).rejects.toThrow('Vouch not found.');
    });

    it.each(['Pending', 'Failed', 'Retracted'] as const)(
      'throws "No active vouch to retract" when chainStatus is %s',
      async chainStatus => {
        await seedVouch(db, VOUCHER, OTHER_VOUCHEE, { chainStatus });
        await expect(retractVouch(VOUCHER, OTHER_VOUCHEE)).rejects.toThrow('No active vouch to retract.');
      }
    );

    it('throws for a non-owner caller', async () => {
      await seedVouch(db, OTHER_VOUCHEE, VOUCHEE, { chainStatus: 'Active', voucherId: VOUCHER });
      // voucherId field mismatches the id-embedded voucher — same defensive-check pattern as
      // verificationService/disputeService's non-owner tests.
      await expect(retractVouch(OTHER_VOUCHEE, VOUCHEE)).rejects.toThrow(
        'You can only retract your own vouches.'
      );
    });

    it('lets the Firestore retraction stand even when the blockchain call fails', async () => {
      vouchMocks.retractVouch.mockRejectedValue(new Error('reverted'));
      await expect(retractVouch(VOUCHER, VOUCHEE)).resolves.toBeUndefined();
      const snap = await getDoc(doc(db, 'vouches', getVouchId(VOUCHER, VOUCHEE)));
      expect(snap.data()?.chainStatus).toBe('Failed');
    });
  });

  describe('read functions', () => {
    beforeEach(async () => {
      await createVouch(VOUCHER, VOUCHEE);
      await seedVouch(db, VOUCHER, OTHER_VOUCHEE, { chainStatus: 'Pending' });
    });

    it('getVouch returns the doc, or null when absent', async () => {
      expect((await getVouch(VOUCHER, VOUCHEE))?.chainStatus).toBe('Active');
      expect(await getVouch(VOUCHER, 'nobody')).toBeNull();
    });

    it('getVouchesGiven returns every status; getActiveVouchesGiven filters to Active only', async () => {
      expect(await getVouchesGiven(VOUCHER)).toHaveLength(2);
      expect(await getActiveVouchesGiven(VOUCHER)).toHaveLength(1);
    });

    it('getVouchesReceived returns every status; getActiveVouchesReceived filters to Active only', async () => {
      expect(await getVouchesReceived(VOUCHEE)).toHaveLength(1);
      expect(await getActiveVouchesReceived(VOUCHEE)).toHaveLength(1);
      expect(await getActiveVouchesReceived(OTHER_VOUCHEE)).toHaveLength(0);
    });
  });
});
