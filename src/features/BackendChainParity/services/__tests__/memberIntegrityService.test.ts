// src/features/BackendChainParity/services/__tests__/memberIntegrityService.test.ts
//
// Unit tests for checkMemberIntegrity/buildChainOnlyItem — pure orchestration logic over a
// mocked MemberRoleManager contract, no emulator/chain needed (mirrors
// recordHashIntegrityService.test.ts's pattern).
//
// Note: FIRESTORE_STATUS_TO_NUMBER maps a 'Guest' key to 5, but onChainIdentityStatus.status
// (src/types/core.ts) has no 'Guest' literal at all — guests never get an on-chain status
// history entry (they're deliberately kept off-chain entirely, per that type's own comment).
// So `currentFirestoreStatus` can never actually equal 'Guest' through real typed data, and that
// map entry can't be exercised without fabricating an invalid status — not tested here as a
// reachable branch.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContract = {
  userStatus: vi.fn(),
  getWalletsForUser: vi.fn(),
};

vi.mock('../../lib/contracts', () => ({
  getMemberContract: () => mockContract,
}));

import { checkMemberIntegrity, buildChainOnlyItem } from '../memberIntegrityService';
import type { BelroseUserProfile } from '@/types/core';

function makeUser(overrides: Partial<BelroseUserProfile> = {}): BelroseUserProfile {
  return {
    uid: 'user-1',
    email: 'user1@example.com',
    displayName: 'User One',
    firstName: 'User',
    lastName: 'One',
    encryption: {} as any,
    wallet: { address: '0xWallet', origin: 'generated' } as any,
    ...overrides,
  } as BelroseUserProfile;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('checkMemberIntegrity', () => {
  it('is pending when on-chain status is NotRegistered and the user is a guest — guests stay off-chain until claim', async () => {
    mockContract.userStatus.mockResolvedValue(0n);
    mockContract.getWalletsForUser.mockResolvedValue([]);
    const user = makeUser({ isGuest: true });

    const result = await checkMemberIntegrity(user);

    expect(result.integrityStatus).toBe('pending');
    expect(result.onChainStatus).toBe(0);
  });

  it('is missing when on-chain status is NotRegistered and the user is NOT a guest', async () => {
    mockContract.userStatus.mockResolvedValue(0n);
    mockContract.getWalletsForUser.mockResolvedValue([]);
    const user = makeUser({ isGuest: false });

    const result = await checkMemberIntegrity(user);

    expect(result.integrityStatus).toBe('missing');
    expect(result.onChainStatus).toBe(0);
  });

  it('is synced when status and wallets both match on-chain', async () => {
    mockContract.userStatus.mockResolvedValue(2n); // Active
    mockContract.getWalletsForUser.mockResolvedValue(['0xwallet']);
    const user = makeUser({
      onChainIdentity: {
        userIdHash: '0xUserIdHash',
        onChainStatus: [{ status: 'Active' }] as any,
        linkedWallets: [],
      },
      wallet: { address: '0xWallet', origin: 'generated' } as any,
    });

    const result = await checkMemberIntegrity(user);

    expect(result.integrityStatus).toBe('synced');
    expect(result.statusMismatch).toBe(false);
    expect(result.walletMismatch).toBe(false);
  });

  it('is mismatch when the Firestore status does not match the expected on-chain status number', async () => {
    mockContract.userStatus.mockResolvedValue(1n); // Inactive
    mockContract.getWalletsForUser.mockResolvedValue(['0xwallet']);
    const user = makeUser({
      onChainIdentity: {
        userIdHash: '0xUserIdHash',
        onChainStatus: [{ status: 'Active' }] as any, // expects 2, chain says 1
        linkedWallets: [],
      },
      wallet: { address: '0xWallet', origin: 'generated' } as any,
    });

    const result = await checkMemberIntegrity(user);

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.statusMismatch).toBe(true);
  });

  it('is mismatch when a Firestore wallet address is not present on-chain', async () => {
    mockContract.userStatus.mockResolvedValue(2n); // Active
    mockContract.getWalletsForUser.mockResolvedValue(['0xsomeotherwallet']);
    const user = makeUser({
      onChainIdentity: {
        userIdHash: '0xUserIdHash',
        onChainStatus: [{ status: 'Active' }] as any,
        linkedWallets: [],
      },
      wallet: { address: '0xWallet', origin: 'generated' } as any,
    });

    const result = await checkMemberIntegrity(user);

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.walletMismatch).toBe(true);
    expect(result.statusMismatch).toBe(false);
  });

  it('also checks the smart account address, not just the main wallet', async () => {
    mockContract.userStatus.mockResolvedValue(2n);
    mockContract.getWalletsForUser.mockResolvedValue(['0xwallet']); // missing smart account
    const user = makeUser({
      onChainIdentity: {
        userIdHash: '0xUserIdHash',
        onChainStatus: [{ status: 'Active' }] as any,
        linkedWallets: [],
      },
      wallet: {
        address: '0xWallet',
        smartAccountAddress: '0xSmartAccount',
        origin: 'generated',
      } as any,
    });

    const result = await checkMemberIntegrity(user);

    expect(result.walletMismatch).toBe(true);
  });

  it('derives userIdHash from uid when onChainIdentity is absent', async () => {
    mockContract.userStatus.mockResolvedValue(0n);
    mockContract.getWalletsForUser.mockResolvedValue([]);
    const user = makeUser({ uid: 'user-without-identity', isGuest: false });

    await checkMemberIntegrity(user);

    expect(mockContract.userStatus).toHaveBeenCalledWith(expect.stringMatching(/^0x[0-9a-f]{64}$/));
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockContract.userStatus.mockRejectedValue(new Error('RPC blew up'));
    const user = makeUser({
      onChainIdentity: { userIdHash: '0xUserIdHash', onChainStatus: [], linkedWallets: [] },
    });

    const result = await checkMemberIntegrity(user);

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});

describe('buildChainOnlyItem', () => {
  it('builds a chain_only item from a bare userIdHash', async () => {
    mockContract.userStatus.mockResolvedValue(2n);
    mockContract.getWalletsForUser.mockResolvedValue(['0xwallet']);

    const result = await buildChainOnlyItem('0xUserIdHash');

    expect(result.integrityStatus).toBe('chain_only');
    expect(result.uid).toBe('0xUserIdHash');
    expect(result.onChainStatus).toBe(2);
    expect(result.onChainWallets).toEqual(['0xwallet']);
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockContract.userStatus.mockRejectedValue(new Error('RPC blew up'));

    const result = await buildChainOnlyItem('0xUserIdHash');

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});
