// test/orchestration/recordPermissionIntegrityService.test.ts
//
// Orchestration test for checkRecordPermissionsIntegrity (src/features/BackendChainParity/
// services/recordPermissionIntegrityService.ts) — the one BackendChainParity service that reads
// Firestore itself (records/{id}/permissionHistory, ordered by changedAt desc, limited to 20) in
// addition to calling the chain. Real Firestore emulator for that read; mocked lib/contracts for
// getAllRecordParticipants. Mirrors test/orchestration/trusteePermissionService.test.ts's shape:
// real emulator for what the service itself reads, mock only the chain boundary.
//
// Note: unlike its own permissionHistory read, checkRecordPermissionsIntegrity does NOT fetch
// the record document itself — role arrays (owners/administrators/sharers/viewers) come from the
// FileObject passed in as a plain argument (the caller, usePermissionsIntegrity.ts, is the one
// that fetches `records` from Firestore). So tests build the record object directly rather than
// seeding+refetching it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, setDoc, collection, Timestamp } from 'firebase/firestore';
import { id as ethersId } from 'ethers';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';

const mockMemberContract = {
  getAllRecordParticipants: vi.fn(),
};

vi.mock('../../src/features/BackendChainParity/lib/contracts', () => ({
  getMemberContract: () => mockMemberContract,
}));

import { checkRecordPermissionsIntegrity } from '../../src/features/BackendChainParity/services/recordPermissionIntegrityService';

const RECORD_ID = 'perm-integrity-record';

const db = connectTestFirestore('belrose-orchestration-record-permission-integrity');

function makeRecord(overrides: {
  owners?: string[];
  administrators?: string[];
  sharers?: string[];
  viewers?: string[];
  uploadedBy?: string;
} = {}) {
  return {
    id: RECORD_ID,
    owners: overrides.owners ?? [],
    administrators: overrides.administrators ?? [],
    sharers: overrides.sharers ?? [],
    viewers: overrides.viewers ?? [],
    ...(overrides.uploadedBy ? { uploadedBy: overrides.uploadedBy } : {}),
  } as any;
}

async function seedHistoryEvent(
  eventId: string,
  overrides: {
    affectedUserIds?: string[];
    blockchainRef?: unknown;
    changedAt?: Timestamp;
  } = {}
) {
  await setDoc(doc(collection(db, 'records', RECORD_ID, 'permissionHistory'), eventId), {
    recordId: RECORD_ID,
    recordIdHash: ethersId(RECORD_ID),
    changedBy: 'someone',
    changedByIdHash: '0xChangedByHash',
    changedAt: overrides.changedAt ?? Timestamp.now(),
    changes: [],
    affectedUserIds: overrides.affectedUserIds ?? [],
    blockchainRef: overrides.blockchainRef ?? { txHash: '0xdefault', chainId: 1, blockNumber: 1 },
  });
}

function participants(overrides: {
  owners?: string[];
  admins?: string[];
  sharers?: string[];
  viewers?: string[];
}) {
  return {
    owners: overrides.owners ?? [],
    admins: overrides.admins ?? [],
    sharers: overrides.sharers ?? [],
    viewers: overrides.viewers ?? [],
  };
}

