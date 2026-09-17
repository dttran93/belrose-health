// functions/src/chainIndexer/healthRecordCoreReconciliationRules.ts
//
// Firestore-read-only predicates for HealthRecordCore.sol's events — mirrors
// memberRoleManagerReconciliationRules.ts's exact conventions for the second contract this
// indexer covers. AdminTransferred (HRC Slice 1) skips this file entirely — see
// healthRecordCoreReconciliationService.ts's own comment for why. HRC Slice 2 adds the
// subject-anchoring family; HRC Slice 3 adds the hash-versioning family; HRC Slice 4 adds the
// verification family; HRC Slice 5 adds the dispute family (structurally identical to Slice 4's
// verification family — reuses its design rather than re-deriving it). HRC Slice 6 (final slice)
// adds the unaccepted flags family — the cleanest match case on the contract, fully direct hashes.

import type { Firestore } from 'firebase-admin/firestore';

export interface SubjectHistoryEventMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'records/{recordId}/subjectHistory/{eventId}'
}

interface SubjectHistoryEntry {
  action?: string;
}

/**
 * Shared query + predicate-matching shell for RecordAnchored/RecordUnanchored. reanchorRecord
 * (#816) emits RecordAnchored rather than a separate RecordReanchored event — a reanchor is
 * indistinguishable from an anchor once you're only looking at end state — so
 * findMatchingSubjectHistoryForAnchoredEvent below handles both cases already; there is no
 * separate reanchor match rule.
 * subjectHistory (records/{recordId}/subjectHistory) already stores recordIdHash/subjectIdHash
 * directly on each entry (packages/shared/src/subject.ts's SubjectHistoryEvent), so both can be
 * filtered server-side via a collectionGroup query — no in-memory hash recomputation needed, just
 * the predicate check per event type. No firestore.rules/index change needed: this runs entirely
 * through the Admin SDK (bypasses rules unconditionally), and it's a two-equality-filter query —
 * the same shape already proven index-free by every other collectionGroup match rule in this
 * indexer (e.g. memberRoleManagerReconciliationRules.ts's findMatchingTrusteeHistory).
 */
async function findMatchingSubjectHistory(
  db: Firestore,
  recordIdHash: string,
  subjectIdHash: string,
  predicate: (entry: SubjectHistoryEntry) => boolean
): Promise<SubjectHistoryEventMatchResult> {
  const snap = await db
    .collectionGroup('subjectHistory')
    .where('recordIdHash', '==', recordIdHash)
    .where('subjectIdHash', '==', subjectIdHash)
    .get();

  for (const doc of snap.docs) {
    if (predicate(doc.data() as SubjectHistoryEntry)) {
      return { matched: true, matchedFirestoreRef: doc.ref.path };
    }
  }

  return { matched: false, matchedFirestoreRef: null };
}

/**
 * RecordAnchored match rule. anchorRecord's on-chain event never distinguishes a self-anchor from
 * a controller-anchor — the emitted subjectIdHash is the same either way (HealthRecordCore.sol's
 * anchorRecord always emits `resolvedSubject`, whichever code path resolved it) — but Firestore
 * records two different actions for the two cases ('anchored' vs 'anchored_as_controller'). This
 * must accept either; requiring one specifically would produce a false "no match" for every
 * controller-anchored subject.
 */
export async function findMatchingSubjectHistoryForAnchoredEvent(
  db: Firestore,
  args: { recordIdHash: string; subjectIdHash: string }
): Promise<SubjectHistoryEventMatchResult> {
  return findMatchingSubjectHistory(
    db,
    args.recordIdHash,
    args.subjectIdHash,
    entry => entry.action === 'anchored' || entry.action === 'anchored_as_controller'
  );
}

export async function findMatchingSubjectHistoryForUnanchoredEvent(
  db: Firestore,
  args: { recordIdHash: string; subjectIdHash: string }
): Promise<SubjectHistoryEventMatchResult> {
  return findMatchingSubjectHistory(db, args.recordIdHash, args.subjectIdHash, entry => entry.action === 'unanchored');
}

// ============================================================================
// RecordHashAdded / RecordHashRetracted (HRC Slice 3)
// ============================================================================

export interface RecordHashHistoryMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'records/{recordId}/recordHashHistory/{eventId}'
}

interface RecordHashHistoryEntry {
  hash?: string;
  action?: string;
  changedByIdHash?: string;
}

/**
 * RecordHashAdded match rule. Adds a changedByIdHash === addedBy identity check — safe here
 * (unlike RoleGranted's deliberately excluded check) because addRecordHash has no admin/
 * bytes32(0) stand-in path; addedBy is always the real caller's own hash
 * (HealthRecordCore.sol:338/344).
 */
