// @vitest-environment jsdom
//
// src/features/Subject/hooks/__tests__/useSubjectFlow.test.tsx
//
// useSubjectFlow is the Subject feature's equivalent of usePermissionFlow — same tier, much
// larger surface (selecting/searching/preparing/confirming across 6 operation variants,
// controller-anchor short-circuit, revoke-access-on-removal toggle). Every service it calls is
// mocked at the module boundary (each already has its own dedicated test suite); this test is
// about the hook's own phase/state machine and the grant/revoke decisions it makes based on
// ROLE_HIERARCHY comparisons.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OnChainActivityTrayProvider } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';
import type { BelroseUserProfile, FileObject } from '@/types/core';

const { mockCurrentUser, subjectQueryMocks } = vi.hoisted(() => ({
  mockCurrentUser: { uid: 'caller1' as string | null },
  subjectQueryMocks: {
    getRecordSubjects: vi.fn(),
    getIncomingConsentRequests: vi.fn(),
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockCurrentUser.uid ? { uid: mockCurrentUser.uid } : null }),
}));

vi.mock('../../services/subjectPreparationService', () => ({
  SubjectPreparationService: {
    verifyPrerequisites: vi.fn(),
    verifyAcceptPrerequisites: vi.fn(),
    verifyRemovePrerequisites: vi.fn(),
    prepare: vi.fn(),
  },
}));

vi.mock('../../services/subjectService', () => ({
  SubjectService: {
    setSubjectAsSelf: vi.fn(),
    requestSubjectConsent: vi.fn(),
    acceptSubjectRequest: vi.fn(),
    rejectSubjectRequest: vi.fn(),
    rejectSubjectStatus: vi.fn(),
    anchorSubjectAsController: vi.fn(),
  },
}));

vi.mock('@/features/Permissions/services/permissionsService', () => ({
  PermissionsService: {
    grantRole: vi.fn(),
    removeRole: vi.fn(),
  },
}));

vi.mock('../../services/subjectQueryService', () => ({
  default: subjectQueryMocks,
  SubjectQueryService: subjectQueryMocks,
}));

vi.mock('@/features/Trustee/services/trusteeRelationshipService', () => ({
  TrusteeRelationshipService: {
    getActiveControllerTrustors: vi.fn(),
    getControllerRelationshipWith: vi.fn(),
  },
}));

