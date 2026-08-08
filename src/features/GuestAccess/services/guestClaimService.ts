// src/features/GuestAccess/services/guestClaimService.ts

/**
 * GuestClaimService
 *
 * Converts a temporary guest session into a permanent Belrose account. Extracted from
 * GuestClaimAccountModal.tsx's handleClaim — the modal owns form/step state and progress
 * display, this owns the orchestration and throws on failure (never touches React state or
 * toasts directly).
 *
 * Write strategy:
 *   - Step 1a (sharing file key rewrap) — in batch with profile/invites/backfill
 *     because these all belong to the same "account is now real" transaction. Sourced from
 *     EncryptionKeyManager.getGuestFileKeys()'s in-memory map — the ONLY safe source for
 *     sharing-context guests: their RSA private key is never persisted anywhere after
 *     GuestInvitePage's one-time unwrap, so this can't be redone from a fresh query the way
 *     Step 1c can (see Step 1c below).
 *   - Step 1b (request note key rewrap) — standalone updateDoc outside batch.
 *     Fails intermittently in batch context, likely due to auth token state
 *     after updatePassword. Non-fatal: provider loses note decrypt if it fails,
 *     but record access and fulfillment are unaffected.
 *   - Step 1c (uploaded record key rewrap) — standalone updateDoc outside batch, query-based
 *     rather than caller-supplied record IDs: queries wrappedKeys where userId == guestUid &&
 *     isCreator == true (rules-permitted — firestore.rules' wrappedKeys `allow list` has a bare
 *     resource.data.userId == request.auth.uid branch, provable from the query's own filter).
 *     Safe to redo from scratch, unlike Step 1a, because the throwaway AES master key used to
 *     encrypt these file keys persists for the whole guest session via
 *     EncryptionKeyManager.getSessionKey() — if the session was interrupted between upload and
 *     claim (tab close, re-login, etc.), that key is gone and the rewrap cannot be completed.
 *     The record itself still exists in Firestore — the guest just loses decrypt access after
 *     claiming. Best-effort, non-fatal — surfaced via the returned skippedRecordCount, which the
 *     caller turns into a toast.
 *   - Steps 2/2b (user profile, targetUserId backfill) — in batch.
 *     These must succeed or fail atomically: a half-claimed state where isGuest
 *     is false but encryption keys aren't saved would break decryption.
 *   - Step 3 (wallet generation + on-chain registration) — best-effort, tracked via
 *     BlockchainSyncQueueService, does not block the claim from completing. Guests never touch
 *     the blockchain themselves while still a guest — deliberately kept off-chain entirely
 *     (simpler model: the blockchain is for real accounts only, and a guest's on-chain presence
 *     would either need Belrose-custodied key material or be permanently unrecoverable if they
 *     never claim). This step is the first time a *real* on-chain identity gets created for what
 *     is, by this point, already a real (non-guest) account — same as registration/dependent
 *     account creation elsewhere. A failure here doesn't block the claim; it gets picked up by
 *     reconciliation like every other best-effort blockchain write in the app.
 *   - Step 4 (password update) — via Cloud Function (guestPasswordUpdate).
 *     Uses Admin SDK to bypass Firebase's 5-minute recent-login requirement,
 *     which guests routinely exceed. Invalidates the auth token, so refreshUser()
 *     is called immediately after before any further Firebase client calls.
 *   - Step 5 (mark guestInvites accepted) — separate batch AFTER Cloud Function.
 *     The CF guards on guestInvites.status == 'pending', so this must commit
 *     only after the password update succeeds. Intentionally not atomic with
 *     the profile batch — a failed invite mark is non-fatal since the account
 *     is already fully claimed at that point.
 */

