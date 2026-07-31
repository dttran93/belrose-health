// e2e/helpers/backend/staging.ts
//
// Real Firebase Admin SDK client against belrose-757fe (the `staging` alias in .firebaserc),
// authenticated the same way functions/scripts/reregisterUsers.ts already does: a service
// account key at the repo root, already gitignored (.gitignore has .firebaseServiceAccountKey.json).
//
// invites/{email}, guestInvites/{id}, recordRequests/{id} and users/{guestUid} all have no
// client-side `allow create` in firestore.rules — they're meant to be written only by
// Admin-SDK-privileged Cloud Functions in production. Writing them here via the Admin SDK is
// the same privileged path those functions themselves use, not a rules workaround.
//
// cleanup() also deactivates each cleaned-up user's on-chain identity (MemberRoleManager.
// setUserStatus → Inactive) before deleting their Firestore/Auth records. Registration (both
// signup.spec.ts and requestFlowGuestClaim.spec.ts) makes a REAL MemberRoleManager.addMemberBatch
// call on Base Sepolia — deleting only the Firestore side would leave a real "Active" on-chain
// member with no Firestore record at all, i.e. the exact chain/Firestore parity problem this
// staging tier exists to avoid, just inverted. Signing key/address setup mirrors
// functions/scripts/reregisterUsers.ts (same PRIVATE_KEY already in root .env.local — the
// contract's admin wallet — same MEMBER_ROLE_MANAGER proxy address documented in CLAUDE.md).

import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';
// Default import, not `import * as admin` — under native ESM, firebase-admin (a CJS package
// with no named ESM exports) only exposes `{ default: <the real module.exports object> }` via
// a namespace import, which left `admin.credential` undefined at runtime.
import admin from 'firebase-admin';
import { ethers } from 'ethers';
import type { TestBackend, CreateAuthUserParams, CleanupRefs, ArrayRemoval } from './types';
import { TEST_INVITE_CODE } from '../seedInvite';
// Relative path into the shared package's source, not the `@belrose/shared` workspace alias —
// that alias resolves through node_modules/@belrose/shared (a symlink to raw .ts, no build
// step), which Playwright's test transform doesn't cover since it only transforms project files,
// not node_modules. blockchainAddresses.core.ts is deliberately dependency-free (see its own
// header) specifically so it can be imported this way by consumers outside the npm workspace's
// normal module graph — contracts/ and functions/ each get a copy of it for the same reason.
import { MEMBER_ROLE_MANAGER, NETWORK_CORE } from '../../../packages/shared/src/blockchainAddresses.core';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getApp(): admin.app.App {
  try {
    return admin.app();
  } catch {
    const serviceAccount = require(
      path.join(__dirname, '..', '..', '..', '.firebaseServiceAccountKey.json')
    );
    return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
}

function db() {
  return getApp().firestore();
}

function authClient() {
  return getApp().auth();
}

const MEMBER_ROLE_MANAGER_PROXY = MEMBER_ROLE_MANAGER.proxy;
const RPC_URL = NETWORK_CORE.rpcUrlFallback;
const MEMBER_STATUS_INACTIVE = 1; // MemberRoleManager.sol MemberStatus.Inactive

function getAdminContract(): ethers.Contract {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      'PRIVATE_KEY must be set in .env.local (the contract admin wallet, same key ' +
        'functions/scripts/reregisterUsers.ts uses) for staging cleanup to deactivate ' +
        'on-chain registrations.'
    );
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  return new ethers.Contract(
    MEMBER_ROLE_MANAGER_PROXY,
    ['function setUserStatus(bytes32 userIdHash, uint8 newStatus) external'],
    wallet
  );
}

/** No-op if the uid was never registered on-chain, or is already Inactive. */
async function deactivateOnChain(uid: string): Promise<void> {
  const userIdHash = ethers.id(uid);
  try {
    const tx = await getAdminContract().getFunction('setUserStatus')(
      userIdHash,
      MEMBER_STATUS_INACTIVE
    );
    await tx.wait();
  } catch (err) {
    const message = (err as { message?: string }).message ?? '';
    if (message.includes('User not registered') || message.includes('Already this status')) {
      return;
    }
    throw err;
  }
}