vi.mock('@/features/CredibilityRecord/services/credibilityPreparationService', () => ({
  CredibilityPreparationService: {
    prepare: vi.fn(),
  },
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useSubjectFlow } from '../useSubjectFlow';
import { SubjectPreparationService } from '../../services/subjectPreparationService';
import { SubjectService } from '../../services/subjectService';
import { PermissionsService } from '@/features/Permissions/services/permissionsService';
import { TrusteeRelationshipService } from '@/features/Trustee/services/trusteeRelationshipService';
import { getDoc } from 'firebase/firestore';
import { toast } from 'sonner';

const READY = { ready: true, checks: { callerReady: true, recordInitialized: true } };
const NOT_READY = { ready: false, reason: 'Not ready yet', checks: { callerReady: false, recordInitialized: false } };

function makeRecord(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 'rec1',
    owners: [],
    administrators: [],
    sharers: [],
    subjects: [],
    ...overrides,
  } as unknown as FileObject;
}

function makeUser(overrides: Partial<BelroseUserProfile> = {}): BelroseUserProfile {
  return { uid: 'target1', displayName: 'Target', ...overrides } as BelroseUserProfile;
}

function wrapper({ children }: { children: ReactNode }) {
  return <OnChainActivityTrayProvider>{children}</OnChainActivityTrayProvider>;
}

function setCaller(uid: string | null) {
  mockCurrentUser.uid = uid;
}

beforeEach(() => {
  vi.resetAllMocks();
  setCaller('caller1');
  subjectQueryMocks.getRecordSubjects.mockResolvedValue([]);
  subjectQueryMocks.getIncomingConsentRequests.mockResolvedValue([]);
  vi.mocked(getDoc).mockResolvedValue({ exists: () => false, data: () => undefined } as any);
});

describe('useSubjectFlow — initial status fetch', () => {
  it('loads current subjects and incoming requests on mount', async () => {
    subjectQueryMocks.getRecordSubjects.mockResolvedValue(['caller1']);
    subjectQueryMocks.getIncomingConsentRequests.mockResolvedValue([
      { id: 'req1', recordId: 'rec1' } as any,
    ]);

    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    expect(result.current.isSubject).toBe(true);
    expect(result.current.currentSubjects).toEqual(['caller1']);
    expect(result.current.hasPendingRequest).toBe(true);
  });

  it('resolves to not-a-subject and no queries when there is no authenticated user', async () => {
    setCaller(null);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    expect(result.current.isSubject).toBe(false);
    expect(result.current.isLoadingStatus).toBe(false);
    expect(subjectQueryMocks.getRecordSubjects).not.toHaveBeenCalled();
  });
});

describe('useSubjectFlow.initiateAddSubject', () => {
  it('pre-selects the minimum allowed role based on the caller\'s current role', async () => {
    const record = makeRecord({ administrators: ['caller1'] });
    const { result } = renderHook(() => useSubjectFlow({ record }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
    });

    expect(result.current.dialogProps.selectedRole).toBe('administrator');
    expect(result.current.dialogProps.phase).toBe('selecting');
  });

  it('defaults subjectChoice to "other" when the caller is already a subject', async () => {
    subjectQueryMocks.getRecordSubjects.mockResolvedValue(['caller1']);
    const record = makeRecord({ subjects: ['caller1'] });
    const { result } = renderHook(() => useSubjectFlow({ record }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
    });

    expect(result.current.dialogProps.subjectChoice).toBe('other');
  });
});

describe('useSubjectFlow.proceedFromSelection — self path', () => {
  it('moves straight to confirming when prerequisites are already met', async () => {
    vi.mocked(SubjectPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
    });
    await act(async () => {
      await result.current.dialogProps.onProceedFromSelection();
    });

    expect(result.current.dialogProps.phase).toBe('confirming');
    expect(SubjectPreparationService.prepare).not.toHaveBeenCalled();
  });

  it('moves to error when preparation fails', async () => {
    vi.mocked(SubjectPreparationService.verifyPrerequisites).mockResolvedValue(NOT_READY as any);
    vi.mocked(SubjectPreparationService.prepare).mockResolvedValue('0xSmart');
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
    });
    await act(async () => {
      await result.current.dialogProps.onProceedFromSelection();
    });

    expect(result.current.dialogProps.phase).toBe('error');
    expect(result.current.error).toBe('Not ready yet');
  });
});

describe('useSubjectFlow.proceedFromSelection — other path', () => {
  it('loads controller trustor ids and moves to searching', async () => {
    vi.mocked(TrusteeRelationshipService.getActiveControllerTrustors).mockResolvedValue([
      { trustorId: 'trustor1' } as any,
    ]);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
      result.current.dialogProps.setSubjectChoice('other');
    });
    await act(async () => {
      await result.current.dialogProps.onProceedFromSelection();
    });

    expect(result.current.dialogProps.phase).toBe('searching');
    expect(result.current.dialogProps.controllerTrustorIds.has('trustor1')).toBe(true);
  });
});

describe('useSubjectFlow.selectUserAndProceed', () => {
  it('flags isControllerOfSelected when an active controller relationship exists', async () => {
    vi.mocked(TrusteeRelationshipService.getControllerRelationshipWith).mockResolvedValue({
      trustorId: 'target1',
    } as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.dialogProps.onSelectUser(makeUser());
    });

    expect(result.current.dialogProps.isControllerOfSelected).toBe(true);
    expect(result.current.dialogProps.phase).toBe('confirming');
  });

  it('leaves isControllerOfSelected false when there is no relationship', async () => {
    vi.mocked(TrusteeRelationshipService.getControllerRelationshipWith).mockResolvedValue(null as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.dialogProps.onSelectUser(makeUser());
    });

    expect(result.current.dialogProps.isControllerOfSelected).toBe(false);
  });
});

