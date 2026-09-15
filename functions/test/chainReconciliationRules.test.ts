// functions/test/chainReconciliationRules.test.ts
//
// Pure unit tests for the reconciliation predicates — no Firestore emulator involved. A minimal
// fake Firestore stands in for the real Admin SDK, supporting only the exact chain these rules
// use (collection().where().limit().get()), so these run instantly and in isolation. The
// emulator-backed end-to-end path (real Firestore, mocked contract) is covered separately in
// chainEventIndexer.test.ts.

import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  findMatchingUserForMemberEvent,
  findSyncQueueEntryForTxHash,
  findMatchingPermissionHistoryForRoleEvent,
  findMatchingPermissionHistoryForRoleChangedEvent,
  findMatchingUserForStatusEvent,
  findMatchingPermissionHistoryForOwnershipLeftEvent,
  findMatchingTrusteeHistoryForProposedEvent,
  findMatchingTrusteeHistoryForAcceptedEvent,
  findMatchingTrusteeHistoryForDeclinedEvent,
  findMatchingTrusteeHistoryForRevokedEvent,
  findMatchingTrusteeHistoryForLevelUpdatedEvent,
} from '../src/chainIndexer/reconciliationRules';
import { ethers } from 'ethers';

interface FakeDoc {
  id: string;
  path?: string; // only meaningful for collectionGroup docs — ref.path across subcollections
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

describe('findMatchingUserForMemberEvent', () => {
  const args = { wallet: '0xAbC123', userIdHash: '0xHash1' };

  it('matches when the wallet is the user\'s primary wallet.address', () => {
    const db = fakeFirestore({
      users: [{ id: 'user-1', data: { onChainIdentity: { userIdHash: '0xHash1' }, wallet: { address: '0xabc123' } } }],
    });
    expect(findMatchingUserForMemberEvent(db, args)).resolves.toEqual({
      matched: true,
      matchedFirestoreRef: 'users/user-1',
    });
  });

  it('matches when the wallet is the smartAccountAddress instead', () => {
    const db = fakeFirestore({
      users: [
        { id: 'user-1', data: { onChainIdentity: { userIdHash: '0xHash1' }, wallet: { smartAccountAddress: '0xABC123' } } },
      ],
    });
    expect(findMatchingUserForMemberEvent(db, args)).resolves.toMatchObject({ matched: true });
  });

  it('matches when the wallet only appears in onChainIdentity.linkedWallets', () => {
    const db = fakeFirestore({
      users: [
        {
          id: 'user-1',
          data: {
            onChainIdentity: { userIdHash: '0xHash1', linkedWallets: [{ address: '0xdeadbeef' }, { address: '0xABC123' }] },
          },
        },
      ],
    });
    expect(findMatchingUserForMemberEvent(db, args)).resolves.toMatchObject({ matched: true });
  });

  it('does not match when no user has this userIdHash at all', () => {
    const db = fakeFirestore({ users: [] });
    expect(findMatchingUserForMemberEvent(db, args)).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
  });

  it('does not match when the userIdHash exists but none of the known addresses match this wallet', () => {
    const db = fakeFirestore({
      users: [{ id: 'user-1', data: { onChainIdentity: { userIdHash: '0xHash1' }, wallet: { address: '0xSomeOtherWallet' } } }],
    });
    expect(findMatchingUserForMemberEvent(db, args)).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
  });
});

describe('findSyncQueueEntryForTxHash', () => {
  it('finds a confirmed entry', async () => {
    const db = fakeFirestore({ blockchainSyncQueue: [{ id: 'sync-1', data: { txHash: '0xtx1', status: 'confirmed' } }] });
    await expect(findSyncQueueEntryForTxHash(db, '0xtx1')).resolves.toEqual({
      found: true,
      syncQueueId: 'sync-1',
      status: 'confirmed',
    });
  });

  it('finds a non-confirmed entry and reports its actual status', async () => {
    const db = fakeFirestore({ blockchainSyncQueue: [{ id: 'sync-1', data: { txHash: '0xtx1', status: 'pending' } }] });
    await expect(findSyncQueueEntryForTxHash(db, '0xtx1')).resolves.toMatchObject({ found: true, status: 'pending' });
  });

  it('reports not found when no entry matches this txHash', async () => {
    const db = fakeFirestore({ blockchainSyncQueue: [] });
    await expect(findSyncQueueEntryForTxHash(db, '0xtx1')).resolves.toEqual({
      found: false,
      syncQueueId: null,
      status: null,
    });
  });
});

describe('findMatchingPermissionHistoryForRoleEvent', () => {
  const targetUserId = 'user-target';
  const targetIdHash = ethers.id(targetUserId);
  const args = { recordIdHash: '0xRecordHash1', targetIdHash, role: 'administrator' };

  it('matches a direct-write permissionHistory doc with the same recordIdHash/targetIdHash/role', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changedBy: 'user-admin',
              changedByIdHash: ethers.id('user-admin'),
              changes: [{ userId: targetUserId, newRole: 'administrator' }],
              context: 'direct',
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleEvent(db, args)).resolves.toEqual({
      matched: true,
      matchedFirestoreRef: 'records/rec-1/permissionHistory/event-1',
    });
  });