import { getAuth, signInWithCustomToken, updateProfile } from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getFirestore,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { EncryptionService } from '@/features/Encryption/services/encryptionService';
import { SharingKeyManagementService } from '@/features/Sharing/services/sharingKeyManagementService';
import {
  AccountEncryptionService,
  EncryptionBootstrapBundle,
} from '@/features/Auth/services/accountEncryptionService';
import {
  BlockchainSyncQueueService,
  getUserFacingErrorMessage,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/utils/dataFormattingUtils';

export interface GuestClaimParams {
  guestUid: string;
  guestEmail: string | null;
  firstName: string;
  lastName: string;
  password: string;
  guestContext?: 'sharing' | 'record_request';
  cryptoData: EncryptionBootstrapBundle;
  /** AuthContext's refreshUser — passed in explicitly since the service isn't a React hook. */
  refreshUser: () => Promise<void>;
}

export interface GuestClaimResult {
  skippedRecordCount: number;
}

export type GuestClaimProgressCallback = (message: string) => void;

export class GuestClaimService {
  static async claimAccount(
    params: GuestClaimParams,
    onProgress?: GuestClaimProgressCallback
  ): Promise<GuestClaimResult> {
    const { guestUid, guestEmail, firstName, lastName, password, guestContext, cryptoData, refreshUser } =
      params;

    const db = getFirestore();
    const batch = writeBatch(db);
    const guestFileKeys = EncryptionKeyManager.getGuestFileKeys();

    const shouldCheckKeys = guestContext !== 'record_request';
    const hasKeys = guestFileKeys !== null && guestFileKeys.size > 0;

    if (shouldCheckKeys && !hasKeys) {
      throw new Error('Your session has expired. Please click the invite link again.');
    }

    const newRsaPublicKey = await SharingKeyManagementService.importPublicKey(
      cryptoData.publicKey
    );

    // ===========================================================================================
    // Step 1 - Rewrap guest keys for record access, request notes, and uploaded records
    // ===========================================================================================

    // ── Step 1a: Rewrap guest file keys (Sharing Flow) ────────────────────
    // In batch — these belong to the same atomic "account is now real" write
    // as the user profile update below.
    if (hasKeys) {
      onProgress?.('Re-encrypting record access keys...');
      for (const [recordId, fileKey] of guestFileKeys!) {
        const docId = `${recordId}_${guestUid}`;
        const rewrapped = await SharingKeyManagementService.wrapKey(fileKey, newRsaPublicKey);
        batch.update(doc(db, 'wrappedKeys', docId), {
          wrappedKey: rewrapped,
          isCreator: false,
          isGuest: false,
          expiresAt: deleteField(),
          claimedAt: serverTimestamp(),
        });
      }
    }

    // ── Step 1b: Rewrap request note key (Request Flow) ───────────────────
    // Standalone updateDoc — fails intermittently when run inside a batch,
    // likely due to auth token state changes after updatePassword in step 2.
    // Non-fatal: provider loses note decrypt access if this fails, but record
    // access and request fulfillment are unaffected.
    const guestPrivateKeyBase64 = EncryptionKeyManager.getGuestRsaPrivateKey();

    if (guestPrivateKeyBase64) {
      onProgress?.('Re-encrypting request note access...');
      try {
        const guestRsaPrivateKey =
          await SharingKeyManagementService.importPrivateKey(guestPrivateKeyBase64);

        const requestSnap = await getDocs(
          query(collection(db, 'recordRequests'), where('providerGuestUid', '==', guestUid))
        );

        for (const requestDoc of requestSnap.docs) {
          const data = requestDoc.data();
          if (!data.encryptedNoteKeyForProvider || !data.encryptedNoteIv) continue;

          const aesNoteKey = await SharingKeyManagementService.unwrapKey(
            data.encryptedNoteKeyForProvider,
            guestRsaPrivateKey
          );
          const rewrappedNoteKey = await SharingKeyManagementService.wrapKey(
            aesNoteKey,
            newRsaPublicKey
          );

          await updateDoc(doc(db, 'recordRequests', requestDoc.id), {
            encryptedNoteKeyForProvider: rewrappedNoteKey,
          });
        }
      } catch (err) {
        console.warn('⚠️ Step 1b: failed to rewrap note key — provider loses note access', err);
      }
    }

    // ── Step 1c: Rewrap uploaded record keys (Upload Blocker Flow) ────────
    // Standalone updateDoc — best-effort. Query-based (not a caller-supplied record ID list) —
    // safe to redo from scratch because the throwaway AES master key used to encrypt these file
    // keys persists for the whole guest session. If the session was interrupted between upload
    // and claim (tab close, re-login, etc.), the key is gone and the rewrap cannot be completed.
    // The record itself still exists in Firestore — the guest just loses decrypt access after
    // claiming. The caller surfaces skippedRecordCount as a toast warning to re-upload if needed.
    let skippedRecordCount = 0;

    const uploadedKeysSnap = await getDocs(
      query(
        collection(db, 'wrappedKeys'),
        where('userId', '==', guestUid),
        where('isCreator', '==', true)
      )
    );

    if (uploadedKeysSnap.docs.length > 0) {
      onProgress?.('Securing your uploaded records...');
      const throwawayKey = await EncryptionKeyManager.getSessionKey();

      if (!throwawayKey) {
        console.warn('⚠️ Throwaway key gone — skipping step 1c entirely');
        skippedRecordCount = uploadedKeysSnap.docs.length;
      } else {
        for (const wrappedKeyDoc of uploadedKeysSnap.docs) {
          try {
            const encryptedKeyData = base64ToArrayBuffer(wrappedKeyDoc.data().wrappedKey);
            const fileKeyData = await EncryptionService.decryptKeyWithMasterKey(
              encryptedKeyData,
              throwawayKey
            );
            const fileKey = await EncryptionService.importKey(fileKeyData);
            const rewrapped = await EncryptionService.encryptKeyWithMasterKey(
              fileKey,
              cryptoData.masterKey
            );

            await updateDoc(wrappedKeyDoc.ref, {
              wrappedKey: arrayBufferToBase64(rewrapped),
              claimedAt: serverTimestamp(),
            });
            console.log('✅ Step 1c write ok:', wrappedKeyDoc.id);
          } catch (e) {
            console.warn(`⚠️ Step 1c skipped for ${wrappedKeyDoc.id}`, e);
            skippedRecordCount++;
          }
        }
      }
    }

    // ── Step 2: Update user profile (in batch) ────────────────────────────
    onProgress?.('Saving your account details...');
    const displayName = `${firstName} ${lastName}`;

    batch.update(doc(db, 'users', guestUid), {
      displayName,
      displayNameLower: displayName.toLowerCase(),
      firstName,
      lastName,
      isGuest: false,
      emailVerified: true,
      emailVerifiedAt: serverTimestamp(),
      identityVerified: false,
      identityVerifiedAt: null,
      updatedAt: serverTimestamp(),
      encryption: {
        enabled: true,
        encryptedMasterKey: cryptoData.encryptedMasterKey,
        masterKeyIV: cryptoData.masterKeyIV,
        masterKeySalt: cryptoData.masterKeySalt,
        recoveryKeyHash: cryptoData.recoveryKeyHash,
        publicKey: cryptoData.publicKey,
        encryptedPrivateKey: cryptoData.encryptedPrivateKey,
        encryptedPrivateKeyIV: cryptoData.encryptedPrivateKeyIV,
        setupAt: new Date().toISOString(),
      },
    });

    // ── Step 2b: Backfill targetUserId on recordRequests (in batch) ───────
    // useInboundRequests queries by both userId and email, but setting
    // targetUserId ensures future queries by ID alone still find them.
    const backfillSnap = await getDocs(
      query(
        collection(db, 'recordRequests'),
        where('targetEmail', '==', guestEmail),
        where('status', 'in', ['pending', 'fulfilled'])
      )
    );

    backfillSnap.docs.forEach(requestDoc => {
      batch.update(requestDoc.ref, { targetUserId: guestUid });
    });

    // ── Commit atomic writes ──────────────────────────────────────────────
    onProgress?.('Saving changes...');
    await batch.commit();

    // ── Step 3: Generate wallet + register on blockchain — best-effort, tracked via
    // BlockchainSyncQueueService, does not block the claim from completing. Guests never touch
    // the blockchain themselves (see the design discussion in this file's header) — this is the
    // first and only on-chain registration for what is, as of this write, already a real
    // (non-guest) account. A failure here just means the wallet gets picked up later by
    // reconciliation, same as every other blockchain write in the app.
    onProgress?.('Generating your distributed network account...');
    const syncRef = await BlockchainSyncQueueService.startAttempt({
      contract: 'MemberRoleManager',
      action: 'registerMemberOnChainComplete',
      userId: guestUid,
      context: { type: 'memberRegistry', newStatus: 'Active' },
    });
    try {
      const registrationResult = await AccountEncryptionService.registerWalletOnChain(
        cryptoData.masterKey
      );
      await BlockchainSyncQueueService.recordSuccess(syncRef, {
        txHash: registrationResult.blockchainRef.txHash,
        blockNumber: registrationResult.blockchainRef.blockNumber,
      });
    } catch (err) {
      const errorMessage = getUserFacingErrorMessage(err, 'Blockchain transaction failed');
      await BlockchainSyncQueueService.recordFailure(syncRef, errorMessage);
    }

    // Set real master key in session
    EncryptionKeyManager.setSessionKey(cryptoData.masterKey);

    // ── Step 4: Set password on Firebase Auth account ────────────────────
    // Cloud function to more securely handle passwords for guest accounts which are likely to hit 5 minute limit for firebase
    onProgress?.('Securing your account...');
    try {
      const updatePasswordFn = httpsCallable(getFunctions(), 'guestPasswordUpdate');
      const result = await updatePasswordFn({ newPassword: password });
      const { customToken } = result.data as { customToken: string };
      await signInWithCustomToken(getAuth(), customToken);
    } catch (err: any) {
      if (err.code === 'auth/requires-recent-login') {
        throw new Error(
          'Your session has expired. Please click the invite link again to refresh your session.'
        );
      }
      throw err;
    }

    // ── Step 5: Mark guestInvites as accepted (in batch) ──────────────────
    // Has to come after password change, because cloud function checks for guestInvite with status pending
    const inviteSnap = await getDocs(
      query(
        collection(db, 'guestInvites'),
        where('guestUserId', '==', guestUid),
        where('status', '==', 'pending')
      )
    );

    const inviteBatch = writeBatch(db);
    inviteSnap.docs.forEach(inviteDoc => {
      inviteBatch.update(inviteDoc.ref, {
        status: 'accepted',
        claimedAt: serverTimestamp(),
      });
    });
    await inviteBatch.commit();

    // ── Step 6: Clear guest keys from memory ─────────────────────────────
    EncryptionKeyManager.setGuestFileKeys(new Map());

    // ── Step 7: Refresh auth context so banner disappears ───────────────────
    onProgress?.('Finalizing...');

    try {
      await getAuth().currentUser?.getIdToken(true);
      await refreshUser();
      await updateProfile(getAuth().currentUser!, { displayName });
    } catch (err) {
      console.warn('⚠️ Post-claim refresh failed — account was created successfully', err);
    }

    return { skippedRecordCount };
  }
}
