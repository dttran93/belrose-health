// functions/test/chainReconciliationRules.test.ts
//
// Pure unit tests for the reconciliation predicates — no Firestore emulator involved. A minimal
// fake Firestore stands in for the real Admin SDK, supporting only the exact chain these rules
// use (collection().where().limit().get()), so these run instantly and in isolation. The
// emulator-backed end-to-end path (real Firestore, mocked contract) is covered separately in
// chainEventIndexer.test.ts.

import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { findMatchingUserForMemberEvent, findSyncQueueEntryForTxHash } from '../src/chainIndexer/reconciliationRules';

interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

function fakeFirestore(collections: Record<string, FakeDoc[]>): Firestore {
  const db = {
    collection: (name: string) => {
      let docs = collections[name] ?? [];
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
            docs: docs.map(d => ({ id: d.id, data: () => d.data })),
          };
        },
      };
      return query;
    },
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
