// test/orchestration/linkRecordService.test.ts
//
// Layer 3 (orchestration) — linkRecordService's prepareRecordsForLinking + addRecordsToRequest
// (now two separately-awaitable steps, no longer bundled: useLinkRecord blocks the UI on the
// former and fires the latter without awaiting, tracked via OnChainActivityTray instead), plus
// markRequestComplete and denyRequest. PermissionPreparationService.prepareBatch and
// PermissionsService.grantRoleBatch are mocked as peer dependencies (blockchain-heavy, out of
// scope here) — the point of this suite is the real Firestore write that follows: registering
// which records actually succeeded on fulfilledRecordIds, using the *returned* succeeded-ids
// subset rather than blindly writing everything that was requested.

import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { connectTestFirestore, clearTestFirestore } from './helpers/testFirestore';

const { prepareBatchMock, grantRoleBatchMock } = vi.hoisted(() => ({
  prepareBatchMock: vi.fn(),
  grantRoleBatchMock: vi.fn(),
}));

vi.mock('@/features/Permissions/services/permissionPreparationService', () => ({
  PermissionPreparationService: { prepareBatch: prepareBatchMock },
}));

vi.mock('@/features/Permissions/services/permissionsService', () => ({
  PermissionsService: { grantRoleBatch: grantRoleBatchMock },
}));

import {
  prepareRecordsForLinking,
  addRecordsToRequest,
  markRequestComplete,
  denyRequest,
} from '../../src/features/RequestRecord/services/linkRecordService';
import type { RecordRequest } from '@belrose/shared';

const INVITE_CODE = 'invite-link-1';
const REQUESTER_ID = 'requester-1';

const db = connectTestFirestore('belrose-orchestration-link-record');

function makeRequest(overrides: Partial<RecordRequest> = {}): RecordRequest {
  return { inviteCode: INVITE_CODE, requesterId: REQUESTER_ID, ...overrides } as RecordRequest;
}

beforeEach(async () => {
  await clearTestFirestore();
  prepareBatchMock.mockReset();
  grantRoleBatchMock.mockReset();
  await setDoc(doc(db, 'recordRequests', INVITE_CODE), {
    status: 'pending',
    fulfilledRecordIds: [],
  });
});

afterAll(() => {
  getApps().forEach(app => deleteApp(app));
});

describe('prepareRecordsForLinking', () => {
  it('throws when no records are selected', async () => {
    await expect(prepareRecordsForLinking([])).rejects.toThrow('No records selected');
    expect(prepareBatchMock).not.toHaveBeenCalled();
  });

  it('delegates to PermissionPreparationService.prepareBatch', async () => {
    prepareBatchMock.mockResolvedValue(undefined);

    await prepareRecordsForLinking(['rec-1', 'rec-2']);

    expect(prepareBatchMock).toHaveBeenCalledWith(['rec-1', 'rec-2']);
  });

  it('propagates a prepareBatch failure', async () => {
    prepareBatchMock.mockRejectedValue(new Error('smart account setup failed'));

    await expect(prepareRecordsForLinking(['rec-1'])).rejects.toThrow(
      'smart account setup failed'
    );
  });
});

describe('addRecordsToRequest', () => {
  it('throws when no records are selected', async () => {
    await expect(addRecordsToRequest([], makeRequest(), 'viewer')).rejects.toThrow(
      'No records selected'
    );
    expect(grantRoleBatchMock).not.toHaveBeenCalled();
  });

  it('grants in a single batch, and registers all succeeded ids on the request', async () => {
    grantRoleBatchMock.mockResolvedValue(['rec-1', 'rec-2']);

    const result = await addRecordsToRequest(['rec-1', 'rec-2'], makeRequest(), 'viewer');

    expect(grantRoleBatchMock).toHaveBeenCalledWith(
      ['rec-1', 'rec-2'],
      REQUESTER_ID,
      ['viewer', 'viewer']
    );
    expect(result).toEqual({ success: true, recordIds: ['rec-1', 'rec-2'] });

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.fulfilledRecordIds).toEqual(['rec-1', 'rec-2']);
  });

  it('registers only the subset that actually succeeded on-chain, not everything requested', async () => {
    grantRoleBatchMock.mockResolvedValue(['rec-1']); // rec-2 failed on-chain

    const result = await addRecordsToRequest(['rec-1', 'rec-2'], makeRequest(), 'administrator');

    expect(result.recordIds).toEqual(['rec-1']);
    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.fulfilledRecordIds).toEqual(['rec-1']);
  });

  it('accumulates fulfilledRecordIds across multiple calls rather than overwriting', async () => {
    grantRoleBatchMock.mockResolvedValueOnce(['rec-1']);
    grantRoleBatchMock.mockResolvedValueOnce(['rec-2']);

    await addRecordsToRequest(['rec-1'], makeRequest(), 'viewer');
    await addRecordsToRequest(['rec-2'], makeRequest(), 'viewer');

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.fulfilledRecordIds).toEqual(
      expect.arrayContaining(['rec-1', 'rec-2'])
    );
  });

  it('propagates the error and writes nothing when grantRoleBatch fails', async () => {
    grantRoleBatchMock.mockRejectedValue(new Error('blockchain grant failed'));

    await expect(addRecordsToRequest(['rec-1'], makeRequest(), 'viewer')).rejects.toThrow(
      'blockchain grant failed'
    );
    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.fulfilledRecordIds).toEqual([]);
  });
});

describe('markRequestComplete', () => {
  it('marks the request fulfilled', async () => {
    await markRequestComplete(makeRequest());

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.status).toBe('fulfilled');
    expect(requestSnap.data()!.fulfilledAt).toBeDefined();
  });
});

describe('denyRequest', () => {
  it('denies with a reason and no note', async () => {
    await denyRequest({ request: makeRequest(), reason: 'wrong_recipient' });

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.status).toBe('denied');
    expect(requestSnap.data()!.deniedReason).toBe('wrong_recipient');
    expect('deniedNote' in requestSnap.data()!).toBe(false);
  });

  it('denies with a trimmed note when provided', async () => {
    await denyRequest({ request: makeRequest(), reason: 'other', note: '  needs more info  ' });

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect(requestSnap.data()!.deniedNote).toBe('needs more info');
  });

  it('omits deniedNote when the note is only whitespace', async () => {
    await denyRequest({ request: makeRequest(), reason: 'other', note: '   ' });

    const requestSnap = await getDoc(doc(db, 'recordRequests', INVITE_CODE));
    expect('deniedNote' in requestSnap.data()!).toBe(false);
  });
});
