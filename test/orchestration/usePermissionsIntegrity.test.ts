// test/orchestration/usePermissionsIntegrity.test.ts
//
// Orchestration test for fetchPermissionsIntegrity (src/features/BackendChainParity/hooks/
// usePermissionsIntegrity.ts). Real Firestore emulator for `records`; mocked lib/contracts for
// the chain side of checkRecordPermissionsIntegrity. Unlike useChainOnlyMembers.ts/
// useRecordsWithCredibility.ts, this hook calls getFirestore() fresh at call time (not at module
// load), so a normal static import is fine here — no dynamic-import workaround needed.
//
// Primary purpose: reach the Promise.allSettled REJECTION branch, which is unreachable through
// checkRecordPermissionsIntegrity directly (it never rejects on its own — everything after its
// Firestore-role-map-building step is wrapped in its own try/catch). The only way to trigger a
// real rejection is something throwing before that service's own try block — e.g. ethers.id()
// on a malformed non-string entry in one of the role arrays.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { doc, setDoc } from 'firebase/firestore';
import { id as ethersId } from 'ethers';
import { connectTestFirestore, clearTestFirestore, seedRecord } from './helpers/testFirestore';
import { fetchPermissionsIntegrity } from '../../src/features/BackendChainParity/hooks/usePermissionsIntegrity';

const mockMemberContract = {
  getAllRecordParticipants: vi.fn(),
};

vi.mock('../../src/features/BackendChainParity/lib/contracts', () => ({
  getMemberContract: () => mockMemberContract,
}));

const db = connectTestFirestore('belrose-orchestration-permissions-integrity');

describe('fetchPermissionsIntegrity', () => {
  beforeEach(async () => {
    await clearTestFirestore();
    vi.resetAllMocks();
    mockMemberContract.getAllRecordParticipants.mockResolvedValue({
      owners: [],
      admins: [],
      sharers: [],
      viewers: [],
    });
  });

  it('returns an empty array when there are no records', async () => {
    await expect(fetchPermissionsIntegrity()).resolves.toEqual([]);
  });

  it('returns a fulfilled integrity item for a normal record', async () => {
    await seedRecord(db, 'record-1', { owners: ['owner-1'] });
    mockMemberContract.getAllRecordParticipants.mockResolvedValue({
      owners: [ethersId('owner-1')],
      admins: [],
      sharers: [],
      viewers: [],
    });

    const result = await fetchPermissionsIntegrity();

    expect(result).toHaveLength(1);
    expect(result[0]!.recordId).toBe('record-1');
    expect(result[0]!.integrityStatus).toBe('synced');
  });

  it('synthesizes a failed item (not a thrown error) when the service rejects before its own try/catch', async () => {
    // A non-string entry in a role array makes ethers.id() throw synchronously inside
    // checkRecordPermissionsIntegrity, BEFORE its own try block — a genuine Promise rejection,
    // not the service's usual internally-caught `failed` status.
    await setDoc(doc(db, 'records', 'malformed-record'), {
      owners: [null],
      administrators: [],
      sharers: [],
      viewers: [],
    });

    const result = await fetchPermissionsIntegrity();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      recordId: 'malformed-record',
      integrityStatus: 'failed',
    });
    expect(result[0]!.error).toBeTruthy();
  });

  it('does not let one record\'s rejection prevent other records from being returned', async () => {
    await seedRecord(db, 'good-record', { owners: [] });
    await setDoc(doc(db, 'records', 'bad-record'), {
      owners: [null],
      administrators: [],
      sharers: [],
      viewers: [],
    });

    const result = await fetchPermissionsIntegrity();

    expect(result).toHaveLength(2);
    const byId = Object.fromEntries(result.map(r => [r.recordId, r]));
    expect(byId['good-record']!.integrityStatus).not.toBe('failed');
    expect(byId['bad-record']!.integrityStatus).toBe('failed');
  });
});
