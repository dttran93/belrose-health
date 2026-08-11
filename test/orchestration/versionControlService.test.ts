// test/orchestration/versionControlService.test.ts
//
// Layer 3 (orchestration) — VersionControlService, the most complex service in ViewEditRecord.
// Real Firestore emulator + REAL EncryptionService/EncryptionKeyManager/RecordDecryptionService/
// SharingKeyManagementService/encryptNotificationTitle (same "prove the real crypto loop works"
// philosophy as recordDecryptionService.test.ts). Only firebase/auth (to control the caller) and
// @/firebase/uploadUtils's updateFirestoreRecord (a peer dependency covered by its own
// orchestration suite) are mocked.
//
// VersionControlService itself calls getFirestore()/getAuth() with no app argument, so
// connectTestFirestore's default-app swap just works here — unlike src/firebase/uploadUtils.ts,
// which needed the @/firebase/config getter-mock trick.

import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, getDocs, setDoc, collection } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../../src/utils/dataFormattingUtils';

const { mockCurrentUser, updateFirestoreRecordMock } = vi.hoisted(() => ({
  mockCurrentUser: { uid: null as string | null, displayName: null as string | null, email: null as string | null },
  updateFirestoreRecordMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({
    currentUser: mockCurrentUser.uid
      ? { uid: mockCurrentUser.uid, displayName: mockCurrentUser.displayName, email: mockCurrentUser.email }
      : null,
  }),
}));

vi.mock('@/firebase/uploadUtils', () => ({
  updateFirestoreRecord: updateFirestoreRecordMock,
}));

import { VersionControlService } from '../../src/features/ViewEditRecord/services/versionControlService';
import { EncryptionService } from '../../src/features/Encryption/services/encryptionService';
import { EncryptionKeyManager } from '../../src/features/Encryption/services/encryptionKeyManager';
import { SharingKeyManagementService } from '../../src/features/Sharing/services/sharingKeyManagementService';

const CREATOR = 'version-control-creator';
const SHARED_USER = 'version-control-shared-user';
const OTHER_USER = 'version-control-other-user';

