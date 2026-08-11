// test/orchestration/fulfillRequestService.test.ts
//
// Layer 3 (orchestration) — FulfillRequestService.fulfillAsGuest + registerGuestFulfillmentOnChain,
// flagged in the test strategy as the single highest-risk untested surface across
// AddRecord/ViewEditRecord/RequestRecord. Split into two separately-awaitable steps (the guest UI
// awaits the first, then fires the second without awaiting it — see LinkRequestModal):
//   - fulfillAsGuest: session-key retrieval -> Firestore read -> key unwrap -> key rewrap -> one
//     atomic Firestore batch (wrappedKey + role array + permissionHistory event + request status).
//   - registerGuestFulfillmentOnChain: a best-effort Cloud Function on-chain write, tracked via
//     BlockchainSyncQueueService — called separately, after fulfillAsGuest has already resolved.
//
// Real Firestore emulator + REAL EncryptionService/EncryptionKeyManager/SharingKeyManagementService
// (this is the crypto that actually re-wraps the guest's file key for the requester), and REAL
// BlockchainSyncQueueService (writes to the emulator, asserted on directly — matches
// grantAdmin.test.ts's convention). Only firebase/auth and firebase/functions (the real Cloud
// Function boundary) are mocked. getUserProfile is NOT mocked — it's a plain Firestore read with
// no external calls, so it runs for real against seeded data.

import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';
import { arrayBufferToBase64 } from '../../src/utils/dataFormattingUtils';

const { mockCurrentUser, httpsCallableMock } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null },
  httpsCallableMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: () => httpsCallableMock,
}));

import { FulfillRequestService } from '../../src/features/RequestRecord/services/fulfillRequestService';
import { clearUserCache } from '../../src/features/Users/services/userProfileService';
import { EncryptionService } from '../../src/features/Encryption/services/encryptionService';
import { EncryptionKeyManager } from '../../src/features/Encryption/services/encryptionKeyManager';
import { SharingKeyManagementService } from '../../src/features/Sharing/services/sharingKeyManagementService';
import type { RecordRequest } from '@belrose/shared';

const GUEST_UID = 'guest-1';
const REQUESTER_UID = 'requester-1';
const RECORD_ID = 'record-1';
const INVITE_CODE = 'invite-1';

const db = connectTestFirestore('belrose-orchestration-fulfill-request');

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

function installFakeSessionStorage() {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal('sessionStorage', fakeStorage);
}

function makeRequest(overrides: Partial<RecordRequest> = {}): RecordRequest {
  return { inviteCode: INVITE_CODE, requesterId: REQUESTER_UID, ...overrides } as RecordRequest;
}

