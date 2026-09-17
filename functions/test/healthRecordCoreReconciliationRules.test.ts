// functions/test/healthRecordCoreReconciliationRules.test.ts
//
// Pure unit tests for HealthRecordCore's reconciliation predicates — mirrors
// memberRoleManagerReconciliationRules.test.ts's exact fake-Firestore harness. No Firestore
// emulator involved. The emulator-backed end-to-end path is covered separately in
// healthRecordCoreEventIndexer.test.ts.

import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  findMatchingSubjectHistoryForAnchoredEvent,
  findMatchingSubjectHistoryForUnanchoredEvent,
  findMatchingRecordHashHistoryForAddedEvent,
  findMatchingRecordHashHistoryForRetractedEvent,
  findMatchingVerificationForVerifiedEvent,
  findMatchingVerificationForRetractedEvent,
  findMatchingVerificationForLevelModifiedEvent,
  findMatchingDisputeForDisputedEvent,
  findMatchingDisputeForRetractedEvent,
  findMatchingDisputeForModificationEvent,
  findMatchingUnacceptedFlagForFlaggedEvent,
  findMatchingUnacceptedFlagForRevokedEvent,
} from '../src/chainIndexer/healthRecordCoreReconciliationRules';

interface FakeDoc {
  id: string;
  path?: string;
  data: Record<string, unknown>;
}

function makeFakeQuery(initialDocs: FakeDoc[]) {
  let docs = initialDocs;
  const query = {
    where(field: string, op: string, value: unknown) {
      docs = docs.filter(d => {
        const fieldValue = field.split('.').reduce<unknown>((obj, key) => (obj as any)?.[key], d.data);
        return op === '==' ? fieldValue === value : true;
      });
      return query;
    },
    limit() {
      return query;
    },
    async get() {
      return {
        empty: docs.length === 0,
        docs: docs.map(d => ({ id: d.id, data: () => d.data, ref: { path: d.path ?? d.id } })),
      };
    },
  };
  return query;
}

function fakeFirestore(
  collections: Record<string, FakeDoc[]>,
  collectionGroups: Record<string, FakeDoc[]> = {}
): Firestore {
  const db = {
    collection: (name: string) => makeFakeQuery(collections[name] ?? []),
    collectionGroup: (name: string) => makeFakeQuery(collectionGroups[name] ?? []),
  };
  return db as unknown as Firestore;
}