describe('checkRecordPermissionsIntegrity', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(participants({}));
  });

  it('is not_applicable when both Firestore and on-chain have zero members', async () => {
    const result = await checkRecordPermissionsIntegrity(makeRecord());

    expect(result.integrityStatus).toBe('not_applicable');
  });

  it('is synced when every Firestore role matches on-chain exactly', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('owner-1')], viewers: [ethersId('viewer-1')] })
    );

    const result = await checkRecordPermissionsIntegrity(
      makeRecord({ owners: ['owner-1'], viewers: ['viewer-1'] })
    );

    expect(result.integrityStatus).toBe('synced');
    expect(result.firestoreMemberCount).toBe(2);
    expect(result.onChainMemberCount).toBe(2);
  });

  it('is mismatch (wrong_role) when a user has a role on both sides but they differ', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('user-1')] })
    );

    const result = await checkRecordPermissionsIntegrity(makeRecord({ viewers: ['user-1'] }));

    expect(result.integrityStatus).toBe('mismatch');
    const comparison = result.memberComparisons.find(c => c.userId === 'user-1');
    expect(comparison).toMatchObject({
      firestoreRole: 'viewer',
      onChainRole: 'owner',
      syncStatus: 'wrong_role',
    });
  });

  it('is missing when a Firestore member has no on-chain role at all', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(participants({}));

    const result = await checkRecordPermissionsIntegrity(makeRecord({ viewers: ['user-1'] }));

    expect(result.integrityStatus).toBe('missing');
    expect(result.memberComparisons[0]).toMatchObject({
      userId: 'user-1',
      syncStatus: 'missing_from_chain',
      onChainRole: null,
    });
  });

  it('is mismatch when an on-chain role has no Firestore counterpart', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: ['0xChainOnlyUserIdHash'] })
    );

    const result = await checkRecordPermissionsIntegrity(makeRecord());

    expect(result.integrityStatus).toBe('mismatch');
    expect(result.memberComparisons[0]).toMatchObject({
      firestoreRole: null,
      onChainRole: 'owner',
      syncStatus: 'missing_from_backend',
    });
    expect(result.memberComparisons[0]!.userId).toBeUndefined();
  });

  it('mismatch takes priority over missing when both a wrong_role and a missing_from_chain member exist', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('wrong-role-user')] })
    );

    const result = await checkRecordPermissionsIntegrity(
      makeRecord({ viewers: ['wrong-role-user', 'missing-user'] })
    );

    expect(result.integrityStatus).toBe('mismatch');
  });

  it('populates lastBlockchainRef/lastChangedAt from the most recent permissionHistory entry per user', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('owner-1')] })
    );

    // Older event first, then a newer one — history is read ordered by changedAt desc, so the
    // first hit per user should be the NEWER one.
    await seedHistoryEvent('event-old', {
      affectedUserIds: ['owner-1'],
      blockchainRef: { txHash: '0xold', chainId: 1, blockNumber: 1 },
      changedAt: Timestamp.fromMillis(1000),
    });
    await seedHistoryEvent('event-new', {
      affectedUserIds: ['owner-1'],
      blockchainRef: { txHash: '0xnew', chainId: 1, blockNumber: 2 },
      changedAt: Timestamp.fromMillis(2000),
    });

    const result = await checkRecordPermissionsIntegrity(makeRecord({ owners: ['owner-1'] }));

    const comparison = result.memberComparisons.find(c => c.userId === 'owner-1');
    expect(comparison?.lastBlockchainRef).toMatchObject({ txHash: '0xnew' });
  });

  it('leaves lastBlockchainRef/lastChangedAt undefined/null for a user with no matching history event', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('owner-1')] })
    );
    // History exists, but for a different user entirely.
    await seedHistoryEvent('event-1', { affectedUserIds: ['someone-else'] });

    const result = await checkRecordPermissionsIntegrity(makeRecord({ owners: ['owner-1'] }));

    const comparison = result.memberComparisons.find(c => c.userId === 'owner-1');
    expect(comparison?.lastBlockchainRef).toBeUndefined();
    expect(comparison?.lastChangedAt).toBeNull();
  });

  it('only populates uploadedByIdHash when uploadedBy is present', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('owner-1')] })
    );

    const result = await checkRecordPermissionsIntegrity(
      makeRecord({ owners: ['owner-1'], uploadedBy: 'owner-1' })
    );

    expect(result.uploadedBy).toBe('owner-1');
    expect(result.uploadedByIdHash).toBe(ethersId('owner-1').toLowerCase());
  });

  it('leaves uploadedByIdHash undefined when uploadedBy is absent', async () => {
    mockMemberContract.getAllRecordParticipants.mockResolvedValue(
      participants({ owners: [ethersId('owner-1')] })
    );

    const result = await checkRecordPermissionsIntegrity(makeRecord({ owners: ['owner-1'] }));

    expect(result.uploadedBy).toBeUndefined();
    expect(result.uploadedByIdHash).toBeUndefined();
  });

  it('returns failed with the error when the contract call throws unexpectedly', async () => {
    mockMemberContract.getAllRecordParticipants.mockRejectedValue(new Error('RPC blew up'));

    const result = await checkRecordPermissionsIntegrity(makeRecord({ owners: ['owner-1'] }));

    expect(result.integrityStatus).toBe('failed');
    expect(result.error).toContain('RPC blew up');
  });
});
