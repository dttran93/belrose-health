// src/features/Permissions/services/__tests__/permissionPreparationService.test.ts
//
// Unit tests for PermissionPreparationService — unlike blockchainRoleManagerService (thin
// contract wrapper, not worth testing) this file has real, multi-branch orchestration logic
// (readiness checks with several distinct failure reasons, a fragile "already exists" error
// heuristic, batch skip/aggregate-failure logic). All external dependencies (blockchain
// readiness, role stats, the initializeRoleOnChain Cloud Function, Firestore) are mocked —
// no emulator needed, stays in the fast unit tier.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/BlockchainWallet/services/blockchainPreparationService', () => ({
  BlockchainPreparationService: {
    getStatus: vi.fn(),
    ensureReady: vi.fn(),
    isActiveMember: vi.fn(),
  },
}));

vi.mock('../blockchainRoleManagerService', () => ({
  BlockchainRoleManagerService: {
    getRecordRoleStats: vi.fn(),
  },
}));

vi.mock('../writePermissionChangeEvent', () => ({
  buildPermissionHistoryDocId: vi.fn(() => 'mock-history-doc-id'),
  preparePermissionChangeEventData: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  setDoc: vi.fn(),
}));

import { PermissionPreparationService } from '../permissionPreparationService';
import { BlockchainPreparationService } from '@/features/BlockchainWallet/services/blockchainPreparationService';
import { BlockchainRoleManagerService } from '../blockchainRoleManagerService';
import {
  buildPermissionHistoryDocId,
  preparePermissionChangeEventData,
} from '../writePermissionChangeEvent';
import { httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const READY_STATUS = {
  ready: true,
  smartAccountAddress: '0xSmart',
  checks: { isComputed: true, isSavedToFirestore: true, isRegisteredOnChain: true },
};
const NOT_READY_STATUS = {
  ready: false,
  smartAccountAddress: null,
  checks: { isComputed: false, isSavedToFirestore: false, isRegisteredOnChain: false },
};

// resetAllMocks (not clearAllMocks) — a mockResolvedValue configured in one test must not
// leak into the next (see the grantRoleBatch mock-leakage lesson from earlier this session).
beforeEach(() => {
  vi.resetAllMocks();
});

describe('PermissionPreparationService.verifyPrerequisites', () => {
  it('is not ready when the caller is not ready', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValueOnce(
      NOT_READY_STATUS as any
    );

    const result = await PermissionPreparationService.verifyPrerequisites('rec1', '0xTarget');

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/network account is not fully set up/i);
    expect(BlockchainRoleManagerService.getRecordRoleStats).not.toHaveBeenCalled();
  });

  it('is not ready when the target is not an active member', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainPreparationService.isActiveMember).mockResolvedValue(false);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });

    const result = await PermissionPreparationService.verifyPrerequisites('rec1', '0xTarget');

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/target user has not completed their network setup/i);
    expect(result.checks?.targetReady).toBe(false);
  });

  it('is not ready when the record has not been initialized on-chain', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainPreparationService.isActiveMember).mockResolvedValue(true);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 0,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });

    const result = await PermissionPreparationService.verifyPrerequisites('rec1', '0xTarget');

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/has not been initialized/i);
  });

  it('is ready when caller, target, and record all check out', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainPreparationService.isActiveMember).mockResolvedValue(true);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 3,
    });

    const result = await PermissionPreparationService.verifyPrerequisites('rec1', '0xTarget');

    expect(result).toEqual({
      ready: true,
      callerSmartAccountAddress: '0xSmart',
      checks: { callerReady: true, targetReady: true, recordInitialized: true },
    });
  });
});

describe('PermissionPreparationService.verifyCallerPrerequisites', () => {
  it('is not ready when the caller is not ready', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(NOT_READY_STATUS as any);

    const result = await PermissionPreparationService.verifyCallerPrerequisites('rec1');

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/not fully set up/i);
  });

  it('is not ready when the record has not been initialized', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 0,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });

    const result = await PermissionPreparationService.verifyCallerPrerequisites('rec1');

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/has not been initialized/i);
  });

  it('is ready when caller and record both check out', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });

    const result = await PermissionPreparationService.verifyCallerPrerequisites('rec1');

    expect(result.ready).toBe(true);
  });
});