describe('useSubjectFlow.confirmSetSubjectAsSelf', () => {
  it('fires the tx, closes to submitted immediately, and grants the higher role in the background', async () => {
    vi.mocked(SubjectPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(SubjectService.setSubjectAsSelf).mockResolvedValue({
      success: true,
      recordId: 'rec1',
      subjectId: 'caller1',
    } as any);
    const record = makeRecord(); // caller currently has no role at all
    const { result } = renderHook(() => useSubjectFlow({ record }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
      result.current.dialogProps.setSelectedRole('administrator');
    });
    await act(async () => {
      await result.current.dialogProps.onProceedFromSelection();
    });
    await act(async () => {
      result.current.dialogProps.onConfirmSetSubjectAsSelf();
    });

    expect(result.current.dialogProps.phase).toBe('submitted');
    await act(async () => {});
    expect(PermissionsService.grantRole).toHaveBeenCalledWith('rec1', 'caller1', 'administrator');
  });

  it('does not grant a role when the caller already holds an equal or higher role', async () => {
    vi.mocked(SubjectPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(SubjectService.setSubjectAsSelf).mockResolvedValue({ success: true } as any);
    const record = makeRecord({ owners: ['caller1'] }); // already owner — the highest tier
    const { result } = renderHook(() => useSubjectFlow({ record }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
    });
    await act(async () => {
      await result.current.dialogProps.onProceedFromSelection();
    });
    await act(async () => {
      result.current.dialogProps.onConfirmSetSubjectAsSelf();
      await Promise.resolve();
    });

    expect(PermissionsService.grantRole).not.toHaveBeenCalled();
  });
});

describe('useSubjectFlow.confirmAnchorSubjectAsController', () => {
  it('sets an error when the controller relationship no longer exists at confirm time', async () => {
    vi.mocked(TrusteeRelationshipService.getControllerRelationshipWith)
      .mockResolvedValueOnce({ trustorId: 'target1' } as any) // at selection time
      .mockResolvedValueOnce(null as any); // re-verified at confirm time — now gone
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.dialogProps.onSelectUser(makeUser());
    });
    await act(async () => {
      await result.current.dialogProps.onConfirmAnchorSubjectAsController();
    });

    expect(result.current.dialogProps.phase).toBe('error');
    expect(result.current.error).toMatch(/no longer exists/);
    expect(SubjectService.anchorSubjectAsController).not.toHaveBeenCalled();
  });

  it('anchors when the relationship still holds', async () => {
    vi.mocked(TrusteeRelationshipService.getControllerRelationshipWith).mockResolvedValue({
      trustorId: 'target1',
    } as any);
    vi.mocked(SubjectService.anchorSubjectAsController).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.dialogProps.onSelectUser(makeUser());
    });
    await act(async () => {
      await result.current.dialogProps.onConfirmAnchorSubjectAsController();
    });

    expect(SubjectService.anchorSubjectAsController).toHaveBeenCalledWith('rec1', 'target1', 'sharer');
    expect(result.current.dialogProps.phase).toBe('submitted');
  });
});

describe('useSubjectFlow.initiateAcceptRequest / confirmAcceptRequest', () => {
  it('runs accept-specific preparation, then confirms via SubjectService.acceptSubjectRequest', async () => {
    vi.mocked(SubjectPreparationService.verifyAcceptPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(SubjectService.acceptSubjectRequest).mockResolvedValue({ success: true } as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.initiateAcceptRequest();
    });
    expect(result.current.dialogProps.phase).toBe('confirming');

    await act(async () => {
      result.current.dialogProps.onConfirmAcceptRequest();
    });

    expect(SubjectService.acceptSubjectRequest).toHaveBeenCalledWith('rec1');
    expect(result.current.dialogProps.phase).toBe('submitted');
  });
});

describe('useSubjectFlow.initiateRejectRequest / confirmRejectRequest', () => {
  it('goes straight to confirming with no preparation step', async () => {
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateRejectRequest('not me');
    });

    expect(result.current.dialogProps.phase).toBe('confirming');
    expect(SubjectPreparationService.verifyAcceptPrerequisites).not.toHaveBeenCalled();
  });

  it('revokes the granted role in the background when access was granted with the request', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ grantedAccessOnSubjectRequest: true, requestedSubjectRole: 'sharer' }),
    } as any);
    vi.mocked(SubjectService.rejectSubjectRequest).mockResolvedValue({ success: true } as any);
    vi.mocked(PermissionsService.removeRole).mockResolvedValue(undefined as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateRejectRequest();
    });
    await act(async () => {
      await result.current.dialogProps.onConfirmRejectRequest('not me');
    });

    expect(result.current.dialogProps.phase).toBe('submitted');
    await act(async () => {});
    expect(PermissionsService.removeRole).toHaveBeenCalledWith('rec1', 'caller1', 'sharer');
  });

  it('resets synchronously with no background work when no access was granted', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ grantedAccessOnSubjectRequest: false }),
    } as any);
    vi.mocked(SubjectService.rejectSubjectRequest).mockResolvedValue({ success: true } as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateRejectRequest();
    });
    await act(async () => {
      await result.current.dialogProps.onConfirmRejectRequest('not me');
    });

    expect(PermissionsService.removeRole).not.toHaveBeenCalled();
    expect(result.current.dialogProps.phase).toBe('idle');
  });
});

