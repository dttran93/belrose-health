// test/orchestration/helpers/testFirestore.ts
//
// Connects the REAL firebase/firestore client SDK (the same one PermissionsService uses
// internally via getFirestore()) to the dedicated orchestration emulator — see
// firebase.orchestration.json / test/orchestration/permissive.rules. PermissionsService
// calls getFirestore() with no app argument, which resolves to whichever app was most
// recently initializeApp()'d — so connectTestFirestore() must run before any test calls
// into PermissionsService.
//
// Each test FILE must pass its own unique projectId. Vitest runs test files in parallel by
// default, and the Firestore emulator can host many independent projects at once (the same
// trick test/rules uses, one projectId per file) — sharing one projectId across files means
// one file's beforeEach-clear can wipe data another file's in-flight test just seeded.

import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, type Firestore } from 'firebase/firestore';

const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8090;

let db: Firestore | undefined;
let connectedProjectId: string | undefined;

export function connectTestFirestore(projectId: string): Firestore {
  if (db) return db;

  // Clear out any app left behind by a previous file in the same worker.
  getApps().forEach(app => deleteApp(app));

  const app = initializeApp({ projectId });
  db = getFirestore(app);
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT);
  connectedProjectId = projectId;
  return db;
}

export async function clearTestFirestore(): Promise<void> {
  await fetch(
    `http://${EMULATOR_HOST}:${EMULATOR_PORT}/emulator/v1/projects/${connectedProjectId}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
}

/** Seeds a users/{uid} doc with the wallet address PermissionsService.getUserWalletAddress reads. */
export async function seedUser(testDb: Firestore, uid: string, walletAddress: string): Promise<void> {
  await setDoc(doc(testDb, 'users', uid), { wallet: { address: walletAddress } });
}

type RecordRoleArrays = {
  owners?: string[];
  administrators?: string[];
  sharers?: string[];
  viewers?: string[];
  subjects?: string[];
  /** Omitted from the written doc entirely when not provided (Firestore rejects `undefined`). */
  uploadedBy?: string;
};

export async function seedRecord(
  testDb: Firestore,
  recordId: string,
  roles: RecordRoleArrays
): Promise<void> {
  await setDoc(doc(testDb, 'records', recordId), {
    owners: roles.owners ?? [],
    administrators: roles.administrators ?? [],
    sharers: roles.sharers ?? [],
    viewers: roles.viewers ?? [],
    subjects: roles.subjects ?? [],
    ...(roles.uploadedBy ? { uploadedBy: roles.uploadedBy } : {}),
  });
}

/**
 * Seeds a users/{uid} doc with a full `encryption` block, matching the shape
 * RegistrationForm/DependentAccountService/GuestClaimAccountModal all produce via
 * AccountEncryptionService.generateEncryptionBundle. Used by Auth/Dependents/GuestAccess
 * orchestration suites that need "a real user who's already finished E2EE setup" without
 * hand-rolling the shape per test file.
 */
export async function seedUserWithEncryption(
  testDb: Firestore,
  uid: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'users', uid), {
    uid,
    email: `${uid}@example.com`,
    emailVerified: false,
    encryption: {
      enabled: true,
      encryptedMasterKey: 'encrypted-master-key',
      masterKeyIV: 'master-key-iv',
      masterKeySalt: 'master-key-salt',
      encryptedPrivateKey: 'encrypted-private-key',
      encryptedPrivateKeyIV: 'encrypted-private-key-iv',
      publicKey: 'public-key',
      recoveryKeyHash: 'recovery-key-hash',
      setupAt: new Date().toISOString(),
    },
    ...overrides,
  });
}

/** Seeds an invites/{email} doc — email is lowercased to match the app's own convention. */
export async function seedInviteDoc(
  testDb: Firestore,
  email: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'invites', email.toLowerCase()), {
    approved: true,
    code: 'AAAABBBBCCCCDDDD',
    ...overrides,
  });
}

/**
 * Seeds a trusteeRelationships/{trustorId}_{trusteeId} doc — doc id matches the app's own
 * convention (getTrusteeRelationshipId). Defaults to an active controller relationship, the
 * shape createDependentAccount.ts writes directly via Admin SDK; pass overrides for
 * observer/custodian trust levels or pending/non-dependent relationships as needed.
 */
export async function seedTrusteeRelationship(
  testDb: Firestore,
  trustorId: string,
  trusteeId: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'trusteeRelationships', `${trustorId}_${trusteeId}`), {
    trustorId,
    trusteeId,
    trustLevel: 'controller',
    isActive: true,
    status: 'active',
    isDependentRelationship: true,
    createdAt: new Date(),
    respondedAt: new Date(),
    revokedAt: null,
    revokedBy: null,
    statusUpdateReason: null,
    ...overrides,
  });
}

/**
 * Seeds a dependent's users/{uid} doc — seedUserWithEncryption plus the isDependent/
 * dependentCreatedBy fields createDependentAccount.ts writes for the dependent side of the
 * relationship.
 */
export async function seedDependentUser(
  testDb: Firestore,
  uid: string,
  guardianUid: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await seedUserWithEncryption(testDb, uid, {
    isDependent: true,
    dependentCreatedBy: guardianUid,
    ...overrides,
  });
}

/**
 * Seeds a users/{uid} doc matching the minimal guest profile shape
 * createOrRetrieveGuestAccount (functions/src/utils/guestAccountUtils.ts) writes:
 * isGuest:true, only encryption.publicKey — no wallet/onChainIdentity, no masterKey/RSA
 * private key material, since a guest's keys aren't password-derived yet.
 */
export async function seedGuestUser(
  testDb: Firestore,
  uid: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'users', uid), {
    uid,
    email: `${uid}@example.com`,
    displayName: `${uid}@example.com`,
    emailVerified: true,
    isGuest: true,
    encryption: {
      publicKey: 'guest-public-key',
    },
    ...overrides,
  });
}

/**
 * Seeds a guestInvites/{inviteId} doc matching the shape writeGuestInviteDoc
 * (functions/src/utils/guestAccountUtils.ts) writes. The real handler uses
 * collection.add() for an auto id; tests pass a fixed inviteId for determinism.
 */
export async function seedGuestInvite(
  testDb: Firestore,
  inviteId: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await setDoc(doc(testDb, 'guestInvites', inviteId), {
    guestUserId: 'guest-1',
    invitedBy: 'patient-1',
    guestEmail: 'guest-1@example.com',
    recordIds: ['rec-1'],
    status: 'pending',
    context: 'sharing',
    createdAt: new Date(),
    expiresAt,
    isNewGuest: true,
    inviteCode: 'test-invite-code',
    ...overrides,
  });
}

/**
 * Seeds a verifications/{recordHash}_{verifierId} doc matching the shape verificationService.ts
 * writes once a chain confirmation has landed (chainStatus:'confirmed', one onChainHistory
 * entry) — the steady state most tests want to seed directly rather than drive through
 * createVerification. Id format mirrors verificationService.getVerificationId; kept as an
 * inline template here (rather than importing the service) to avoid pulling
 * verificationService's full dependency graph into every orchestration test file that imports
 * this helper module.
 */
export async function seedVerification(
  testDb: Firestore,
  recordId: string,
  recordHash: string,
  verifierId: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'verifications', `${recordHash}_${verifierId}`), {
    recordId,
    recordHash,
    verifierId,
    verifierIdHash: `hash-${verifierId}`,
    level: 2,
    isActive: true,
    createdAt: new Date(),
    chainStatus: 'confirmed',
    onChainHistory: [{ action: 'verified', at: new Date(), blockchainRef: { txHash: '0xseed', blockNumber: 1 } }],
    normalizedCredibilityAtCreation: 1.0,
    ...overrides,
  });
}

/**
 * Seeds a disputes/{recordHash}_{disputerId} doc matching the shape disputeService.ts writes
 * once confirmed. `encryptedNotes` is intentionally omitted by default (real ciphertext needs
 * real encryption — pass it via overrides for tests that need it). Id format mirrors
 * disputeService.getDisputeId; kept inline for the same reason as seedVerification above.
 */
export async function seedDispute(
  testDb: Firestore,
  recordId: string,
  recordHash: string,
  disputerId: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'disputes', `${recordHash}_${disputerId}`), {
    recordId,
    recordHash,
    disputerId,
    disputerIdHash: `hash-${disputerId}`,
    severity: 2,
    culpability: 0,
    notesHash: '',
    isActive: true,
    createdAt: new Date(),
    chainStatus: 'confirmed',
    onChainHistory: [{ action: 'disputed', at: new Date(), blockchainRef: { txHash: '0xseed', blockNumber: 1 } }],
    recordScoreAtCreation: 500,
    validationWeight: 0,
    normalizedCredibilityAtCreation: 1.0,
    ...overrides,
  });
}

/**
 * Seeds a vouches/{voucherId}_{voucheeId} doc matching the shape vouchService.ts writes once
 * confirmed (chainStatus:'Active'). Id format mirrors vouchService.getVouchId; kept inline for
 * the same reason as seedVerification above.
 */
export async function seedVouch(
  testDb: Firestore,
  voucherId: string,
  voucheeId: string,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await setDoc(doc(testDb, 'vouches', `${voucherId}_${voucheeId}`), {
    voucherId,
    voucherIdHash: `hash-${voucherId}`,
    voucheeId,
    voucheeIdHash: `hash-${voucheeId}`,
    chainStatus: 'Active',
    createdAt: new Date(),
    onChainHistory: [{ action: 'vouched', at: new Date(), blockchainRef: { txHash: '0xseed', blockNumber: 1 } }],
    ...overrides,
  });
}