export async function findMatchingRecordHashHistoryForAddedEvent(
  db: Firestore,
  args: { recordIdHash: string; newHash: string; addedBy: string }
): Promise<RecordHashHistoryMatchResult> {
  const snap = await db.collectionGroup('recordHashHistory').where('recordIdHash', '==', args.recordIdHash).get();
  const addedByLower = args.addedBy.toLowerCase();

  for (const doc of snap.docs) {
    const data = doc.data() as RecordHashHistoryEntry;
    if (
      data.hash === args.newHash &&
      data.action === 'anchored' &&
      typeof data.changedByIdHash === 'string' &&
      data.changedByIdHash.toLowerCase() === addedByLower
    ) {
      return { matched: true, matchedFirestoreRef: doc.ref.path };
    }
  }

  return { matched: false, matchedFirestoreRef: null };
}

/**
 * RecordHashRetracted match rule — built correctly but structurally unmatchable today:
 * RecordHashHistoryAction (packages/shared/src/recordHash.ts) only has 'anchored'; there is no
 * 'retracted' value because retractRecordHash is never called from the frontend (per that file's
 * own doc comment). Ships anyway as a structurally correct rule that legitimately never matches —
 * same precedent as MemberRoleManager's findMatchingPermissionHistoryForRoleEvent handling the
 * initializeRecordRole bytes32(0) wrinkle. Known gap, separate ticket if the underlying app gap is
 * ever worth closing.
 */
export async function findMatchingRecordHashHistoryForRetractedEvent(
  db: Firestore,
  args: { recordIdHash: string; recordHash: string }
): Promise<RecordHashHistoryMatchResult> {
  const snap = await db.collectionGroup('recordHashHistory').where('recordIdHash', '==', args.recordIdHash).get();

  for (const doc of snap.docs) {
    const data = doc.data() as RecordHashHistoryEntry;
    if (data.hash === args.recordHash && data.action === 'retracted') {
      return { matched: true, matchedFirestoreRef: doc.ref.path };
    }
  }

  return { matched: false, matchedFirestoreRef: null };
}

// ============================================================================
// RecordVerified / VerificationRetracted / VerificationLevelModified (HRC Slice 4)
// ============================================================================

export interface VerificationEventMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'verifications/{recordHash}_{verifierId}'
}

interface VerificationOnChainHistoryEntry {
  action?: string;
}

/**
 * Shared query + predicate-matching shell for all three verification events. `verifications` is a
 * flat top-level collection (verificationService.ts's getVerificationId: `{recordHash}_{verifierId}`)
 * that already stores recordHash/verifierIdHash directly on the doc — a plain two-field equality
 * query, the same shape as memberRoleManagerReconciliationRules.ts's findMatchingVouch, not
 * RoleGranted's collectionGroup-scan-plus-recompute shape.
 *
 * recordIdHash is deliberately excluded from the match key: VerificationDoc declares the field on
 * its TS type, but verificationService.ts's actual setDoc/updateDoc calls never write it (confirmed
 * by reading the real write sites — zero references) — same exclusion precedent as RoleGranted's
 * deliberately-excluded userIdHash, for the same reason: an unreliable field.
 */
async function findMatchingVerification(
  db: Firestore,
  recordHash: string,
  verifierIdHash: string,
  predicate: (entry: VerificationOnChainHistoryEntry) => boolean
): Promise<VerificationEventMatchResult> {
  const snap = await db
    .collection('verifications')
    .where('recordHash', '==', recordHash)
    .where('verifierIdHash', '==', verifierIdHash)
    .limit(1)
    .get();

  if (snap.empty) return { matched: false, matchedFirestoreRef: null };

  const doc = snap.docs[0];
  const history: VerificationOnChainHistoryEntry[] = doc.data().onChainHistory ?? [];
  const matched = history.some(predicate);
  return { matched, matchedFirestoreRef: matched ? doc.ref.path : null };
}

/**
 * RecordVerified match rule. Matches on "some verified/re-verified... entry exists" rather than
 * correlating the exact level of this specific call — same looseness precedent as
 * TrusteeLevelUpdated/TrusteeProposed (level is a soft signal, not a match gate).
 */
export async function findMatchingVerificationForVerifiedEvent(
  db: Firestore,
  args: { recordHash: string; verifierIdHash: string }
): Promise<VerificationEventMatchResult> {
  return findMatchingVerification(db, args.recordHash, args.verifierIdHash, entry => entry.action === 'verified');
}

export async function findMatchingVerificationForRetractedEvent(
  db: Firestore,
  args: { recordHash: string; verifierIdHash: string }
): Promise<VerificationEventMatchResult> {
  return findMatchingVerification(db, args.recordHash, args.verifierIdHash, entry => entry.action === 'retracted');
}

export async function findMatchingVerificationForLevelModifiedEvent(
  db: Firestore,
  args: { recordHash: string; verifierIdHash: string }
): Promise<VerificationEventMatchResult> {
  return findMatchingVerification(db, args.recordHash, args.verifierIdHash, entry => entry.action === 'modified');
}

// ============================================================================
// RecordDisputed / DisputeRetracted / DisputeModification (HRC Slice 5)
// ============================================================================

export interface DisputeEventMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'disputes/{recordHash}_{disputerId}'
}

interface DisputeOnChainHistoryEntry {
  action?: string;
}