  it('matches a trustee-authored permissionHistory doc identically — the rule is producer-agnostic', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changedBy: 'trustee-uid',
              changedByIdHash: ethers.id('trustee-uid'),
              changes: [{ userId: targetUserId, newRole: 'administrator' }],
              context: 'trustee_grant',
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleEvent(db, args)).resolves.toMatchObject({ matched: true });
  });

  it('matches even when changedByIdHash differs from the event\'s userIdHash (the initializeRecordRole bytes32(0) case) — userIdHash is never part of the match condition', async () => {
    // args here deliberately omits userIdHash entirely — the function signature doesn't even
    // accept it — proving the match can never depend on it regardless of what the real event's
    // userIdHash (bytes32(0), in this real scenario) actually was.
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changedBy: 'real-admin-uid',
              changedByIdHash: ethers.id('real-admin-uid'), // a real hash, NOT bytes32(0)
              changes: [{ userId: targetUserId, newRole: 'administrator' }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleEvent(db, args)).resolves.toMatchObject({ matched: true });
  });

  it('does not match when the role differs', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: { recordIdHash: '0xRecordHash1', changes: [{ userId: targetUserId, newRole: 'viewer' }] },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleEvent(db, args)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });

  it('does not match when the target differs', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: { recordIdHash: '0xRecordHash1', changes: [{ userId: 'some-other-user', newRole: 'administrator' }] },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleEvent(db, args)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });

  it('does not match when no permissionHistory doc exists for that recordIdHash at all', async () => {
    const db = fakeFirestore({}, { permissionHistory: [] });
    await expect(findMatchingPermissionHistoryForRoleEvent(db, args)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });
});

describe('findMatchingPermissionHistoryForRoleChangedEvent', () => {
  const targetUserId = 'user-target';
  const targetIdHash = ethers.id(targetUserId);
  const changedArgs = { recordIdHash: '0xRecordHash1', targetIdHash, oldRole: 'viewer', newRole: 'sharer' };

  it('matches an "upgraded" changes[] entry with the same oldRole/newRole', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changes: [{ action: 'upgraded', userId: targetUserId, previousRole: 'viewer', newRole: 'sharer' }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleChangedEvent(db, changedArgs)).resolves.toEqual({
      matched: true,
      matchedFirestoreRef: 'records/rec-1/permissionHistory/event-1',
    });
  });

  it('matches a "downgraded" changes[] entry identically', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changes: [{ action: 'downgraded', userId: targetUserId, previousRole: 'viewer', newRole: 'sharer' }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleChangedEvent(db, changedArgs)).resolves.toMatchObject({ matched: true });
  });

  it('does not match a "granted" changes[] entry even when the role values line up — that belongs to RoleGranted, not RoleChanged', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changes: [{ action: 'granted', userId: targetUserId, previousRole: null, newRole: 'sharer' }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleChangedEvent(db, changedArgs)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });

  it('does not match when previousRole differs from the event\'s oldRole', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changes: [{ action: 'upgraded', userId: targetUserId, previousRole: 'sharer', newRole: 'sharer' }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForRoleChangedEvent(db, changedArgs)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });

  it('does not match when no permissionHistory doc exists for that recordIdHash at all', async () => {
    const db = fakeFirestore({}, { permissionHistory: [] });
    await expect(findMatchingPermissionHistoryForRoleChangedEvent(db, changedArgs)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });
});

