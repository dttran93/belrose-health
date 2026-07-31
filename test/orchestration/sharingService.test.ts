// test/orchestration/sharingService.test.ts
//
// Layer 3 (orchestration) — SharingService.
// Real Firestore (emulator, permissive rules) and the REAL SharingKeyManagementService (actual
// WebCrypto RSA-OAEP) run for every test here — only EncryptionKeyManager.getSessionKey and
// RecordDecryptionService.getRecordKey are mocked, since those are session-state concerns owned
// elsewhere. RecordDecryptionService.getRecordKey is stubbed to return a REAL generated AES-GCM
// key (not a fake object) so the real wrapKey call downstream has something genuine to wrap —
// that's what makes the "receiver can actually unwrap it" test below possible.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';
import { arrayBufferToBase64 } from '../../src/utils/dataFormattingUtils';

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: {
    uid: null as string | null,
    displayName: null as string | null,
    email: null as string | null,
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    currentUser: mockCurrentUser.uid
      ? {
          uid: mockCurrentUser.uid,
          displayName: mockCurrentUser.displayName,
          email: mockCurrentUser.email,
        }
      : null,
  }),
}));

vi.mock('@/features/Encryption/services/encryptionKeyManager', () => ({
  EncryptionKeyManager: {
    getSessionKey: vi.fn(),
  },
}));

vi.mock('@/features/Encryption/services/recordDecryptionService', () => ({
  RecordDecryptionService: {
    getRecordKey: vi.fn(),
  },
}));

import { SharingService } from '../../src/features/Sharing/services/sharingService';
import { SharingKeyManagementService } from '../../src/features/Sharing/services/sharingKeyManagementService';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';

const GRANTOR = 'sharing-grantor';
const TARGET = 'sharing-target';
const RECORD_ID = 'sharing-record';

function setCaller(uid: string | null, extra: { displayName?: string; email?: string } = {}) {
  mockCurrentUser.uid = uid;
  mockCurrentUser.displayName = extra.displayName ?? null;
  mockCurrentUser.email = extra.email ?? null;
}

async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function exportRawBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

const db = connectTestFirestore('belrose-orchestration-sharing');

