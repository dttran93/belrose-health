// test/orchestration/guestClaimFirestoreEffects.test.ts
//
// Layer 3 (orchestration) — calls the REAL GuestClaimService.claimAccount against the real
// Firestore emulator, validating that its Firestore writes (Step 1a wrappedKeys rewrap flags,
// Step 2 user profile, Step 2b recordRequests targetUserId backfill) actually land and that the
// downstream reads that depend on them reflect the new shape. Previously this file hand-retyped
// a local mirror of just those steps' batch shape — now it exercises the real function directly,
// so any future drift between the service and this test's expectations shows up as a real
// failure instead of silently diverging.
//
// Firestore is real (emulator), including BlockchainSyncQueueService's own writes (it's not
// mocked — Step 3's startAttempt/recordSuccess/recordFailure land in the real
// blockchainSyncQueue collection here too). Everything Step 3/4/8 touches on the actual chain/CF
// side (wallet registration, the guestPasswordUpdate Cloud Function, sign-in, profile update) is
// mocked, the same way guestClaimService.test.ts mocks it — this file's job is the Firestore
// writes specifically, not re-proving those other steps' own unit coverage.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { deleteApp, getApps } from 'firebase/app';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { connectTestFirestore, clearTestFirestore, seedGuestUser } from './helpers/testFirestore';

const {
  getGuestFileKeysMock,
  registerWalletOnChainMock,
  signInWithCustomTokenMock,
  updateProfileMock,
  httpsCallableMock,
  guestPasswordUpdateMock,
} = vi.hoisted(() => ({
  getGuestFileKeysMock: vi.fn((): Map<string, unknown> | null => null),
  registerWalletOnChainMock: vi.fn(async () => ({
    masterKeyHex: 'hex',
    walletAddress: '0xabc',
    smartAccountAddress: '0xdef',
    blockchainRef: {
      txHash: '0xregister',
      chainId: 84532,
      blockNumber: 42,
      contractAddress: '0xMemberRoleManager',
    },
  })),
  signInWithCustomTokenMock: vi.fn(async () => undefined),
  updateProfileMock: vi.fn(async () => undefined),
  httpsCallableMock: vi.fn(),
  guestPasswordUpdateMock: vi.fn(async () => ({ data: { customToken: 'custom-token' } })),
}));

const mockCurrentUser = { getIdToken: vi.fn(async () => 'id-token') };

// firebase/auth is mocked (Step 4/8 don't need a real Auth emulator for this file's purpose);
// firebase/firestore/firebase/app stay entirely real — connectTestFirestore below still governs
// which project GuestClaimService's own getFirestore() calls resolve to.
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: mockCurrentUser })),
  signInWithCustomToken: signInWithCustomTokenMock,
  updateProfile: updateProfileMock,
}));