function setCaller(uid: string | null, overrides: { displayName?: string; email?: string } = {}) {
  mockCurrentUser.uid = uid;
  mockCurrentUser.displayName = overrides.displayName ?? null;
  mockCurrentUser.email = overrides.email ?? (uid ? `${uid}@example.com` : null);
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

async function encryptField(fileKey: CryptoKey, text: string) {
  const { encrypted, iv } = await EncryptionService.encryptText(text, fileKey);
  return { encrypted: arrayBufferToBase64(encrypted), iv: arrayBufferToBase64(iv) };
}

async function encryptJSONField(fileKey: CryptoKey, data: any) {
  const { encrypted, iv } = await EncryptionService.encryptJSON(data, fileKey);
  return { encrypted: arrayBufferToBase64(encrypted), iv: arrayBufferToBase64(iv) };
}

const db = connectTestFirestore('belrose-orchestration-version-control');

interface RecordRoles {
  owners?: string[];
  administrators?: string[];
  viewers?: string[];
  subjects?: string[];
  uploadedBy?: string;
}

async function seedRecordDoc(recordId: string, roles: RecordRoles, encryptedFields: any, recordHash = '') {
  await setDoc(doc(db, 'records', recordId), {
    owners: roles.owners ?? [],
    administrators: roles.administrators ?? [],
    viewers: roles.viewers ?? [],
    subjects: roles.subjects ?? [],
    uploadedBy: roles.uploadedBy,
    recordHash,
    ...encryptedFields,
  });
}

async function seedCreatorWrappedKey(recordId: string, uid: string, fileKey: CryptoKey, masterKey: CryptoKey) {
  const wrapped = await EncryptionService.encryptKeyWithMasterKey(fileKey, masterKey);
  await setDoc(doc(db, 'wrappedKeys', `${recordId}_${uid}`), {
    recordId,
    userId: uid,
    wrappedKey: arrayBufferToBase64(wrapped),
    isActive: true,
    isCreator: true,
    isGuest: false,
  });
}

async function seedSharedUserAccess(
  recordId: string,
  sharedUserId: string,
  fileKey: CryptoKey,
  sharedUserMasterKey: CryptoKey
) {
  const { publicKey, privateKey } = await SharingKeyManagementService.generateUserKeyPair();

  const { encrypted, iv } = await EncryptionService.encryptFile(
    base64ToArrayBuffer(privateKey),
    sharedUserMasterKey
  );
  await setDoc(doc(db, 'users', sharedUserId), {
    encryption: {
      encryptedPrivateKey: arrayBufferToBase64(encrypted),
      encryptedPrivateKeyIV: arrayBufferToBase64(iv),
      publicKey,
    },
  });

  const rsaPublicKey = await SharingKeyManagementService.importPublicKey(publicKey);
  const wrappedForSharedUser = await SharingKeyManagementService.wrapKey(fileKey, rsaPublicKey);
  await setDoc(doc(db, 'wrappedKeys', `${recordId}_${sharedUserId}`), {
    recordId,
    userId: sharedUserId,
    wrappedKey: wrappedForSharedUser,
    isActive: true,
    isCreator: false,
    isGuest: false,
  });
}

/** Builds the object createVersion expects: plaintext fields (for diffing) + encrypted* fields (for the stored snapshot) — mirroring uploadUtils.ts's now-fixed encryptedUpdatedFileObject. */
async function buildUpdatedRecord(
  fileKey: CryptoKey,
  plaintext: { fileName: string; extractedText?: string | null; fhirData?: any },
  recordHash: string
) {
  const encryptedFileName = await encryptField(fileKey, plaintext.fileName);
  const encryptedExtractedText = plaintext.extractedText
    ? await encryptField(fileKey, plaintext.extractedText)
    : null;
  const encryptedFhirData = plaintext.fhirData ? await encryptJSONField(fileKey, plaintext.fhirData) : null;

  return {
    fileName: plaintext.fileName,
    extractedText: plaintext.extractedText ?? null,
    originalText: null,
    contextText: null,
    fhirData: plaintext.fhirData ?? null,
    belroseFields: null,
    customData: null,
    originalFileHash: null,
    encryptedFileName,
    encryptedExtractedText,
    encryptedFhirData,
    recordHash,
  };
}

beforeEach(async () => {
  await clearTestFirestore();
  installFakeSessionStorage();
  EncryptionKeyManager.clearSession();
  updateFirestoreRecordMock.mockReset();
  setCaller(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  getApps().forEach(app => deleteApp(app));
});

describe('VersionControlService.createVersion — first edit (creator)', () => {
  it('creates a v0 baseline snapshot of the original record, then a v1 with the diff', async () => {
    const RECORD_ID = 'record-first-edit';
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    const fileKey = await EncryptionService.generateFileKey();

    const originalEncryptedFileName = await encryptField(fileKey, 'v0-name.pdf');
    const originalEncryptedText = await encryptField(fileKey, 'v0 extracted text');
    await seedRecordDoc(
      RECORD_ID,
      { administrators: [CREATOR], uploadedBy: CREATOR },
      { encryptedFileName: originalEncryptedFileName, encryptedExtractedText: originalEncryptedText },
      'hash-v0'
    );
    await seedCreatorWrappedKey(RECORD_ID, CREATOR, fileKey, masterKey);

    setCaller(CREATOR, { displayName: 'Creator One' });
    EncryptionKeyManager.setSessionKey(masterKey);

    const updatedRecord = await buildUpdatedRecord(
      fileKey,
      { fileName: 'v1-name.pdf', extractedText: 'v1 extracted text' },
      'hash-v1'
    );

    const service = new VersionControlService();
    const newVersionId = await service.createVersion(RECORD_ID, updatedRecord as any, 'My Record', 'first edit');

    expect(newVersionId).toBe(`${RECORD_ID}_v1`);

    const v0Snap = await getDoc(doc(db, 'records', RECORD_ID, 'versionHistory', `${RECORD_ID}_v0`));
    expect(v0Snap.exists()).toBe(true);
    const v0 = v0Snap.data()!;
    expect(v0.versionNumber).toBe(0);
    expect(v0.commitMessage).toBe('Original Upload (auto-created baseline)');
    expect(v0.recordHash).toBe('hash-v0');
    expect(v0.recordSnapshot.encryptedFileName).toMatchObject(originalEncryptedFileName);

    const v1Snap = await getDoc(doc(db, 'records', RECORD_ID, 'versionHistory', `${RECORD_ID}_v1`));
    expect(v1Snap.exists()).toBe(true);
    const v1 = v1Snap.data()!;
    expect(v1.versionNumber).toBe(1);
    expect(v1.editedBy).toBe(CREATOR);
    expect(v1.editedByName).toBe('Creator One');
    expect(v1.recordHash).toBe('hash-v1');
    expect(v1.encryptedChanges).toEqual(expect.any(String));
    expect(v1.recordSnapshot.encryptedFileName).toMatchObject(updatedRecord.encryptedFileName);

    const changes = await service.getVersionChanges(v1 as any);
    const fileNameChange = changes.find(c => c.path === 'fileName');
    expect(fileNameChange).toMatchObject({
      operation: 'update',
      oldValue: 'v0-name.pdf',
      newValue: 'v1-name.pdf',
    });
  });

  it('builds off v1 (not v0) when creating a second version', async () => {
    const RECORD_ID = 'record-second-edit';
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    const fileKey = await EncryptionService.generateFileKey();

    await seedRecordDoc(
      RECORD_ID,
      { administrators: [CREATOR], uploadedBy: CREATOR },
      { encryptedFileName: await encryptField(fileKey, 'v0-name.pdf') },
      'hash-v0'
    );
    await seedCreatorWrappedKey(RECORD_ID, CREATOR, fileKey, masterKey);
    setCaller(CREATOR);
    EncryptionKeyManager.setSessionKey(masterKey);

    const service = new VersionControlService();
    await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v1-name.pdf' }, 'hash-v1')) as any
    );

    const v2Id = await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v2-name.pdf' }, 'hash-v2')) as any
    );

    expect(v2Id).toBe(`${RECORD_ID}_v2`);
    const v2 = (await getDoc(doc(db, 'records', RECORD_ID, 'versionHistory', v2Id))).data()!;
    const changes = await service.getVersionChanges(v2 as any);
    const fileNameChange = changes.find(c => c.path === 'fileName');
    // Diffed against v1 ("v1-name.pdf"), not v0 ("v0-name.pdf")
    expect(fileNameChange).toMatchObject({ oldValue: 'v1-name.pdf', newValue: 'v2-name.pdf' });
  });
});