describe('SharingService (orchestration)', () => {
  let defaultRecordKey: CryptoKey;

  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();

    defaultRecordKey = await generateAesKey();
    vi.mocked(EncryptionKeyManager.getSessionKey).mockResolvedValue({} as CryptoKey);
    vi.mocked(RecordDecryptionService.getRecordKey).mockResolvedValue(defaultRecordKey);

    setCaller(GRANTOR);
  });

  afterAll(() => {
    getApps().forEach(app => deleteApp(app));
  });

  describe('grantEncryptionAccess', () => {
    it('throws when the caller is not authenticated', async () => {
      setCaller(null);
      await expect(SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('throws when the encryption session is not unlocked', async () => {
      vi.mocked(EncryptionKeyManager.getSessionKey).mockResolvedValue(null);

      await expect(SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR)).rejects.toThrow(
        'Encryption session not active. Please unlock your encryption.'
      );
    });

    it('throws "User not found" when the receiver has no profile doc', async () => {
      await expect(SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR)).rejects.toThrow(
        'User not found'
      );
    });

    it('throws when the receiver profile has no encryption public key', async () => {
      await setDoc(doc(db, 'users', TARGET), {});

      await expect(SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR)).rejects.toThrow(
        'User has not completed their account setup (encryption keys missing).'
      );
    });

    it('creates a new wrappedKey doc with default isActive/isGuest and no expiresAt', async () => {
      const { publicKey } = await SharingKeyManagementService.generateUserKeyPair();
      await setDoc(doc(db, 'users', TARGET), { encryption: { publicKey } });

      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR);

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      expect(snap.exists()).toBe(true);
      const data = snap.data()!;
      expect(data.recordId).toBe(RECORD_ID);
      expect(data.userId).toBe(TARGET);
      expect(data.isActive).toBe(true);
      expect(data.isCreator).toBe(false);
      expect(data.isGuest).toBe(false);
      expect(data.grantedBy).toBe(GRANTOR);
      expect(data.wrappedKey.length).toBeGreaterThan(0);
      expect(data.expiresAt).toBeUndefined();
      expect(data.history).toEqual([{ action: 'granted', by: GRANTOR, at: expect.anything() }]);
    });

    it('persists isActive:false, isGuest:true, and expiresAt when passed as options', async () => {
      const { publicKey } = await SharingKeyManagementService.generateUserKeyPair();
      await setDoc(doc(db, 'users', TARGET), { encryption: { publicKey } });
      const expiresAt = new Date('2027-01-01T00:00:00.000Z');

      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR, {
        isActive: false,
        isGuest: true,
        expiresAt,
      });

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      const data = snap.data()!;
      expect(data.isActive).toBe(false);
      expect(data.isGuest).toBe(true);
      expect(data.expiresAt).toBeDefined();
    });

    it('is a no-op when an active wrappedKey already exists — never re-reads the receiver or re-wraps', async () => {
      const { publicKey } = await SharingKeyManagementService.generateUserKeyPair();
      await setDoc(doc(db, 'users', TARGET), { encryption: { publicKey } });
      await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`), {
        recordId: RECORD_ID,
        userId: TARGET,
        wrappedKey: 'existing-wrapped-key-value',
        isActive: true,
        isCreator: false,
        isGuest: false,
        grantedBy: 'someone-else',
      });

      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR);

      expect(RecordDecryptionService.getRecordKey).not.toHaveBeenCalled();
      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      expect(snap.data()?.wrappedKey).toBe('existing-wrapped-key-value');
      expect(snap.data()?.grantedBy).toBe('someone-else');
      expect(snap.data()?.history).toBeUndefined();
    });

    it('reactivates an inactive wrappedKey: re-wraps the key and stamps reactivatedAt/reactivatedBy', async () => {
      const { publicKey } = await SharingKeyManagementService.generateUserKeyPair();
      await setDoc(doc(db, 'users', TARGET), { encryption: { publicKey } });
      await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`), {
        recordId: RECORD_ID,
        userId: TARGET,
        wrappedKey: 'stale-wrapped-key-value',
        isActive: false,
        isCreator: false,
        isGuest: false,
        grantedBy: GRANTOR,
        revokedAt: new Date(),
        revokedBy: GRANTOR,
      });

      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, 'reactivator');

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      const data = snap.data()!;
      expect(data.isActive).toBe(true);
      expect(data.wrappedKey).not.toBe('stale-wrapped-key-value');
      expect(data.reactivatedBy).toBe('reactivator');
      expect(data.reactivatedAt).toBeDefined();
      // The seed doc had no history field at all (pre-dates this field, or was created before
      // this key ever went through SharingService) — arrayUnion on a missing field still starts
      // a fresh array rather than throwing.
      expect(data.history).toEqual([{ action: 'reactivated', by: 'reactivator', at: expect.anything() }]);
    });

    it('produces a wrappedKey the receiver can actually unwrap with their real private key, recovering the exact record key', async () => {
      const { publicKey, privateKey } = await SharingKeyManagementService.generateUserKeyPair();
      await setDoc(doc(db, 'users', TARGET), { encryption: { publicKey } });

      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR);

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      const wrappedKeyBase64 = snap.data()!.wrappedKey as string;

      const receiverPrivateKey = await SharingKeyManagementService.importPrivateKey(privateKey);
      const recoveredKey = await SharingKeyManagementService.unwrapKey(wrappedKeyBase64, receiverPrivateKey);

      const originalRaw = await exportRawBase64(defaultRecordKey);
      const recoveredRaw = await exportRawBase64(recoveredKey);
      expect(recoveredRaw).toBe(originalRaw);
    });
  });

  describe('revokeEncryptionAccess', () => {
    it('throws when the caller is not authenticated', async () => {
      setCaller(null);
      await expect(SharingService.revokeEncryptionAccess(RECORD_ID, TARGET, GRANTOR)).rejects.toThrow(
        'User not authenticated'
      );
    });

    it('is a no-op when no wrappedKey doc exists', async () => {
      await expect(
        SharingService.revokeEncryptionAccess(RECORD_ID, TARGET, GRANTOR)
      ).resolves.toBeUndefined();
    });

    it('is a no-op when the wrappedKey is already inactive', async () => {
      await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`), {
        recordId: RECORD_ID,
        userId: TARGET,
        wrappedKey: 'x',
        isActive: false,
        isCreator: false,
        isGuest: false,
      });

      await SharingService.revokeEncryptionAccess(RECORD_ID, TARGET, GRANTOR);

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      expect(snap.data()?.revokedAt).toBeUndefined();
      expect(snap.data()?.history).toBeUndefined();
    });

    it('deactivates an active wrappedKey and stamps revokedAt/revokedBy', async () => {
      await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`), {
        recordId: RECORD_ID,
        userId: TARGET,
        wrappedKey: 'x',
        isActive: true,
        isCreator: false,
        isGuest: false,
      });

      await SharingService.revokeEncryptionAccess(RECORD_ID, TARGET, 'revoker1');

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      const data = snap.data()!;
      expect(data.isActive).toBe(false);
      expect(data.revokedBy).toBe('revoker1');
      expect(data.revokedAt).toBeDefined();
      expect(data.history).toEqual([{ action: 'revoked', by: 'revoker1', at: expect.anything() }]);
    });
  });

  describe('wrappedKeys history — survives multiple grant/revoke/reactivate cycles', () => {
    it('accumulates one history entry per action, in order, across a full grant -> revoke -> reactivate -> revoke cycle', async () => {
      const { publicKey } = await SharingKeyManagementService.generateUserKeyPair();
      await setDoc(doc(db, 'users', TARGET), { encryption: { publicKey } });

      // Cycle: granted by GRANTOR -> revoked by 'revoker-a' -> reactivated by 'reactivator-b' ->
      // revoked again by 'revoker-c'. Each step used to overwrite the previous actor's *By/*At
      // fields entirely — this proves none of the intermediate actors are lost anymore.
      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, GRANTOR);
      await SharingService.revokeEncryptionAccess(RECORD_ID, TARGET, 'revoker-a');
      await SharingService.grantEncryptionAccess(RECORD_ID, TARGET, 'reactivator-b');
      await SharingService.revokeEncryptionAccess(RECORD_ID, TARGET, 'revoker-c');

      const snap = await getDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`));
      const data = snap.data()!;

      // The flat fields still only reflect the latest action of each kind (unchanged behavior —
      // still relied on by trusteePermissionService.ts's where('grantedBy', ...) queries).
      expect(data.grantedBy).toBe(GRANTOR);
      expect(data.revokedBy).toBe('revoker-c');

      // history preserves every event, including the ones the flat fields overwrote.
      expect(data.history).toEqual([
        { action: 'granted', by: GRANTOR, at: expect.anything() },
        { action: 'revoked', by: 'revoker-a', at: expect.anything() },
        { action: 'reactivated', by: 'reactivator-b', at: expect.anything() },
        { action: 'revoked', by: 'revoker-c', at: expect.anything() },
      ]);
    });
  });

  describe('hasEncryptionAccess', () => {
    it('returns false when no wrappedKey doc exists', async () => {
      await expect(SharingService.hasEncryptionAccess(RECORD_ID, TARGET)).resolves.toBe(false);
    });

    it('returns false when the wrappedKey is inactive', async () => {
      await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`), { isActive: false });
      await expect(SharingService.hasEncryptionAccess(RECORD_ID, TARGET)).resolves.toBe(false);
    });

    it('returns true when the wrappedKey is active', async () => {
      await setDoc(doc(db, 'wrappedKeys', `${RECORD_ID}_${TARGET}`), { isActive: true });
      await expect(SharingService.hasEncryptionAccess(RECORD_ID, TARGET)).resolves.toBe(true);
    });
  });

});
