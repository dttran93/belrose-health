// src/features/GuestAccess/services/__tests__/guestClaimService.test.ts
//
// Covers, per GuestClaimService's own documented write strategy:
//   (a) the atomic batch (profile update + backfill) succeeds/fails as a unit — a batch.commit()
//       failure must stop the flow before wallet registration ever runs.
//   (b) Step 1c degrades gracefully with skippedRecordCount returned rather than thrown, when
//       the throwaway session key is gone.
//   (c) the stale-session-keys guard fires (the real "tab was refreshed between submitting
//       credentials and clicking Complete Registration" case, since guest file keys live only
//       in memory).
//   (d) call-order: guestPasswordUpdate resolves -> signInWithCustomToken -> refreshUser,
//       asserted via invocationCallOrder, not just "was called".
//
// Migrated from GuestClaimAccountModal.test.tsx's former orchestration-behavior tests — calls
// GuestClaimService.claimAccount directly instead of rendering + clicking through RTL. No
// AuthContext mock needed (refreshUser is a plain param now) and no sonner mock needed (the
// service never toasts — that's the component's job, covered in GuestClaimAccountModal.test.tsx).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const FAKE_MASTER_KEY = { fake: 'master-key' } as any;

const {
  getGuestFileKeysMock,
  getGuestRsaPrivateKeyMock,
  getSessionKeyMock,
  setSessionKeyMock,
  setGuestFileKeysMock,
  registerWalletOnChainMock,
  startAttemptMock,
  recordSuccessMock,
  recordFailureMock,
  signInWithCustomTokenMock,
  updateProfileMock,
  updateDocMock,
  getDocsMock,
  batchUpdateMock,
  batchCommitMock,
  httpsCallableMock,
  guestPasswordUpdateMock,
} = vi.hoisted(() => ({
  getGuestFileKeysMock: vi.fn(
    (): Map<string, { fake: string }> | null => new Map([['rec-1', { fake: 'file-key' }]])
  ),
  getGuestRsaPrivateKeyMock: vi.fn(() => null),
  getSessionKeyMock: vi.fn(async () => null),
  setSessionKeyMock: vi.fn(),
  setGuestFileKeysMock: vi.fn(),
  registerWalletOnChainMock: vi.fn(),
  startAttemptMock: vi.fn(async () => ({ id: 'sync-ref' }) as any),
  recordSuccessMock: vi.fn(async () => undefined),
  recordFailureMock: vi.fn(async () => undefined),
  signInWithCustomTokenMock: vi.fn(async () => undefined),
  updateProfileMock: vi.fn(async () => undefined),
  updateDocMock: vi.fn(async () => undefined),
  getDocsMock: vi.fn(async (_q?: unknown) => ({ docs: [] as any[] })),
  batchUpdateMock: vi.fn(),
  batchCommitMock: vi.fn(async () => undefined),
  httpsCallableMock: vi.fn(),
  guestPasswordUpdateMock: vi.fn(async () => ({ data: { customToken: 'custom-token' } })),
}));

const mockCurrentUser = { getIdToken: vi.fn(async () => 'id-token') };

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: mockCurrentUser })),
  signInWithCustomToken: signInWithCustomTokenMock,
  updateProfile: updateProfileMock,
}));

vi.mock('@/features/Encryption/services/encryptionKeyManager', () => ({
  EncryptionKeyManager: {
    getGuestFileKeys: getGuestFileKeysMock,
    getGuestRsaPrivateKey: getGuestRsaPrivateKeyMock,
    getSessionKey: getSessionKeyMock,
    setSessionKey: setSessionKeyMock,
    setGuestFileKeys: setGuestFileKeysMock,
  },
}));

vi.mock('@/features/Encryption/services/encryptionService', () => ({
  EncryptionService: {
    decryptKeyWithMasterKey: vi.fn(async () => new ArrayBuffer(8)),
    importKey: vi.fn(async () => ({ fake: 'imported-key' })),
    encryptKeyWithMasterKey: vi.fn(async () => new ArrayBuffer(8)),
  },
}));