describe('findMatchingUserForStatusEvent', () => {
  const args = { userIdHash: '0xHash1', newStatus: 3 }; // Verified

  it('matches when onChainStatus history contains an entry with the matching status label', async () => {
    const db = fakeFirestore({
      users: [
        {
          id: 'user-1',
          data: { onChainIdentity: { userIdHash: '0xHash1', onChainStatus: [{ status: 'Active' }, { status: 'Verified' }] } },
        },
      ],
    });

    await expect(findMatchingUserForStatusEvent(db, args)).resolves.toEqual({ matched: true, matchedFirestoreRef: 'users/user-1' });
  });

  it('does not match when the user exists but their history never recorded this status', async () => {
    const db = fakeFirestore({
      users: [{ id: 'user-1', data: { onChainIdentity: { userIdHash: '0xHash1', onChainStatus: [{ status: 'Active' }] } } }],
    });

    await expect(findMatchingUserForStatusEvent(db, args)).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
  });

  it('does not match when no user has this userIdHash at all', async () => {
    const db = fakeFirestore({ users: [] });
    await expect(findMatchingUserForStatusEvent(db, args)).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
  });

  it('does not match on an unrecognized status number, even if the history array is present', async () => {
    const db = fakeFirestore({
      users: [{ id: 'user-1', data: { onChainIdentity: { userIdHash: '0xHash1', onChainStatus: [{ status: 'Verified' }] } } }],
    });
    await expect(findMatchingUserForStatusEvent(db, { userIdHash: '0xHash1', newStatus: 99 })).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });
});

describe('findMatchingPermissionHistoryForOwnershipLeftEvent', () => {
  const leavingUserId = 'user-owner';
  const userIdHash = ethers.id(leavingUserId);
  const args = { recordIdHash: '0xRecordHash1', userIdHash };

  it('matches a self-authored full owner removal (revoked, previousRole owner, newRole null)', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changedByIdHash: userIdHash,
              changes: [{ action: 'revoked', userId: leavingUserId, previousRole: 'owner', newRole: null }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForOwnershipLeftEvent(db, args)).resolves.toEqual({
      matched: true,
      matchedFirestoreRef: 'records/rec-1/permissionHistory/event-1',
    });
  });

  it('does not match the identical changes[] shape when changedByIdHash belongs to someone else', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changedByIdHash: ethers.id('some-other-admin'),
              changes: [{ action: 'revoked', userId: leavingUserId, previousRole: 'owner', newRole: null }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForOwnershipLeftEvent(db, args)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });

  it('does not match a demotion (newRole non-null) even from the same self-authored doc', async () => {
    const db = fakeFirestore(
      {},
      {
        permissionHistory: [
          {
            id: 'event-1',
            path: 'records/rec-1/permissionHistory/event-1',
            data: {
              recordIdHash: '0xRecordHash1',
              changedByIdHash: userIdHash,
              changes: [{ action: 'downgraded', userId: leavingUserId, previousRole: 'owner', newRole: 'administrator' }],
            },
          },
        ],
      }
    );

    await expect(findMatchingPermissionHistoryForOwnershipLeftEvent(db, args)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });

  it('does not match when no permissionHistory doc exists for that recordIdHash at all', async () => {
    const db = fakeFirestore({}, { permissionHistory: [] });
    await expect(findMatchingPermissionHistoryForOwnershipLeftEvent(db, args)).resolves.toEqual({
      matched: false,
      matchedFirestoreRef: null,
    });
  });
});