async function createUser(params: CreateAuthUserParams): Promise<void> {
  try {
    await authClient().createUser({
      uid: params.uid,
      email: params.email,
      password: params.password,
      emailVerified: params.emailVerified ?? false,
      displayName: params.displayName ?? params.email,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Idempotent, mirroring the emulator backend's DUPLICATE_LOCAL_ID/EMAIL_EXISTS handling:
    // already existing in the exact state we want is success, not failure.
    if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
      return;
    }
    throw err;
  }
}

// Staging-only, not part of TestBackend — createGuestInvite's response includes guestUid and
// guestPrivateKeyBase64 but not inviteCode (that only ever goes out in the real invite email,
// per functions/src/handlers/createGuestInvite.ts), and the guestInvites doc ID is server-
// generated (db.collection('guestInvites').add(...)), so it can only be found by querying. This
// is a real query (not a known-path get), and recordShareGuestClaim.spec.ts — the only caller —
// is inherently staging-only anyway (its fixture record only exists on belrose-757fe), so there's
// no emulator-side equivalent worth building. Returns docPath too (not just inviteCode) so the
// caller can pass it straight into cleanup()'s docPaths for teardown.
export async function findGuestInvite(
  guestUid: string
): Promise<{ inviteCode: string; docPath: string }> {
  const snap = await db()
    .collection('guestInvites')
    .where('guestUserId', '==', guestUid)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  const inviteCode = doc?.data()?.inviteCode;
  if (!doc || !inviteCode) {
    throw new Error(`No guestInvites doc found for guestUserId=${guestUid}`);
  }
  return { inviteCode, docPath: doc.ref.path };
}

// Staging-only, not part of TestBackend — same rationale as findGuestInvite above. Grant/revoke
// UI flows (usePermissionFlow's confirmGrant/confirmRevoke) fire their PermissionsService call
// without awaiting it: the dialog closes to "Transaction Submitted" optimistically, well before
// the real awaited chain (on-chain grantRole/revokeRole confirmation, THEN the Firestore
// wrappedKeys/viewers write) actually resolves. Polling the real records/{recordId} doc directly
// is the only unambiguous way to know that chain has actually finished — a Sonner success toast
// looked like a cleaner signal but auto-dismisses ~4s after showing, so a slow-to-fire toast can
// already be gone before an assertion starts polling for it.
export async function waitForViewerStatus(
  recordId: string,
  userId: string,
  expected: 'present' | 'absent',
  timeoutMs = 120_000
): Promise<void> {
  return waitForRoleArrayStatus(recordId, userId, 'viewers', expected, timeoutMs);
}

// Generalization of waitForViewerStatus for the other three role arrays — same rationale
// (usePermissionFlow's confirmGrant/confirmRevoke fire their PermissionsService call without
// awaiting it, so polling the real records/{recordId} doc directly is the only unambiguous
// way to know the real on-chain confirmation + Firestore write has actually finished).
export async function waitForRoleArrayStatus(
  recordId: string,
  userId: string,
  field: 'owners' | 'administrators' | 'sharers' | 'viewers',
  expected: 'present' | 'absent',
  timeoutMs = 120_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await db().doc(`records/${recordId}`).get();
    const arr: string[] = snap.data()?.[field] ?? [];
    if (arr.includes(userId) === (expected === 'present')) return;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Timed out waiting for records/${recordId}'s ${field} array to ${
      expected === 'present' ? 'include' : 'exclude'
    } ${userId}`
  );
}

export const stagingBackend: TestBackend = {
  async seedInvite(email) {
    await db()
      .doc(`invites/${email.toLowerCase()}`)
      .set({ approved: true, code: TEST_INVITE_CODE });
  },

  async seedDoc(docPath, data) {
    await db().doc(docPath).set(data);
  },

  async createAuthUser(params) {
    await createUser(params);
  },

  async createGuestAuthUser(uid, email) {
    await createUser({ uid, email, emailVerified: true, displayName: email });
  },

  async verifyEmail(email) {
    const user = await authClient().getUserByEmail(email);
    await authClient().updateUser(user.uid, { emailVerified: true });
  },

  async cleanup(refs: CleanupRefs) {
    const uidsFromEmails = await Promise.all(
      (refs.authEmails ?? []).map(async email => {
        try {
          return (await authClient().getUserByEmail(email)).uid;
        } catch {
          return null;
        }
      })
    );
    const uids = [
      ...(refs.authUids ?? []),
      ...uidsFromEmails.filter((uid): uid is string => uid !== null),
    ];

    await Promise.all((refs.docPaths ?? []).map(p => db().doc(p).delete()));
    await Promise.all(
      (refs.arrayRemovals ?? []).map(({ path, field, value }: ArrayRemoval) =>
        db()
          .doc(path)
          .update({ [field]: admin.firestore.FieldValue.arrayRemove(value) })
      )
    );
    await Promise.all(
      uids.flatMap(uid => [
        deactivateOnChain(uid),
        authClient().deleteUser(uid).catch(() => {}),
        db().doc(`users/${uid}`).delete().catch(() => {}),
      ])
    );
  },
};