vi.mock('@/features/Encryption/services/encryptionKeyManager', () => ({
  EncryptionKeyManager: {
    getGuestFileKeys: getGuestFileKeysMock,
    getGuestRsaPrivateKey: () => null,
    getSessionKey: async () => null,
    setSessionKey: vi.fn(),
    setGuestFileKeys: vi.fn(),
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

vi.mock('@/features/Encryption/services/encryptionService', () => ({
  EncryptionService: {
    decryptKeyWithMasterKey: vi.fn(async () => new ArrayBuffer(8)),
    importKey: vi.fn(async () => ({ fake: 'imported-key' })),
    encryptKeyWithMasterKey: vi.fn(async () => new ArrayBuffer(8)),
  },
}));

vi.mock('@/features/Auth/services/accountEncryptionService', () => ({
  AccountEncryptionService: { registerWalletOnChain: registerWalletOnChainMock },
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: httpsCallableMock,
}));

import { GuestClaimService, GuestClaimParams } from '@/features/GuestAccess/services/guestClaimService';

const db = connectTestFirestore('belrose-orchestration-guest-claim');

const GUEST = 'guest-1';

function claimParams(overrides: Partial<GuestClaimParams> = {}): GuestClaimParams {
  return {
    guestUid: GUEST,
    guestEmail: `${GUEST}@example.com`,
    firstName: 'Jane',
    lastName: 'Smith',
    password: 'password123',
    guestContext: 'record_request' as const,
    cryptoData: {
      masterKey: { fake: 'master-key' } as any,
      encryptedMasterKey: 'enc-master-key',
      masterKeyIV: 'master-key-iv',
      masterKeySalt: 'master-key-salt',
      recoveryKey: 'word1 word2 ... word24',
      recoveryKeyHash: 'recovery-key-hash',
      publicKey: 'new-public-key',
      encryptedPrivateKey: 'enc-private-key',
      encryptedPrivateKeyIV: 'private-key-iv',
    },
    refreshUser: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(async () => {
  await clearTestFirestore();
  vi.clearAllMocks();
  getGuestFileKeysMock.mockReturnValue(null);
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
  httpsCallableMock.mockReturnValue(guestPasswordUpdateMock);
  guestPasswordUpdateMock.mockResolvedValue({ data: { customToken: 'custom-token' } });
});

afterAll(() => {
  getApps().forEach(app => deleteApp(app));
});

describe('guest claim atomic batch writes (orchestration)', () => {
  it('flips isGuest to false and writes the full encryption block on the user profile', async () => {
    await seedGuestUser(db, GUEST);

    await GuestClaimService.claimAccount(claimParams());

    const snap = await getDoc(doc(db, 'users', GUEST));
    const data = snap.data()!;
    expect(data.isGuest).toBe(false);
    expect(data.encryption.enabled).toBe(true);
    expect(data.encryption.publicKey).toBe('new-public-key');
    // Real service also writes these — the old hand-duplicated mirror omitted them.
    expect(data.displayNameLower).toBe('jane smith');
    expect(data.identityVerified).toBe(false);
    expect(data.identityVerifiedAt).toBeNull();

    // Step 3's wallet registration is tracked via the real BlockchainSyncQueueService, not
    // mocked here — confirms the sync-queue write actually lands against real Firestore rules.
    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      contract: 'MemberRoleManager',
      action: 'registerMemberOnChainComplete',
      userId: GUEST,
      txHash: '0xregister',
      blockNumber: 42,
    });
  });

  it('rewraps wrappedKeys docs and REMOVES expiresAt entirely (not just falsy)', async () => {
    // This is Step 1a specifically (sharing-flow, map-sourced) — isCreator: false since a
    // shared-with-guest key was never "created by" the guest (contrast with Step 1c, which is
    // query-sourced by isCreator == true and covered at the unit layer instead).
    await seedGuestUser(db, GUEST);
    await setDoc(doc(db, 'wrappedKeys', `rec-1_${GUEST}`), {
      wrappedKey: 'guest-wrapped-key',
      isCreator: false,
      isGuest: true,
      expiresAt: new Date(Date.now() + 1000),
    });
    getGuestFileKeysMock.mockReturnValue(new Map([['rec-1', { fake: 'file-key' }]]));

    await GuestClaimService.claimAccount(claimParams({ guestContext: 'sharing' }));

    const snap = await getDoc(doc(db, 'wrappedKeys', `rec-1_${GUEST}`));
    const data = snap.data()!;
    expect(data.isGuest).toBe(false);
    expect(data.isCreator).toBe(false);
    expect('expiresAt' in data).toBe(false);
  });

  it('backfills targetUserId on matching pending/fulfilled recordRequests by email', async () => {
    await seedGuestUser(db, GUEST);
    await setDoc(doc(db, 'recordRequests', 'req-1'), {
      targetEmail: `${GUEST}@example.com`,
      status: 'pending',
    });
    await setDoc(doc(db, 'recordRequests', 'req-2'), {
      targetEmail: `${GUEST}@example.com`,
      status: 'fulfilled',
    });
    await setDoc(doc(db, 'recordRequests', 'req-3'), {
      targetEmail: `${GUEST}@example.com`,
      status: 'cancelled', // not in ['pending','fulfilled'] — should be left alone
    });

    await GuestClaimService.claimAccount(claimParams());

    const req1 = await getDoc(doc(db, 'recordRequests', 'req-1'));
    const req2 = await getDoc(doc(db, 'recordRequests', 'req-2'));
    const req3 = await getDoc(doc(db, 'recordRequests', 'req-3'));
    expect(req1.data()!.targetUserId).toBe(GUEST);
    expect(req2.data()!.targetUserId).toBe(GUEST);
    expect('targetUserId' in req3.data()!).toBe(false);
  });

  it('does not backfill recordRequests addressed to a different email', async () => {
    await seedGuestUser(db, GUEST);
    await setDoc(doc(db, 'recordRequests', 'req-1'), {
      targetEmail: 'someone-else@example.com',
      status: 'pending',
    });

    await GuestClaimService.claimAccount(claimParams());

    const req1 = await getDoc(doc(db, 'recordRequests', 'req-1'));
    expect('targetUserId' in req1.data()!).toBe(false);
  });
});