describe('trustee history match rules', () => {
  const trustorIdHash = '0xTrustorHash1';
  const trusteeIdHash = '0xTrusteeHash1';

  describe('findMatchingTrusteeHistoryForProposedEvent', () => {
    it('matches a propose entry with the same level', async () => {
      const db = fakeFirestore(
        {},
        {
          trusteeHistory: [
            {
              id: 'event-1',
              path: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
              data: { trustorIdHash, trusteeIdHash, action: 'propose', trustLevel: 'custodian' },
            },
          ],
        }
      );

      await expect(findMatchingTrusteeHistoryForProposedEvent(db, { trustorIdHash, trusteeIdHash, level: 1 })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
      });
    });

    it('does not match an accept entry even for the same pair', async () => {
      const db = fakeFirestore(
        {},
        { trusteeHistory: [{ id: 'event-1', path: 'p', data: { trustorIdHash, trusteeIdHash, action: 'accept' } }] }
      );

      await expect(
        findMatchingTrusteeHistoryForProposedEvent(db, { trustorIdHash, trusteeIdHash, level: 1 })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });

    it('does not match when no trusteeHistory doc exists for this pair at all', async () => {
      const db = fakeFirestore({}, { trusteeHistory: [] });
      await expect(
        findMatchingTrusteeHistoryForProposedEvent(db, { trustorIdHash, trusteeIdHash, level: 1 })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });
  });

  describe('findMatchingTrusteeHistoryForAcceptedEvent', () => {
    it('matches an accept entry regardless of trustLevel (not guaranteed present on accept entries)', async () => {
      const db = fakeFirestore(
        {},
        {
          trusteeHistory: [
            { id: 'event-1', path: 'trusteeRelationships/rel-1/trusteeHistory/event-1', data: { trustorIdHash, trusteeIdHash, action: 'accept' } },
          ],
        }
      );

      await expect(findMatchingTrusteeHistoryForAcceptedEvent(db, { trustorIdHash, trusteeIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
      });
    });

    it('does not match a propose entry', async () => {
      const db = fakeFirestore(
        {},
        { trusteeHistory: [{ id: 'event-1', path: 'p', data: { trustorIdHash, trusteeIdHash, action: 'propose' } }] }
      );

      await expect(findMatchingTrusteeHistoryForAcceptedEvent(db, { trustorIdHash, trusteeIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingTrusteeHistoryForDeclinedEvent', () => {
    it('matches a decline entry', async () => {
      const db = fakeFirestore(
        {},
        { trusteeHistory: [{ id: 'event-1', path: 'trusteeRelationships/rel-1/trusteeHistory/event-1', data: { trustorIdHash, trusteeIdHash, action: 'decline' } }] }
      );

      await expect(findMatchingTrusteeHistoryForDeclinedEvent(db, { trustorIdHash, trusteeIdHash })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
      });
    });

    it('does not match when no trusteeHistory doc exists for this pair at all', async () => {
      const db = fakeFirestore({}, { trusteeHistory: [] });
      await expect(findMatchingTrusteeHistoryForDeclinedEvent(db, { trustorIdHash, trusteeIdHash })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingTrusteeHistoryForRevokedEvent', () => {
    const revokerId = 'revoker-uid';
    const revokedBy = ethers.id(revokerId);

    it('matches a revoke entry authored by the same caller as revokedBy', async () => {
      const db = fakeFirestore(
        {},
        {
          trusteeHistory: [
            {
              id: 'event-1',
              path: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
              data: { trustorIdHash, trusteeIdHash, action: 'revoke', changedByIdHash: revokedBy },
            },
          ],
        }
      );

      await expect(findMatchingTrusteeHistoryForRevokedEvent(db, { trustorIdHash, trusteeIdHash, revokedBy })).resolves.toEqual({
        matched: true,
        matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
      });
    });

    it('does not match a revoke entry authored by someone else', async () => {
      const db = fakeFirestore(
        {},
        {
          trusteeHistory: [
            { id: 'event-1', path: 'p', data: { trustorIdHash, trusteeIdHash, action: 'revoke', changedByIdHash: ethers.id('someone-else') } },
          ],
        }
      );

      await expect(findMatchingTrusteeHistoryForRevokedEvent(db, { trustorIdHash, trusteeIdHash, revokedBy })).resolves.toEqual({
        matched: false,
        matchedFirestoreRef: null,
      });
    });
  });

  describe('findMatchingTrusteeHistoryForLevelUpdatedEvent', () => {
    it('matches a level-update entry with the same new level', async () => {
      const db = fakeFirestore(
        {},
        {
          trusteeHistory: [
            {
              id: 'event-1',
              path: 'trusteeRelationships/rel-1/trusteeHistory/event-1',
              data: { trustorIdHash, trusteeIdHash, action: 'level-update', trustLevel: 'controller' },
            },
          ],
        }
      );

      await expect(
        findMatchingTrusteeHistoryForLevelUpdatedEvent(db, { trustorIdHash, trusteeIdHash, newLevel: 2 })
      ).resolves.toEqual({ matched: true, matchedFirestoreRef: 'trusteeRelationships/rel-1/trusteeHistory/event-1' });
    });

    it('does not match a level-update entry with a different level', async () => {
      const db = fakeFirestore(
        {},
        { trusteeHistory: [{ id: 'event-1', path: 'p', data: { trustorIdHash, trusteeIdHash, action: 'level-update', trustLevel: 'observer' } }] }
      );

      await expect(
        findMatchingTrusteeHistoryForLevelUpdatedEvent(db, { trustorIdHash, trusteeIdHash, newLevel: 2 })
      ).resolves.toEqual({ matched: false, matchedFirestoreRef: null });
    });
  });
});
