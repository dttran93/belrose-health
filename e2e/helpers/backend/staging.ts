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
import type { TestBackend, CreateAuthUserParams, CleanupRefs } from './types';
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
      uids.flatMap(uid => [
        deactivateOnChain(uid),
        authClient().deleteUser(uid).catch(() => {}),
        db().doc(`users/${uid}`).delete().catch(() => {}),
      ])
    );
  },
};