describe('VersionControlService.createVersion — shared (non-creator) user', () => {
  it('decrypts the previous version and encrypts the new changes via RSA unwrap', async () => {
    const RECORD_ID = 'record-shared-edit';
    const fileKey = await EncryptionService.generateFileKey();
    const sharedUserMasterKey = await EncryptionKeyManager.generateMasterKey();

    await seedRecordDoc(
      RECORD_ID,
      { administrators: [SHARED_USER], uploadedBy: 'someone-else' },
      { encryptedFileName: await encryptField(fileKey, 'shared-v0.pdf') },
      'hash-v0'
    );
    await seedSharedUserAccess(RECORD_ID, SHARED_USER, fileKey, sharedUserMasterKey);
    setCaller(SHARED_USER);
    EncryptionKeyManager.setSessionKey(sharedUserMasterKey);

    const service = new VersionControlService();
    const v1Id = await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'shared-v1.pdf' }, 'hash-v1')) as any
    );

    const v1 = (await getDoc(doc(db, 'records', RECORD_ID, 'versionHistory', v1Id))).data()!;
    const changes = await service.getVersionChanges(v1 as any);
    expect(changes.find(c => c.path === 'fileName')).toMatchObject({
      oldValue: 'shared-v0.pdf',
      newValue: 'shared-v1.pdf',
    });
  });
});

describe('VersionControlService.getVersionHistory', () => {
  it('denies a user with no role on the record', async () => {
    const RECORD_ID = 'record-history-denied';
    await seedRecordDoc(RECORD_ID, { administrators: ['someone-else'], uploadedBy: 'someone-else' }, {});
    setCaller(OTHER_USER);

    const service = new VersionControlService();
    await expect(service.getVersionHistory(RECORD_ID)).rejects.toThrow(
      "You do not have permission to view this record's history"
    );
  });

  it('returns versions ordered newest-first', async () => {
    const RECORD_ID = 'record-history-ordered';
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    const fileKey = await EncryptionService.generateFileKey();
    await seedRecordDoc(RECORD_ID, { administrators: [CREATOR], uploadedBy: CREATOR }, {}, 'hash-v0');
    await seedCreatorWrappedKey(RECORD_ID, CREATOR, fileKey, masterKey);
    setCaller(CREATOR);
    EncryptionKeyManager.setSessionKey(masterKey);

    const service = new VersionControlService();
    await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v1.pdf' }, 'hash-v1')) as any
    );
    await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v2.pdf' }, 'hash-v2')) as any
    );

    const history = await service.getVersionHistory(RECORD_ID);
    expect(history.map(v => v.versionNumber)).toEqual([2, 1, 0]);
  });
});

