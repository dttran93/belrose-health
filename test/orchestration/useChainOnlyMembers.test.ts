// test/orchestration/useChainOnlyMembers.test.ts
//
// Orchestration test for fetchChainOnlyMembers (src/features/BackendChainParity/hooks/
// useChainOnlyMembers.ts) — the one place in BackendChainParity where the chain indexer's
// precomputed chainEventCache feeds into an integrity check. Real Firestore emulator for
// chainEventCache; mocked lib/contracts (buildChainOnlyItem's own chain reads).
//
// useChainOnlyMembers.ts computes `const db = getFirestore(getApp())` at MODULE load time, not
// inside the function body — unlike PermissionsService/SubjectService, which call getFirestore()
// fresh on every call. That means it must be imported AFTER connectTestFirestore() has
// initialized the app it resolves to; a normal static top-level import would evaluate (and throw
// "No Firebase App '[DEFAULT]' has been created") before this file's own connectTestFirestore()
// call ever runs, since all of a module's static imports fully resolve before its own body does.
// Confirmed empirically. Worked around with a deferred dynamic import.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, setDoc, collection } from 'firebase/firestore';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';

const mockMemberContract = {
  userStatus: vi.fn(),
  getWalletsForUser: vi.fn(),
};

vi.mock('../../src/features/BackendChainParity/lib/contracts', () => ({
  getMemberContract: () => mockMemberContract,
}));

const db = connectTestFirestore('belrose-orchestration-chain-only-members');

const { fetchChainOnlyMembers } = await import(
  '../../src/features/BackendChainParity/hooks/useChainOnlyMembers'
);

async function seedChainEvent(
  id: string,
  overrides: {
    contract?: string;
    eventName?: string;
    reconciliationStatus?: string;
    userIdHash?: string;
  } = {}
) {
  await setDoc(doc(collection(db, 'chainEventCache'), id), {
    contract: overrides.contract ?? 'MemberRoleManager',
    eventName: overrides.eventName ?? 'MemberRegistered',
    reconciliationStatus: overrides.reconciliationStatus ?? 'legitimate_chain_only',
    args: { userIdHash: overrides.userIdHash ?? '0xUserIdHash1' },
    logIndex: 0,
  });
}

describe('fetchChainOnlyMembers', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    mockMemberContract.userStatus.mockResolvedValue(2n);
    mockMemberContract.getWalletsForUser.mockResolvedValue(['0xwallet']);
  });

  it('returns an empty array when chainEventCache is empty', async () => {
    await expect(fetchChainOnlyMembers()).resolves.toEqual([]);
  });

  it('builds a chain_only item for a MemberRegistered event classified legitimate_chain_only', async () => {
    await seedChainEvent('e1', { userIdHash: '0xUserIdHash1' });

    const result = await fetchChainOnlyMembers();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ uid: '0xUserIdHash1', integrityStatus: 'chain_only' });
  });

  it('also matches WalletLinked events, not just MemberRegistered', async () => {
    await seedChainEvent('e1', { eventName: 'WalletLinked', userIdHash: '0xUserIdHash1' });

    const result = await fetchChainOnlyMembers();

    expect(result).toHaveLength(1);
  });

  it('ignores events from a different contract', async () => {
    await seedChainEvent('e1', { contract: 'HealthRecordCore' });

    await expect(fetchChainOnlyMembers()).resolves.toEqual([]);
  });

  it('ignores events with a different eventName', async () => {
    await seedChainEvent('e1', { eventName: 'MemberStatusChanged' });

    await expect(fetchChainOnlyMembers()).resolves.toEqual([]);
  });

  it('ignores events not classified legitimate_chain_only', async () => {
    await seedChainEvent('e1', { reconciliationStatus: 'matched' });

    await expect(fetchChainOnlyMembers()).resolves.toEqual([]);
  });

  it('dedupes multiple events for the same userIdHash into a single item', async () => {
    await seedChainEvent('e1', { eventName: 'MemberRegistered', userIdHash: '0xUserIdHash1' });
    await seedChainEvent('e2', { eventName: 'WalletLinked', userIdHash: '0xUserIdHash1' });

    const result = await fetchChainOnlyMembers();

    expect(result).toHaveLength(1);
  });

  it('returns one item per distinct userIdHash', async () => {
    await seedChainEvent('e1', { userIdHash: '0xUserIdHash1' });
    await seedChainEvent('e2', { userIdHash: '0xUserIdHash2' });

    const result = await fetchChainOnlyMembers();

    expect(result.map(r => r.uid).sort()).toEqual(['0xUserIdHash1', '0xUserIdHash2']);
  });
});