describe('useSubjectFlow.initiateRemoveSubjectStatus / confirmRemoveSubjectStatus', () => {
  it('runs remove-specific preparation before confirming', async () => {
    vi.mocked(SubjectPreparationService.verifyRemovePrerequisites).mockResolvedValue(READY as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.initiateRemoveSubjectStatus();
    });

    expect(result.current.dialogProps.phase).toBe('confirming');
  });

  it('revokes access in the background when revokeAccess is on and access had been granted', async () => {
    vi.mocked(SubjectPreparationService.verifyRemovePrerequisites).mockResolvedValue(READY as any);
    vi.mocked(SubjectService.rejectSubjectStatus).mockResolvedValue({
      success: true,
      pendingCreatorDecision: false,
    } as any);
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ grantedAccessOnSubjectRequest: true, requestedSubjectRole: 'sharer' }),
    } as any);
    vi.mocked(PermissionsService.removeRole).mockResolvedValue(undefined as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.initiateRemoveSubjectStatus();
    });
    await act(async () => {
      await result.current.dialogProps.onConfirmRemoveSubjectStatus('privacy');
    });

    await act(async () => {});
    expect(PermissionsService.removeRole).toHaveBeenCalledWith('rec1', 'caller1', 'sharer');
    expect(toast.success).toHaveBeenCalledWith(
      'You have been removed as a subject and your access has been revoked'
    );
  });

  it('does not revoke access when revokeAccess has been toggled off', async () => {
    vi.mocked(SubjectPreparationService.verifyRemovePrerequisites).mockResolvedValue(READY as any);
    vi.mocked(SubjectService.rejectSubjectStatus).mockResolvedValue({
      success: true,
      pendingCreatorDecision: false,
    } as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.initiateRemoveSubjectStatus();
      result.current.dialogProps.setRevokeAccess(false);
    });
    await act(async () => {
      await result.current.dialogProps.onConfirmRemoveSubjectStatus('privacy');
    });

    await act(async () => {});
    expect(PermissionsService.removeRole).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });
});

describe('useSubjectFlow.initiateAddSubjectAsSelf', () => {
  it('is a no-op when the caller is already a subject', async () => {
    subjectQueryMocks.getRecordSubjects.mockResolvedValue(['caller1']);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.initiateAddSubjectAsSelf();
    });

    expect(result.current.dialogProps.phase).toBe('idle');
    expect(SubjectPreparationService.verifyPrerequisites).not.toHaveBeenCalled();
  });

  it('sets role to owner and proceeds to confirming', async () => {
    vi.mocked(SubjectPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.initiateAddSubjectAsSelf();
    });

    expect(result.current.dialogProps.selectedRole).toBe('owner');
    expect(result.current.dialogProps.phase).toBe('confirming');
  });
});

describe('useSubjectFlow reset', () => {
  it('clears phase and selection state back to defaults', async () => {
    vi.mocked(SubjectPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    const { result } = renderHook(() => useSubjectFlow({ record: makeRecord() }), { wrapper });
    await act(async () => {});

    act(() => {
      result.current.initiateAddSubject();
    });
    await act(async () => {
      await result.current.dialogProps.onProceedFromSelection();
    });
    expect(result.current.dialogProps.phase).toBe('confirming');

    act(() => {
      result.current.dialogProps.onClose();
    });

    expect(result.current.dialogProps.phase).toBe('idle');
    expect(result.current.dialogProps.selectedUser).toBeNull();
  });
});
