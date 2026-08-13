// test/orchestration/updateFirestoreRecord.test.ts
//
// Layer 3 (orchestration) — src/firebase/uploadUtils.ts's updateFirestoreRecord: decrypts the
// existing record for hashing context, re-encrypts only the changed fields, regenerates the
// record hash, and delegates to VersionControlService.createVersion. Same '@/firebase/config'
// getter-mock as createFirestoreRecord.test.ts (db/auth are pre-bound consts there, not fetched
// fresh like PermissionsService does). VersionControlService is mocked here as a peer dependency
// — it has its own full orchestration suite (versionControlService.test.ts) — specifically so
// this test can assert *what* updateFirestoreRecord hands it: this is exactly the regression
// test for the bug where encryptedUpdatedFileObject carried no plaintext fields at all, making
// every version diff show every field as nulled out.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } from 'firebase/firestore';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/utils/dataFormattingUtils';

const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8090;

let testDb: ReturnType<typeof getFirestore>;
const callerState: { uid: string | null } = { uid: null };

vi.mock('@/firebase/config', () => ({
  get db() {
    return testDb;
  },
  auth: {
    get currentUser() {
      return callerState.uid ? { uid: callerState.uid } : null;
    },
  },
}));

const { createVersionMock } = vi.hoisted(() => ({ createVersionMock: vi.fn() }));

vi.mock('@/features/ViewEditRecord/services/versionControlService', () => ({
  VersionControlService: vi.fn().mockImplementation(function () {
    return { createVersion: createVersionMock };
  }),
}));

import { updateFirestoreRecord } from '@/firebase/uploadUtils';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { SharingKeyManagementService } from '@/features/Sharing/services/sharingKeyManagementService';

getApps().forEach(app => deleteApp(app));
const app = initializeApp({ projectId: 'belrose-orchestration-update-record' });
testDb = getFirestore(app);
connectFirestoreEmulator(testDb, EMULATOR_HOST, EMULATOR_PORT);