/** Seeds the guest's own wrappedKey for the record, AES-wrapped with their throwaway session key. */
async function seedGuestWrappedKey(fileKey: CryptoKey, throwawayKey: CryptoKey) {
  const wrapped = await EncryptionService.encryptKeyWithMasterKey(fileKey, throwawayKey);
  await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${GUEST_UID}`), {
    recordId: RECORD_ID,
    userId: GUEST_UID,
    wrappedKey: arrayBufferToBase64(wrapped),
  });
}

async function seedRequesterProfile() {
  const { publicKey, privateKey } = await SharingKeyManagementService.generateUserKeyPair();
  await setDoc(doc(db, 'users', REQUESTER_UID), {
    encryption: { publicKey },
    wallet: { address: '0xRequesterWallet' },
  });
  return { publicKey, privateKey };
}

async function seedRecordAndRequest() {
  await setDoc(doc(db, 'records', RECORD_ID), { administrators: [GUEST_UID] });
  await setDoc(doc(db, 'recordRequests', INVITE_CODE), { status: 'pending', fulfilledRecordIds: [] });
}

beforeEach(async () => {
  await clearTestFirestore();
  installFakeSessionStorage();
  EncryptionKeyManager.clearSession();
  httpsCallableMock.mockReset();
  setCaller(null);
  // getUserProfile (real, unmocked) keeps a module-level in-memory cache keyed by uid — without
  // clearing it, one test's seeded (or missing) profile for REQUESTER_UID leaks into the next.
  clearUserCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  getApps().forEach(app => deleteApp(app));
});

describe('FulfillRequestService.fulfillAsGuest — guard clauses', () => {
  it('throws when there is no authenticated guest', async () => {
    await expect(FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID)).rejects.toThrow(
      'Not authenticated'
    );
  });

  it('throws when there is no throwaway encryption session', async () => {
    setCaller(GUEST_UID);
    await expect(FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID)).rejects.toThrow(
      'Encryption session expired. Please reload the page and try again.'
    );
  });

  it('throws when the guest has no wrappedKey for this record', async () => {
    setCaller(GUEST_UID);
    EncryptionKeyManager.setSessionKey(await EncryptionKeyManager.generateMasterKey());

    await expect(FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID)).rejects.toThrow(
      'Record key not found.'
    );
  });

  it('throws when the requester has no encryption public key set up', async () => {
    setCaller(GUEST_UID);
    const throwawayKey = await EncryptionKeyManager.generateMasterKey();
    EncryptionKeyManager.setSessionKey(throwawayKey);
    await seedGuestWrappedKey(await EncryptionService.generateFileKey(), throwawayKey);
    await setDoc(doc(db, 'users', REQUESTER_UID), {}); // no encryption field at all

    await expect(FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID)).rejects.toThrow(
      'Requester does not have encryption keys set up'
    );
  });
});

describe('FulfillRequestService.registerGuestFulfillmentOnChain — guard clauses', () => {
  it('throws when there is no authenticated guest', async () => {
    await expect(
      FulfillRequestService.registerGuestFulfillmentOnChain(makeRequest(), RECORD_ID, 'irrelevant-doc-id')
    ).rejects.toThrow('Not authenticated');
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });
});

describe('FulfillRequestService.fulfillAsGuest — happy path', () => {
  it('rewraps the file key for the requester and completes fulfillment, without touching the chain', async () => {
    setCaller(GUEST_UID);
    const throwawayKey = await EncryptionKeyManager.generateMasterKey();
    EncryptionKeyManager.setSessionKey(throwawayKey);
    const fileKey = await EncryptionService.generateFileKey();
    await seedGuestWrappedKey(fileKey, throwawayKey);
    const { privateKey: requesterPrivateKey } = await seedRequesterProfile();
    await seedRecordAndRequest();

    const historyDocId = await FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID);
    expect(typeof historyDocId).toBe('string');

    expect(httpsCallableMock).not.toHaveBeenCalled();

    // The requester's new wrappedKey must actually unwrap to the SAME file key the guest had.
    const requesterWrappedKeySnap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${REQUESTER_UID}`));
    expect(requesterWrappedKeySnap.exists()).toBe(true);
    const requesterWrappedKeyData = requesterWrappedKeySnap.data()!;
    expect(requesterWrappedKeyData.isCreator).toBe(false);
    expect(requesterWrappedKeyData.isActive).toBe(true);

    const rsaPrivateKey = await SharingKeyManagementService.importPrivateKey(requesterPrivateKey);
    const recoveredFileKey = await SharingKeyManagementService.unwrapKey(
      requesterWrappedKeyData.wrappedKey,
      rsaPrivateKey
    );
    const recoveredRaw = await crypto.subtle.exportKey('raw', recoveredFileKey);
    const originalRaw = await crypto.subtle.exportKey('raw', fileKey);
    expect(Buffer.from(recoveredRaw).toString('base64')).toBe(
      Buffer.from(originalRaw).toString('base64')
    );

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()!.administrators).toEqual(
      expect.arrayContaining([GUEST_UID, REQUESTER_UID])
    );

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.status).toBe('fulfilled');
    expect(requestSnap.data()!.fulfilledRecordIds).toEqual([RECORD_ID]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs).toHaveLength(1);
    // The id fulfillAsGuest returned must be the doc it actually created — that's what callers
    // thread into registerGuestFulfillmentOnChain.
    expect(events.docs[0]!.id).toBe(historyDocId);
    expect(events.docs[0]!.data().changes).toEqual([
      { userId: REQUESTER_UID, action: 'granted', previousRole: null, newRole: 'administrator' },
    ]);
    // blockchainRef starts null — only registerGuestFulfillmentOnChain fills it in.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    // Nothing queued yet either — that's registerGuestFulfillmentOnChain's job.
    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(0);
  });
});