describe('PermissionPreparationService.initializeRecordRole', () => {
  beforeEach(() => {
    vi.mocked(preparePermissionChangeEventData).mockResolvedValue({
      recordId: 'rec1',
      changedBy: 'user1',
      changes: [{ userId: 'user1', action: 'granted', previousRole: null, newRole: 'owner' }],
      blockchainRef: null,
    } as any);
    vi.mocked(doc).mockReturnValue('mock-history-ref' as any);
  });

  it('writes an audit event when initialization succeeds with a blockchainRef', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: { success: true, blockchainRef: { txHash: '0xabc', blockNumber: 1 }, role: 'owner' },
    });
    vi.mocked(httpsCallable).mockReturnValue(callable as any);
    vi.mocked(getAuth).mockReturnValue({ currentUser: { uid: 'user1' } } as any);

    const result = await PermissionPreparationService.initializeRecordRole(
      'rec1',
      '0xWallet',
      'owner'
    );

    expect(result.success).toBe(true);
    expect(buildPermissionHistoryDocId).toHaveBeenCalledWith('user1');
    expect(preparePermissionChangeEventData).toHaveBeenCalledWith('rec1', 'user1', [
      { userId: 'user1', action: 'granted', previousRole: null, newRole: 'owner' },
    ]);
    expect(setDoc).toHaveBeenCalledWith(
      'mock-history-ref',
      expect.objectContaining({ blockchainRef: { txHash: '0xabc', blockNumber: 1 } })
    );
  });

  it('does not write an audit event when there is no signed-in user', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: { success: true, blockchainRef: { txHash: '0xabc', blockNumber: 1 }, role: 'owner' },
    });
    vi.mocked(httpsCallable).mockReturnValue(callable as any);
    vi.mocked(getAuth).mockReturnValue({ currentUser: null } as any);

    await PermissionPreparationService.initializeRecordRole('rec1', '0xWallet', 'owner');

    expect(setDoc).not.toHaveBeenCalled();
  });

  it('treats an "already-exists" error code as a graceful no-op, not a failure', async () => {
    const callable = vi.fn().mockRejectedValue({ code: 'already-exists', message: 'x' });
    vi.mocked(httpsCallable).mockReturnValue(callable as any);

    const result = await PermissionPreparationService.initializeRecordRole(
      'rec1',
      '0xWallet',
      'administrator'
    );

    expect(result).toEqual({ success: true, blockchainRef: undefined, role: 'administrator' });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('treats an "already initialized" message as a graceful no-op too', async () => {
    const callable = vi.fn().mockRejectedValue({ message: 'Record already initialized on chain' });
    vi.mocked(httpsCallable).mockReturnValue(callable as any);

    const result = await PermissionPreparationService.initializeRecordRole(
      'rec1',
      '0xWallet',
      'owner'
    );

    expect(result.success).toBe(true);
  });

  it('rethrows a genuine, unrecognized error', async () => {
    const callable = vi.fn().mockRejectedValue({ message: 'Insufficient gas' });
    vi.mocked(httpsCallable).mockReturnValue(callable as any);

    await expect(
      PermissionPreparationService.initializeRecordRole('rec1', '0xWallet', 'owner')
    ).rejects.toThrow('Insufficient gas');
  });
});

describe('PermissionPreparationService.getStatus', () => {
  it('is ready only when both blockchain readiness and record initialization are true', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });

    const result = await PermissionPreparationService.getStatus('rec1');

    expect(result.isReady).toBe(true);
    expect(result.isRecordInitialized).toBe(true);
  });

  it('is not ready when the record has no owners or admins yet', async () => {
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 0,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });

    const result = await PermissionPreparationService.getStatus('rec1');

    expect(result.isReady).toBe(false);
    expect(result.isRecordInitialized).toBe(false);
  });
});

describe('PermissionPreparationService.prepareBatch', () => {
  it('does nothing for an empty record list', async () => {
    await PermissionPreparationService.prepareBatch([]);
    expect(BlockchainPreparationService.ensureReady).not.toHaveBeenCalled();
  });

  it('skips records that are already initialized on-chain', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmart');
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });
    const initSpy = vi
      .spyOn(PermissionPreparationService, 'initializeRecordRole')
      .mockResolvedValue({ success: true, role: 'owner' } as any);

    await PermissionPreparationService.prepareBatch(['rec1']);

    expect(initSpy).not.toHaveBeenCalled();
    initSpy.mockRestore();
  });

  it('initializes uninitialized records, using the correct role from Firestore', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmart');
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 0,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });
    vi.mocked(getAuth).mockReturnValue({ currentUser: { uid: 'user1' } } as any);
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ owners: ['user1'] }),
    } as any);
    const initSpy = vi
      .spyOn(PermissionPreparationService, 'initializeRecordRole')
      .mockResolvedValue({ success: true, role: 'owner' } as any);

    await PermissionPreparationService.prepareBatch(['rec1']);

    expect(initSpy).toHaveBeenCalledWith('rec1', '0xSmart', 'owner');
    initSpy.mockRestore();
  });

  it("defaults to administrator when the caller is not in the record's owners array", async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmart');
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 0,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });
    vi.mocked(getAuth).mockReturnValue({ currentUser: { uid: 'user1' } } as any);
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ owners: ['someone-else'] }),
    } as any);
    const initSpy = vi
      .spyOn(PermissionPreparationService, 'initializeRecordRole')
      .mockResolvedValue({ success: true, role: 'administrator' } as any);

    await PermissionPreparationService.prepareBatch(['rec1']);

    expect(initSpy).toHaveBeenCalledWith('rec1', '0xSmart', 'administrator');
    initSpy.mockRestore();
  });

  it('throws an aggregated error when a record fails final verification', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmart');
    // Already initialized (skips init), but overall readiness still comes back false.
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(NOT_READY_STATUS as any);

    await expect(PermissionPreparationService.prepareBatch(['rec1'])).rejects.toThrow(
      'Preparation failed for 1 record(s): rec1'
    );
  });
});

describe('PermissionPreparationService.prepare', () => {
  it('skips initialization when the record is already initialized, then verifies readiness', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmart');
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 1,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(READY_STATUS as any);
    const initSpy = vi
      .spyOn(PermissionPreparationService, 'initializeRecordRole')
      .mockResolvedValue({ success: true, role: 'owner' } as any);

    await PermissionPreparationService.prepare('rec1', 'owner');

    expect(initSpy).not.toHaveBeenCalled();
    initSpy.mockRestore();
  });

  it('throws when verification still fails after initialization', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmart');
    vi.mocked(BlockchainRoleManagerService.getRecordRoleStats).mockResolvedValue({
      ownerCount: 0,
      adminCount: 0,
      sharerCount: 0,
      viewerCount: 0,
    });
    vi.mocked(BlockchainPreparationService.getStatus).mockResolvedValue(NOT_READY_STATUS as any);
    const initSpy = vi
      .spyOn(PermissionPreparationService, 'initializeRecordRole')
      .mockResolvedValue({ success: true, role: 'owner' } as any);

    await expect(PermissionPreparationService.prepare('rec1', 'owner')).rejects.toThrow(
      'Preparation completed but verification failed. Please try again.'
    );
    initSpy.mockRestore();
  });
});