describe('subject history match rules', () => {
  const recordIdHash = '0xRecordIdHash1';
  const subjectIdHash = '0xSubjectIdHash1';

  describe('findMatchingSubjectHistoryForAnchoredEvent', () => {
    it('matches an "anchored" entry', async () => {
      const db = fakeFirestore(
        {},
        {
          subjectHistory: [
            { id: 'event-1', path: 'records/rec-1/subjectHistory/event-1', data: { recordIdHash, subjectIdHash, action: 'anchored' } },
          ],
        }
      );

      await expect(findMatchingSubjectHistoryForAnchoredEvent(db, { recordIdHash, subjectIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'records/rec-1/subjectHistory/event-1',
      });
    });

    it('matches an "anchored_as_controller" entry too — the on-chain event never distinguishes the two', async () => {
      const db = fakeFirestore(
        {},
        {
          subjectHistory: [
            {
              id: 'event-1',
              path: 'records/rec-1/subjectHistory/event-1',
              data: { recordIdHash, subjectIdHash, action: 'anchored_as_controller' },
            },
          ],
        }
      );

      await expect(findMatchingSubjectHistoryForAnchoredEvent(db, { recordIdHash, subjectIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'records/rec-1/subjectHistory/event-1',
      });
    });

    it('does not match an "unanchored" entry for the same pair', async () => {
      const db = fakeFirestore(
        {},
        { subjectHistory: [{ id: 'event-1', path: 'p', data: { recordIdHash, subjectIdHash, action: 'unanchored' } }] }
      );

      await expect(findMatchingSubjectHistoryForAnchoredEvent(db, { recordIdHash, subjectIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });

    it('does not match when no subjectHistory doc exists for this pair at all', async () => {
      const db = fakeFirestore({}, { subjectHistory: [] });
      await expect(findMatchingSubjectHistoryForAnchoredEvent(db, { recordIdHash, subjectIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingSubjectHistoryForUnanchoredEvent', () => {
    it('matches an "unanchored" entry', async () => {
      const db = fakeFirestore(
        {},
        { subjectHistory: [{ id: 'event-1', path: 'records/rec-1/subjectHistory/event-1', data: { recordIdHash, subjectIdHash, action: 'unanchored' } }] }
      );

      await expect(findMatchingSubjectHistoryForUnanchoredEvent(db, { recordIdHash, subjectIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'records/rec-1/subjectHistory/event-1',
      });
    });

    it('does not match an "anchored" entry', async () => {
      const db = fakeFirestore(
        {},
        { subjectHistory: [{ id: 'event-1', path: 'p', data: { recordIdHash, subjectIdHash, action: 'anchored' } }] }
      );

      await expect(findMatchingSubjectHistoryForUnanchoredEvent(db, { recordIdHash, subjectIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  // reanchorRecord (#816) emits RecordAnchored, not a separate event, so a reanchor is covered
  // by findMatchingSubjectHistoryForAnchoredEvent's own tests above — no dedicated reanchor rule.
});

describe('record hash history match rules', () => {
  const recordIdHash = '0xRecordIdHash1';

  describe('findMatchingRecordHashHistoryForAddedEvent', () => {
    it('matches an "anchored" entry with the same hash and changedByIdHash === addedBy', async () => {
      const addedBy = '0xAddedByHash1';
      const db = fakeFirestore(
        {},
        {
          recordHashHistory: [
            {
              id: 'event-1',
              path: 'records/rec-1/recordHashHistory/event-1',
              data: { recordIdHash, hash: '0xNewHash1', action: 'anchored', changedByIdHash: addedBy },
            },
          ],
        }
      );

      await expect(
        findMatchingRecordHashHistoryForAddedEvent(db, { recordIdHash, newHash: '0xNewHash1', addedBy })
      ).resolves.toEqual({ matched: true, matchedFirestoreRef: 'records/rec-1/recordHashHistory/event-1' });
    });

    it('does not match when changedByIdHash differs from addedBy', async () => {
      const db = fakeFirestore(
        {},
        {
          recordHashHistory: [
            { id: 'event-1', path: 'p', data: { recordIdHash, hash: '0xNewHash1', action: 'anchored', changedByIdHash: '0xSomeoneElseHash' } },
          ],
        }
      );

      await expect(
        findMatchingRecordHashHistoryForAddedEvent(db, { recordIdHash, newHash: '0xNewHash1', addedBy: '0xAddedByHash1' })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });

    it('does not match a different hash value for the same recordIdHash', async () => {
      const addedBy = '0xAddedByHash1';
      const db = fakeFirestore(
        {},
        { recordHashHistory: [{ id: 'event-1', path: 'p', data: { recordIdHash, hash: '0xADifferentHash', action: 'anchored', changedByIdHash: addedBy } }] }
      );

      await expect(
        findMatchingRecordHashHistoryForAddedEvent(db, { recordIdHash, newHash: '0xNewHash1', addedBy })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });

    it('does not match when no recordHashHistory doc exists for this recordIdHash at all', async () => {
      const db = fakeFirestore({}, { recordHashHistory: [] });
      await expect(
        findMatchingRecordHashHistoryForAddedEvent(db, { recordIdHash, newHash: '0xNewHash1', addedBy: '0xAddedByHash1' })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });
  });

  describe('findMatchingRecordHashHistoryForRetractedEvent', () => {
    it('never matches today — RecordHashHistoryAction only has \'anchored\' (known gap)', async () => {
      const db = fakeFirestore(
        {},
        { recordHashHistory: [{ id: 'event-1', path: 'p', data: { recordIdHash, hash: '0xRecordHash1', action: 'anchored' } }] }
      );

      await expect(
        findMatchingRecordHashHistoryForRetractedEvent(db, { recordIdHash, recordHash: '0xRecordHash1' })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });

    it('would match if a "retracted" entry existed — the rule itself is structurally correct', async () => {
      const db = fakeFirestore(
        {},
        { recordHashHistory: [{ id: 'event-1', path: 'records/rec-1/recordHashHistory/event-1', data: { recordIdHash, hash: '0xRecordHash1', action: 'retracted' } }] }
      );

      await expect(
        findMatchingRecordHashHistoryForRetractedEvent(db, { recordIdHash, recordHash: '0xRecordHash1' })
      ).resolves.toEqual({ matched: true, matchedFirestoreRef: 'records/rec-1/recordHashHistory/event-1' });
    });
  });
});

describe('verification match rules', () => {
  const recordHash = '0xRecordHash1';
  const verifierIdHash = '0xVerifierIdHash1';

  describe('findMatchingVerificationForVerifiedEvent', () => {
    it('matches a "verified" entry in onChainHistory', async () => {
      const db = fakeFirestore({
        verifications: [
          { id: `${recordHash}_verifier-uid`, data: { recordHash, verifierIdHash, onChainHistory: [{ action: 'verified' }] } },
        ],
      });

      await expect(findMatchingVerificationForVerifiedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: `${recordHash}_verifier-uid`,
      });
    });

    it('does not match when the doc exists but has no "verified" entry', async () => {
      const db = fakeFirestore({
        verifications: [{ id: 'v-1', data: { recordHash, verifierIdHash, onChainHistory: [{ action: 'retracted' }] } }],
      });

      await expect(findMatchingVerificationForVerifiedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });

    it('does not match when no verifications doc exists for this pair at all', async () => {
      const db = fakeFirestore({ verifications: [] });
      await expect(findMatchingVerificationForVerifiedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingVerificationForRetractedEvent', () => {
    it('matches a "retracted" entry in onChainHistory', async () => {
      const db = fakeFirestore({
        verifications: [
          { id: 'v-1', data: { recordHash, verifierIdHash, onChainHistory: [{ action: 'verified' }, { action: 'retracted' }] } },
        ],
      });

      await expect(findMatchingVerificationForRetractedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'v-1',
      });
    });

    it('does not match a doc that was only ever verified, never retracted', async () => {
      const db = fakeFirestore({
        verifications: [{ id: 'v-1', data: { recordHash, verifierIdHash, onChainHistory: [{ action: 'verified' }] } }],
      });

      await expect(findMatchingVerificationForRetractedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingVerificationForLevelModifiedEvent', () => {
    it('matches a "modified" entry in onChainHistory, ignoring the specific level', async () => {
      const db = fakeFirestore({
        verifications: [
          { id: 'v-1', data: { recordHash, verifierIdHash, onChainHistory: [{ action: 'verified' }, { action: 'modified' }] } },
        ],
      });

      await expect(findMatchingVerificationForLevelModifiedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'v-1',
      });
    });

    it('does not match a doc with no "modified" entry', async () => {
      const db = fakeFirestore({
        verifications: [{ id: 'v-1', data: { recordHash, verifierIdHash, onChainHistory: [{ action: 'verified' }] } }],
      });

      await expect(findMatchingVerificationForLevelModifiedEvent(db, { recordHash, verifierIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });
});

describe('dispute match rules', () => {
  const recordHash = '0xRecordHash1';
  const disputerIdHash = '0xDisputerIdHash1';

  describe('findMatchingDisputeForDisputedEvent', () => {
    it('matches a "disputed" entry in onChainHistory', async () => {
      const db = fakeFirestore({
        disputes: [
          { id: `${recordHash}_disputer-uid`, data: { recordHash, disputerIdHash, onChainHistory: [{ action: 'disputed' }] } },
        ],
      });

      await expect(findMatchingDisputeForDisputedEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: `${recordHash}_disputer-uid`,
      });
    });

    it('does not match when the doc exists but has no "disputed" entry', async () => {
      const db = fakeFirestore({
        disputes: [{ id: 'd-1', data: { recordHash, disputerIdHash, onChainHistory: [{ action: 'retracted' }] } }],
      });

      await expect(findMatchingDisputeForDisputedEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });

    it('does not match when no disputes doc exists for this pair at all', async () => {
      const db = fakeFirestore({ disputes: [] });
      await expect(findMatchingDisputeForDisputedEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingDisputeForRetractedEvent', () => {
    it('matches a "retracted" entry in onChainHistory', async () => {
      const db = fakeFirestore({
        disputes: [{ id: 'd-1', data: { recordHash, disputerIdHash, onChainHistory: [{ action: 'disputed' }, { action: 'retracted' }] } }],
      });

      await expect(findMatchingDisputeForRetractedEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'd-1',
      });
    });

    it('does not match a doc that was only ever disputed, never retracted', async () => {
      const db = fakeFirestore({
        disputes: [{ id: 'd-1', data: { recordHash, disputerIdHash, onChainHistory: [{ action: 'disputed' }] } }],
      });

      await expect(findMatchingDisputeForRetractedEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingDisputeForModificationEvent', () => {
    it('matches a "modified" entry in onChainHistory, ignoring the specific severity/culpability', async () => {
      const db = fakeFirestore({
        disputes: [{ id: 'd-1', data: { recordHash, disputerIdHash, onChainHistory: [{ action: 'disputed' }, { action: 'modified' }] } }],
      });

      await expect(findMatchingDisputeForModificationEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'd-1',
      });
    });

    it('does not match a doc with no "modified" entry', async () => {
      const db = fakeFirestore({
        disputes: [{ id: 'd-1', data: { recordHash, disputerIdHash, onChainHistory: [{ action: 'disputed' }] } }],
      });

      await expect(findMatchingDisputeForModificationEvent(db, { recordHash, disputerIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });
});

describe('unaccepted flag match rules', () => {
  const subjectIdHash = '0xSubjectIdHash1';
  const recordIdHash = '0xRecordIdHash1';
  const reporterIdHash = '0xReporterIdHash1';

  describe('findMatchingUnacceptedFlagForFlaggedEvent', () => {
    it('matches a "flagged" entry in onChainHistory', async () => {
      const db = fakeFirestore({
        unacceptedFlags: [
          {
            id: 'subject-uid_record-uid',
            data: { subjectIdHash, recordIdHash, reporterIdHash, onChainHistory: [{ action: 'flagged' }] },
          },
        ],
      });

      await expect(
        findMatchingUnacceptedFlagForFlaggedEvent(db, { subjectIdHash, recordIdHash, reporterIdHash })
      ).resolves.toEqual({ matched: true, matchedFirestoreRef: 'subject-uid_record-uid' });
    });

    it('does not match when the doc exists but has no "flagged" entry', async () => {
      const db = fakeFirestore({
        unacceptedFlags: [{ id: 'f-1', data: { subjectIdHash, recordIdHash, reporterIdHash, onChainHistory: [{ action: 'revoked' }] } }],
      });

      await expect(
        findMatchingUnacceptedFlagForFlaggedEvent(db, { subjectIdHash, recordIdHash, reporterIdHash })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });

    it('does not match when no unacceptedFlags doc exists for this triple at all', async () => {
      const db = fakeFirestore({ unacceptedFlags: [] });
      await expect(
        findMatchingUnacceptedFlagForFlaggedEvent(db, { subjectIdHash, recordIdHash, reporterIdHash })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });
  });

  describe('findMatchingUnacceptedFlagForRevokedEvent', () => {
    it('matches a "revoked" entry in onChainHistory', async () => {
      const db = fakeFirestore({
        unacceptedFlags: [
          { id: 'f-1', data: { subjectIdHash, recordIdHash, reporterIdHash, onChainHistory: [{ action: 'flagged' }, { action: 'revoked' }] } },
        ],
      });

      await expect(
        findMatchingUnacceptedFlagForRevokedEvent(db, { subjectIdHash, recordIdHash, reporterIdHash })
      ).resolves.toEqual({ matched: true, matchedFirestoreRef: 'f-1' });
    });

    it('does not match a doc that was only ever flagged, never revoked', async () => {
      const db = fakeFirestore({
        unacceptedFlags: [{ id: 'f-1', data: { subjectIdHash, recordIdHash, reporterIdHash, onChainHistory: [{ action: 'flagged' }] } }],
      });

      await expect(
        findMatchingUnacceptedFlagForRevokedEvent(db, { subjectIdHash, recordIdHash, reporterIdHash })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });
  });
});