vi.mock('@/features/Sharing/services/sharingKeyManagementService', () => ({
  SharingKeyManagementService: {
    importPublicKey: vi.fn(async () => ({ fake: 'rsa-public' })),
    importPrivateKey: vi.fn(async () => ({ fake: 'rsa-private' })),
    wrapKey: vi.fn(async () => 'wrapped-key'),
    unwrapKey: vi.fn(async () => ({ fake: 'unwrapped-key' })),
  },
}));

vi.mock('@/features/Auth/services/accountEncryptionService', () => ({
  AccountEncryptionService: {
    registerWalletOnChain: registerWalletOnChainMock,
  },
}));

vi.mock('@/features/BlockchainWallet/services/blockchainSyncQueueService', () => ({
  BlockchainSyncQueueService: {
    startAttempt: startAttemptMock,
    recordSuccess: recordSuccessMock,
    recordFailure: recordFailureMock,
  },
  getUserFacingErrorMessage: vi.fn((err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback
  ),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(() => 'collection'),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  doc: vi.fn((...args: unknown[]) => ({ path: args.filter(a => typeof a === 'string').join('/') })),
  deleteField: vi.fn(() => 'DELETE_FIELD'),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  updateDoc: updateDocMock,
  getDocs: getDocsMock,
  writeBatch: vi.fn(() => ({ update: batchUpdateMock, commit: batchCommitMock })),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: httpsCallableMock,
}));

import { GuestClaimService, GuestClaimParams } from '../guestClaimService';

function fakeBundle() {
  return {
    masterKey: FAKE_MASTER_KEY,
    encryptedMasterKey: 'enc-master-key',
    masterKeyIV: 'master-iv',
    masterKeySalt: 'master-salt',
    recoveryKey: 'word1 word2 ... word24',
    recoveryKeyHash: 'recovery-hash',
    publicKey: 'public-key',
    encryptedPrivateKey: 'enc-private-key',
    encryptedPrivateKeyIV: 'private-iv',
  };
}

let refreshUserMock: ReturnType<typeof vi.fn<() => Promise<void>>>;

function baseParams(overrides: Partial<GuestClaimParams> = {}): GuestClaimParams {
  return {
    guestUid: 'guest-1',
    guestEmail: 'guest@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    password: 'password123',
    guestContext: 'sharing',
    cryptoData: fakeBundle(),
    refreshUser: refreshUserMock,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshUserMock = vi.fn(async () => undefined);
  getGuestFileKeysMock.mockReturnValue(new Map([['rec-1', { fake: 'file-key' }]]));
  getGuestRsaPrivateKeyMock.mockReturnValue(null);
  getSessionKeyMock.mockResolvedValue(null);
  registerWalletOnChainMock.mockResolvedValue({
    masterKeyHex: 'hex',
    walletAddress: '0xabc',
    smartAccountAddress: '0xdef',
    blockchainRef: {
      txHash: '0xregister',
      chainId: 84532,
      blockNumber: 42,
      contractAddress: '0xMemberRoleManager',
    },
  });
  startAttemptMock.mockResolvedValue({ id: 'sync-ref' } as any);
  batchCommitMock.mockResolvedValue(undefined);
  getDocsMock.mockResolvedValue({ docs: [] });
  httpsCallableMock.mockReturnValue(guestPasswordUpdateMock);
  guestPasswordUpdateMock.mockResolvedValue({ data: { customToken: 'custom-token' } });
});

describe('GuestClaimService.claimAccount — stale session keys (bug scenario)', () => {
  it('throws when guest file keys vanish before claimAccount runs (tab-refresh scenario)', async () => {
    // Simulates: credentials-submit succeeded (keys present then), but by the time claim runs
    // the in-memory keys are gone (a tab refresh wiping session state mid-flow).
    getGuestFileKeysMock.mockReturnValue(null);

    await expect(GuestClaimService.claimAccount(baseParams({ guestContext: 'sharing' }))).rejects.toThrow(
      /session has expired/
    );
    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});

describe('GuestClaimService.claimAccount — atomic batch (profile update)', () => {
  it('commits the profile-update batch and proceeds to wallet registration on success', async () => {
    await GuestClaimService.claimAccount(baseParams());

    expect(batchCommitMock).toHaveBeenCalled();
    expect(batchUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        isGuest: false,
        encryption: expect.objectContaining({ enabled: true, encryptedMasterKey: 'enc-master-key' }),
      })
    );
    expect(registerWalletOnChainMock).toHaveBeenCalledWith(FAKE_MASTER_KEY);
  });

  it('ATOMICITY: a batch.commit() failure stops the flow before wallet registration ever runs', async () => {
    batchCommitMock.mockRejectedValue(new Error('commit failed'));

    await expect(GuestClaimService.claimAccount(baseParams())).rejects.toThrow('commit failed');
    expect(registerWalletOnChainMock).not.toHaveBeenCalled();
  });
});

describe('GuestClaimService.claimAccount — Step 3 wallet registration is tracked and best-effort', () => {
  it('tracks the registration attempt via BlockchainSyncQueueService and records success', async () => {
    await GuestClaimService.claimAccount(baseParams());

    expect(startAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: 'MemberRoleManager',
        action: 'registerMemberOnChainComplete',
        userId: 'guest-1',
      })
    );
    expect(recordSuccessMock).toHaveBeenCalledWith(
      { id: 'sync-ref' },
      { txHash: '0xregister', blockNumber: 42 }
    );
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('does not throw when wallet registration fails — records the failure and the claim still completes', async () => {
    registerWalletOnChainMock.mockRejectedValue(new Error('bundler timeout'));

    const result = await GuestClaimService.claimAccount(baseParams());

    expect(result).toEqual({ skippedRecordCount: 0 });
    expect(recordFailureMock).toHaveBeenCalledWith({ id: 'sync-ref' }, 'bundler timeout');
    expect(recordSuccessMock).not.toHaveBeenCalled();
    // The rest of the claim still ran despite the chain failure.
    expect(guestPasswordUpdateMock).toHaveBeenCalled();
  });
});

describe('GuestClaimService.claimAccount — Step 1c degrades gracefully', () => {
  it('surfaces a skipped-record count instead of throwing when the throwaway key is gone', async () => {
    getSessionKeyMock.mockResolvedValue(null); // throwaway key already GC'd from memory
    getDocsMock.mockImplementation(async (q: any) => {
      const isUploadedKeysQuery = Array.isArray(q) && q.some((arg: any) => arg?.field === 'isCreator');
      if (isUploadedKeysQuery) {
        return { docs: [{ id: 'rec-uploaded-1_guest-1', ref: {}, data: () => ({ wrappedKey: 'x' }) }] };
      }
      return { docs: [] };
    });

    const result = await GuestClaimService.claimAccount(baseParams({ guestContext: 'record_request' }));

    expect(batchCommitMock).toHaveBeenCalled();
    expect(result.skippedRecordCount).toBe(1);
  });
});

describe('GuestClaimService.claimAccount — call order: password update -> sign in -> refresh', () => {
  it('signs in with the custom token before refreshing the user, in that order', async () => {
    await GuestClaimService.claimAccount(baseParams());

    expect(refreshUserMock).toHaveBeenCalled();

    const passwordUpdateOrder = guestPasswordUpdateMock.mock.invocationCallOrder[0]!;
    const signInOrder = signInWithCustomTokenMock.mock.invocationCallOrder[0]!;
    const refreshOrder = refreshUserMock.mock.invocationCallOrder[0]!;

    expect(passwordUpdateOrder).toBeLessThan(signInOrder);
    expect(signInOrder).toBeLessThan(refreshOrder);
  });

  it('clears in-memory guest keys and resolves on full success', async () => {
    await GuestClaimService.claimAccount(baseParams());

    expect(setGuestFileKeysMock).toHaveBeenCalledWith(new Map());
  });
});