describe('FulfillRequestService.registerGuestFulfillmentOnChain — happy path', () => {
  it('fills in blockchainRef and records a confirmed sync-queue entry once fulfillAsGuest has already landed', async () => {
    setCaller(GUEST_UID);
    const throwawayKey = await EncryptionKeyManager.generateMasterKey();
    EncryptionKeyManager.setSessionKey(throwawayKey);
    await seedGuestWrappedKey(await EncryptionService.generateFileKey(), throwawayKey);
    await seedRequesterProfile();
    await seedRecordAndRequest();
    httpsCallableMock.mockResolvedValue({
      data: {
        success: true,
        blockchainRef: {
          txHash: '0xguestfulfill',
          blockNumber: 55,
          chainId: 84532,
          contractAddress: '0xMemberRoleManager',
        },
      },
    });

    const historyDocId = await FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID);
    await FulfillRequestService.registerGuestFulfillmentOnChain(makeRequest(), RECORD_ID, historyDocId);

    expect(httpsCallableMock).toHaveBeenCalledWith({
      recordId: RECORD_ID,
      requesterUserId: REQUESTER_UID,
      role: 'administrator',
    });

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs).toHaveLength(1);
    // blockchainRef starts null in the atomic Firestore write and is filled in once the
    // (mocked, successful) Cloud Function call resolves.
    expect(events.docs[0]!.data().blockchainRef).toMatchObject({
      txHash: '0xguestfulfill',
      blockNumber: 55,
    });

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'confirmed',
      contract: 'MemberRoleManager',
      action: 'initializeRoleOnChainForRequester',
      userId: GUEST_UID,
      txHash: '0xguestfulfill',
      blockNumber: 55,
      permissionHistoryPath: `records/${RECORD_ID}/permissionHistory/${events.docs[0]!.id}`,
    });
    expect(syncDocs.docs[0]!.data().userWalletAddress).toBeUndefined();
  });
});

describe('FulfillRequestService.registerGuestFulfillmentOnChain — on-chain failure', () => {
  it('keeps the Firestore fulfillment when the blockchain call rejects, and logs it for reconciliation', async () => {
    setCaller(GUEST_UID);
    const throwawayKey = await EncryptionKeyManager.generateMasterKey();
    EncryptionKeyManager.setSessionKey(throwawayKey);
    await seedGuestWrappedKey(await EncryptionService.generateFileKey(), throwawayKey);
    await seedRequesterProfile();
    await seedRecordAndRequest();
    httpsCallableMock.mockRejectedValue(new Error('Pimlico bundler timeout'));

    const historyDocId = await FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID);

    // Firestore-first: the chain call is best-effort and does not revert the fulfillment that
    // already succeeded, so this resolves rather than throwing.
    await expect(
      FulfillRequestService.registerGuestFulfillmentOnChain(makeRequest(), RECORD_ID, historyDocId)
    ).resolves.toBeUndefined();

    const requesterWrappedKeySnap = await getDoc(
      doc(db, 'wrappedKeys', `${RECORD_ID}_${REQUESTER_UID}`)
    );
    expect(requesterWrappedKeySnap.exists()).toBe(true);

    const recordSnap = await getDoc(doc(db, 'records', RECORD_ID));
    expect(recordSnap.data()!.administrators).toEqual(
      expect.arrayContaining([GUEST_UID, REQUESTER_UID])
    );

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.status).toBe('fulfilled');
    expect(requestSnap.data()!.fulfilledRecordIds).toEqual([RECORD_ID]);

    const events = await getDocs(collection(db, 'records', RECORD_ID, 'permissionHistory'));
    expect(events.docs).toHaveLength(1);
    // No confirmed tx to cite — the audit event still exists, just without a chain reference yet.
    expect(events.docs[0]!.data().blockchainRef).toBeNull();

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      contract: 'MemberRoleManager',
      action: 'initializeRoleOnChainForRequester',
      userId: GUEST_UID,
      error: 'Pimlico bundler timeout',
      context: expect.objectContaining({
        targetUserId: REQUESTER_UID,
        targetWalletAddress: '0xRequesterWallet',
        role: 'administrator',
        recordId: RECORD_ID,
      }),
    });
  });

  it('resolves and leaves a failed sync-queue entry when the Cloud Function reports already-exists (self-healed)', async () => {
    setCaller(GUEST_UID);
    const throwawayKey = await EncryptionKeyManager.generateMasterKey();
    EncryptionKeyManager.setSessionKey(throwawayKey);
    await seedGuestWrappedKey(await EncryptionService.generateFileKey(), throwawayKey);
    await seedRequesterProfile();
    await seedRecordAndRequest();
    httpsCallableMock.mockRejectedValue(
      Object.assign(new Error('Record already initialized on chain'), { code: 'already-exists' })
    );

    const historyDocId = await FulfillRequestService.fulfillAsGuest(makeRequest(), RECORD_ID);

    // Not special-cased client-side — falls through the same best-effort catch as any other
    // chain error, so the Firestore fulfillment still stands.
    await expect(
      FulfillRequestService.registerGuestFulfillmentOnChain(makeRequest(), RECORD_ID, historyDocId)
    ).resolves.toBeUndefined();

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.status).toBe('fulfilled');

    const syncDocs = await getDocs(collection(db, 'blockchainSyncQueue'));
    expect(syncDocs.size).toBe(1);
    expect(syncDocs.docs[0]!.data()).toMatchObject({
      status: 'failed',
      error: 'Record already initialized on chain',
    });
  });
});