/**
 * Shared query + predicate-matching shell for all three dispute events. Structurally identical to
 * findMatchingVerification (Slice 4) — `disputes` is a flat top-level collection
 * (disputeService.ts's getDisputeId: `{recordHash}_{disputerId}`) that already stores
 * recordHash/disputerIdHash directly, a plain two-field equality query. recordIdHash is
 * deliberately excluded from the match key for the same reason as RecordVerified's: DisputeDoc
 * declares the field on its TS type, but disputeService.ts's actual write calls never write it
 * (confirmed by reading the real write sites — zero references).
 */
async function findMatchingDispute(
  db: Firestore,
  recordHash: string,
  disputerIdHash: string,
  predicate: (entry: DisputeOnChainHistoryEntry) => boolean
): Promise<DisputeEventMatchResult> {
  const snap = await db
    .collection('disputes')
    .where('recordHash', '==', recordHash)
    .where('disputerIdHash', '==', disputerIdHash)
    .limit(1)
    .get();

  if (snap.empty) return { matched: false, matchedFirestoreRef: null };

  const doc = snap.docs[0];
  const history: DisputeOnChainHistoryEntry[] = doc.data().onChainHistory ?? [];
  const matched = history.some(predicate);
  return { matched, matchedFirestoreRef: matched ? doc.ref.path : null };
}

/**
 * RecordDisputed match rule. Matches on "some disputed entry exists" rather than correlating the
 * exact severity/culpability of this specific call — same looseness precedent as
 * RecordVerified/TrusteeLevelUpdated.
 */
export async function findMatchingDisputeForDisputedEvent(
  db: Firestore,
  args: { recordHash: string; disputerIdHash: string }
): Promise<DisputeEventMatchResult> {
  return findMatchingDispute(db, args.recordHash, args.disputerIdHash, entry => entry.action === 'disputed');
}

export async function findMatchingDisputeForRetractedEvent(
  db: Firestore,
  args: { recordHash: string; disputerIdHash: string }
): Promise<DisputeEventMatchResult> {
  return findMatchingDispute(db, args.recordHash, args.disputerIdHash, entry => entry.action === 'retracted');
}

export async function findMatchingDisputeForModificationEvent(
  db: Firestore,
  args: { recordHash: string; disputerIdHash: string }
): Promise<DisputeEventMatchResult> {
  return findMatchingDispute(db, args.recordHash, args.disputerIdHash, entry => entry.action === 'modified');
}

// ============================================================================
// UnacceptedUpdateFlagged / UnacceptedUpdateFlagRevoked (HRC Slice 6)
// ============================================================================

export interface UnacceptedFlagMatchResult {
  matched: boolean;
  matchedFirestoreRef: string | null; // e.g. 'unacceptedFlags/{subjectId}_{recordId}'
}

interface UnacceptedFlagOnChainHistoryEntry {
  action?: string;
}

/**
 * Shared query + predicate-matching shell for both unaccepted-flag events. The cleanest match
 * case on this whole contract: functions/src/handlers/unacceptedFlags.ts writes subjectIdHash,
 * recordIdHash, and reporterIdHash all as real hashes directly on the flat top-level
 * `unacceptedFlags` doc (id `{subjectId}_{recordId}`) at creation time — a plain three-field
 * equality query, no in-memory recomputation and no exclusions needed (unlike RecordVerified/
 * RecordDisputed's recordIdHash situation).
 */
async function findMatchingUnacceptedFlag(
  db: Firestore,
  subjectIdHash: string,
  recordIdHash: string,
  reporterIdHash: string,
  predicate: (entry: UnacceptedFlagOnChainHistoryEntry) => boolean
): Promise<UnacceptedFlagMatchResult> {
  const snap = await db
    .collection('unacceptedFlags')
    .where('subjectIdHash', '==', subjectIdHash)
    .where('recordIdHash', '==', recordIdHash)
    .where('reporterIdHash', '==', reporterIdHash)
    .limit(1)
    .get();

  if (snap.empty) return { matched: false, matchedFirestoreRef: null };

  const doc = snap.docs[0];
  const history: UnacceptedFlagOnChainHistoryEntry[] = doc.data().onChainHistory ?? [];
  const matched = history.some(predicate);
  return { matched, matchedFirestoreRef: matched ? doc.ref.path : null };
}

export async function findMatchingUnacceptedFlagForFlaggedEvent(
  db: Firestore,
  args: { subjectIdHash: string; recordIdHash: string; reporterIdHash: string }
): Promise<UnacceptedFlagMatchResult> {
  return findMatchingUnacceptedFlag(
    db,
    args.subjectIdHash,
    args.recordIdHash,
    args.reporterIdHash,
    entry => entry.action === 'flagged'
  );
}

export async function findMatchingUnacceptedFlagForRevokedEvent(
  db: Firestore,
  args: { subjectIdHash: string; recordIdHash: string; reporterIdHash: string }
): Promise<UnacceptedFlagMatchResult> {
  return findMatchingUnacceptedFlag(
    db,
    args.subjectIdHash,
    args.recordIdHash,
    args.reporterIdHash,
    entry => entry.action === 'revoked'
  );
}