function setCaller(uid: string | null) {
  callerState.uid = uid;
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

async function seedCreatorRecord(
  documentId: string,
  uid: string,
  fileKey: CryptoKey,
  masterKey: CryptoKey,
  plaintext: { fileName: string; extractedText: string; fhirData?: any }
) {
  const encryptedFileName = await encryptField(fileKey, plaintext.fileName);
  const encryptedExtractedText = await encryptField(fileKey, plaintext.extractedText);
  await setDoc(doc(testDb, 'records', documentId), {
    encryptedFileName,
    encryptedExtractedText,
    recordHash: 'hash-original',
    previousRecordHash: [],
    versionNumber: 0,
    administrators: [uid],
    owners: [],
  });

  const wrapped = await EncryptionService.encryptKeyWithMasterKey(fileKey, masterKey);
  await setDoc(doc(testDb, 'wrappedKeys', `${documentId}_${uid}`), {
    recordId: documentId,
    userId: uid,
    wrappedKey: arrayBufferToBase64(wrapped),
    isActive: true,
    isCreator: true,
  });

  return { encryptedFileName, encryptedExtractedText };
}

beforeEach(async () => {
  await fetch(
    `http://${EMULATOR_HOST}:${EMULATOR_PORT}/emulator/v1/projects/belrose-orchestration-update-record/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  installFakeSessionStorage();
  EncryptionKeyManager.clearSession();
  createVersionMock.mockReset();
  setCaller(null);
});

afterAll(() => {
  getApps().forEach(a => deleteApp(a));
});

describe('updateFirestoreRecord — guard clauses', () => {
  it('throws when there is no authenticated user', async () => {
    await expect(updateFirestoreRecord('doc-1', { fileName: 'x.pdf' })).rejects.toThrow(
      'User not authenticated'
    );
  });

  it('throws when the document does not exist', async () => {
    setCaller('creator-1');
    await expect(updateFirestoreRecord('missing-doc', { fileName: 'x.pdf' })).rejects.toThrow(
      'Document not found'
    );
  });

  it('throws when there is no active encryption session', async () => {
    setCaller('creator-1');
    const fileKey = await EncryptionService.generateFileKey();
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    await seedCreatorRecord('doc-1', 'creator-1', fileKey, masterKey, {
      fileName: 'a.pdf',
      extractedText: 'text',
    });
    // Deliberately do not call EncryptionKeyManager.setSessionKey.

    await expect(updateFirestoreRecord('doc-1', { fileName: 'b.pdf' })).rejects.toThrow(
      'Please unlock your encryption to save changes.'
    );
  });

  it('throws when the caller has no active wrappedKey for this record', async () => {
    setCaller('creator-1');
    const fileKey = await EncryptionService.generateFileKey();
    const masterKey = await EncryptionKeyManager.generateMasterKey();
    await seedCreatorRecord('doc-1', 'creator-1', fileKey, masterKey, {
      fileName: 'a.pdf',
      extractedText: 'text',
    });
    EncryptionKeyManager.setSessionKey(masterKey);
    setCaller('intruder-1'); // no wrappedKeys/doc-1_intruder-1 doc

    await expect(updateFirestoreRecord('doc-1', { fileName: 'b.pdf' })).rejects.toThrow(
      'You do not have access to this record'
    );
  });
});

describe('updateFirestoreRecord — creator happy path', () => {
  // Custom timeout: real RSA/AES key gen + encrypt/decrypt + hashing, plus (since the
  // credibility-reset step landed) an extra scoreEvents query + write — consistently the
  // heaviest single test in this suite. Passes comfortably in isolation under the 20s default
  // but occasionally exceeds it under the full orchestration suite's concurrent emulator load.
  it(
    're-encrypts only the changed field, regenerates the hash, and updates version history',
    async () => {
      setCaller('creator-1');
      const fileKey = await EncryptionService.generateFileKey();
      const masterKey = await EncryptionKeyManager.generateMasterKey();
      const { encryptedFileName: originalEncryptedFileName, encryptedExtractedText } =
        await seedCreatorRecord('doc-1', 'creator-1', fileKey, masterKey, {
          fileName: 'original.pdf',
          extractedText: 'original extracted text',
        });
      EncryptionKeyManager.setSessionKey(masterKey);

      await updateFirestoreRecord('doc-1', { fileName: 'renamed.pdf' }, 'renamed the file');

      const updatedDoc = (await getDoc(doc(testDb, 'records', 'doc-1'))).data()!;
      expect(updatedDoc.encryptedFileName).not.toEqual(originalEncryptedFileName);
      expect(updatedDoc.recordHash).not.toBe('hash-original');
      expect(updatedDoc.previousRecordHash).toEqual(['hash-original']);
      expect(updatedDoc.versionNumber).toBe(1);
      // Untouched field's ciphertext is preserved as-is (not re-encrypted).
      expect(updatedDoc.encryptedExtractedText).toMatchObject(encryptedExtractedText);
      // New recordHash has no scoreEvents yet, so the cached credibility score resets to
      // INITIAL_SCORE rather than carrying forward whatever the pre-edit hash had.
      expect(updatedDoc.credibility?.score).toBe(500);

      // Regression check for the encryptedUpdatedFileObject plaintext-fields fix: the object
      // passed to createVersion must carry the actual plaintext for diffing, not just ciphertext.
      expect(createVersionMock).toHaveBeenCalledTimes(1);
      const [calledDocId, updatedFileObjectArg, recordTitle, commitMessage] =
        createVersionMock.mock.calls[0]!;
      expect(calledDocId).toBe('doc-1');
      expect(updatedFileObjectArg.fileName).toBe('renamed.pdf');
      expect(updatedFileObjectArg.extractedText).toBe('original extracted text');
      expect(recordTitle).toBe('renamed.pdf');
      expect(commitMessage).toBe('renamed the file');
    },
    45000
  );
});

describe('updateFirestoreRecord — shared (non-creator) user', () => {
  it('unwraps the file key via RSA and updates the record', async () => {
    const SHARED_USER = 'shared-user-1';
    const fileKey = await EncryptionService.generateFileKey();
    const sharedUserMasterKey = await EncryptionKeyManager.generateMasterKey();

    const { publicKey, privateKey } = await SharingKeyManagementService.generateUserKeyPair();
    const { encrypted, iv } = await EncryptionService.encryptFile(
      base64ToArrayBuffer(privateKey),
      sharedUserMasterKey
    );
    await setDoc(doc(testDb, 'users', SHARED_USER), {
      encryption: {
        encryptedPrivateKey: arrayBufferToBase64(encrypted),
        encryptedPrivateKeyIV: arrayBufferToBase64(iv),
        publicKey,
      },
    });

    await setDoc(doc(testDb, 'records', 'doc-shared'), {
      encryptedFileName: await encryptField(fileKey, 'shared-original.pdf'),
      recordHash: 'hash-original',
      previousRecordHash: [],
      versionNumber: 0,
      administrators: [SHARED_USER],
      owners: [],
    });

    const rsaPublicKey = await SharingKeyManagementService.importPublicKey(publicKey);
    const wrappedForSharedUser = await SharingKeyManagementService.wrapKey(fileKey, rsaPublicKey);
    await setDoc(doc(testDb, 'wrappedKeys', `doc-shared_${SHARED_USER}`), {
      recordId: 'doc-shared',
      userId: SHARED_USER,
      wrappedKey: wrappedForSharedUser,
      isActive: true,
      isCreator: false,
    });

    setCaller(SHARED_USER);
    EncryptionKeyManager.setSessionKey(sharedUserMasterKey);

    await updateFirestoreRecord('doc-shared', { fileName: 'shared-renamed.pdf' });

    const updatedDoc = (await getDoc(doc(testDb, 'records', 'doc-shared'))).data()!;
    expect(updatedDoc.recordHash).not.toBe('hash-original');
    const [, updatedFileObjectArg] = createVersionMock.mock.calls[0]!;
    expect(updatedFileObjectArg.fileName).toBe('shared-renamed.pdf');
  });
});