describe('VersionControlService.rollbackToVersion', () => {
  async function seedRecordWithTwoVersions() {
    const RECORD_ID = 'record-rollback';
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    const fileKey = await EncryptionService.generateFileKey();
    await seedRecordDoc(RECORD_ID, { administrators: [CREATOR], uploadedBy: CREATOR }, {}, 'hash-v0');
    await seedCreatorWrappedKey(RECORD_ID, CREATOR, fileKey, masterKey);
    setCaller(CREATOR);
    EncryptionKeyManager.setSessionKey(masterKey);

    const v1Id = await new VersionControlService().createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v1.pdf' }, 'hash-v1')) as any
    );
    return { RECORD_ID, v1Id };
  }

  it('denies a user who is neither an owner nor an administrator', async () => {
    const { RECORD_ID, v1Id } = await seedRecordWithTwoVersions();
    setCaller(OTHER_USER);

    // A fresh instance is required — VersionControlService's constructor captures getAuth()
    // once, so re-using an instance built under a different caller wouldn't see this change
    // (real callers always `new VersionControlService()` per operation, same as here).
    await expect(new VersionControlService().rollbackToVersion(RECORD_ID, v1Id)).rejects.toThrow(
      "You do not have permission to rollback this record's history"
    );
  });

  it('creates an undo-point version and calls updateFirestoreRecord with the restored data', async () => {
    const { RECORD_ID, v1Id } = await seedRecordWithTwoVersions();

    const versionsBefore = await getDocs(collection(db, 'records', RECORD_ID, 'versionHistory'));
    expect(versionsBefore.docs).toHaveLength(2); // v0 + v1

    await new VersionControlService().rollbackToVersion(RECORD_ID, v1Id, true);

    const versionsAfter = await getDocs(collection(db, 'records', RECORD_ID, 'versionHistory'));
    expect(versionsAfter.docs).toHaveLength(3); // v0 + v1 + undo-point v2

    expect(updateFirestoreRecordMock).toHaveBeenCalledTimes(1);
    const [calledRecordId, restoredData, commitMessage] = updateFirestoreRecordMock.mock.calls[0]!;
    expect(calledRecordId).toBe(RECORD_ID);
    expect(restoredData.fileName).toBeDefined();
    expect(commitMessage).toContain('Restored to version');
  });

  it('does not touch the main record when updateMainRecord is false', async () => {
    const { RECORD_ID, v1Id } = await seedRecordWithTwoVersions();

    await new VersionControlService().rollbackToVersion(RECORD_ID, v1Id, false);

    expect(updateFirestoreRecordMock).not.toHaveBeenCalled();
  });
});

describe('VersionControlService.compareVersions', () => {
  it('always compares older -> newer, regardless of argument order', async () => {
    const RECORD_ID = 'record-compare';
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    const fileKey = await EncryptionService.generateFileKey();
    await seedRecordDoc(
      RECORD_ID,
      { administrators: [CREATOR], uploadedBy: CREATOR },
      { encryptedFileName: await encryptField(fileKey, 'v0.pdf') },
      'hash-v0'
    );
    await seedCreatorWrappedKey(RECORD_ID, CREATOR, fileKey, masterKey);
    setCaller(CREATOR);
    EncryptionKeyManager.setSessionKey(masterKey);

    const service = new VersionControlService();
    const v1Id = await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v1.pdf' }, 'hash-v1')) as any
    );
    const v0Id = `${RECORD_ID}_v0`;

    const diffForward = await service.compareVersions(RECORD_ID, v0Id, v1Id);
    const diffReversed = await service.compareVersions(RECORD_ID, v1Id, v0Id);

    for (const diff of [diffForward, diffReversed]) {
      expect(diff.olderVersionId).toBe(v0Id);
      expect(diff.newerVersionId).toBe(v1Id);
      expect(diff.changes.find(c => c.path === 'fileName')).toMatchObject({
        oldValue: 'v0.pdf',
        newValue: 'v1.pdf',
      });
      expect(diff.summary).toContain('change');
    }
  });
});

describe('VersionControlService.deleteAllVersions', () => {
  it('deletes every version document for the record', async () => {
    const RECORD_ID = 'record-delete-all';
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    const fileKey = await EncryptionService.generateFileKey();
    await seedRecordDoc(RECORD_ID, { administrators: [CREATOR], uploadedBy: CREATOR }, {}, 'hash-v0');
    await seedCreatorWrappedKey(RECORD_ID, CREATOR, fileKey, masterKey);
    setCaller(CREATOR);
    EncryptionKeyManager.setSessionKey(masterKey);

    const service = new VersionControlService();
    await service.createVersion(
      RECORD_ID,
      (await buildUpdatedRecord(fileKey, { fileName: 'v1.pdf' }, 'hash-v1')) as any
    );

    await service.deleteAllVersions(RECORD_ID);

    const remaining = await getDocs(collection(db, 'records', RECORD_ID, 'versionHistory'));
    expect(remaining.docs).toHaveLength(0);
  });
});
