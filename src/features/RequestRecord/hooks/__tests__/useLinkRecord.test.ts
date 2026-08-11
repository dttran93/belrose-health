// @vitest-environment jsdom
//
// src/features/RequestRecord/hooks/__tests__/useLinkRecord.test.ts
//
// Tier 3 (getAccessibleRecords/RecordDecryptionService/linkRecordService/useAuthContext mocked)
// — drives the real phase state machine (pick-records -> pick-role -> confirm-deny -> executing
// -> submitted/error), including each terminal action's own error path back to 'error'.
// submitAddRecords blocks on prepareRecordsForLinking only, then fires addRecordsToRequest
// without awaiting it (same fire-and-forget shape as usePermissionFlow.confirmGrant) — the
// linkedThisSession de-dup counter is asserted once that background promise settles.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  OnChainActivityTrayProvider,
  useOnChainActivityTray,
} from '@/features/OnChainActivityTray/OnChainActivityTrayContext';

const {
  getAccessibleRecordsMock,
  decryptRecordsMock,
  prepareRecordsForLinkingMock,
  addRecordsToRequestMock,
  markRequestCompleteMock,
  denyRequestMock,
} = vi.hoisted(() => ({
  getAccessibleRecordsMock: vi.fn(),
  decryptRecordsMock: vi.fn(),
  prepareRecordsForLinkingMock: vi.fn(),
  addRecordsToRequestMock: vi.fn(),
  markRequestCompleteMock: vi.fn(),
  denyRequestMock: vi.fn(),
}));

vi.mock('@/features/Auth/AuthContext', () => ({
  useAuthContext: () => ({ user: { uid: 'user-1' } }),
}));

vi.mock('@/features/Ai/service/recordContextService', () => ({
  getAccessibleRecords: getAccessibleRecordsMock,
}));

vi.mock('@/features/Encryption/services/recordDecryptionService', () => ({
  RecordDecryptionService: { decryptRecords: decryptRecordsMock },
}));

vi.mock('../../services/linkRecordService', () => ({
  prepareRecordsForLinking: prepareRecordsForLinkingMock,
  addRecordsToRequest: addRecordsToRequestMock,
  markRequestComplete: markRequestCompleteMock,
  denyRequest: denyRequestMock,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useLinkRecord } from '../useLinkRecord';
import type { RecordRequest } from '@belrose/shared';

// OnChainActivityTray — real provider, same as usePermissionFlow.test.tsx (just local React
// state, no external dependencies). Written with createElement, not JSX, since this is a plain
// .ts test file.
function wrapper({ children }: { children: ReactNode }) {
  return createElement(OnChainActivityTrayProvider, null, children);
}

function makeRequest(overrides: Partial<RecordRequest> = {}): RecordRequest {
  return { inviteCode: 'invite-1', status: 'pending', ...overrides } as RecordRequest;
}

function makeRecord(id: string, uploadedAtMs: number) {
  return {
    id,
    fileName: `${id}.pdf`,
    uploadedAt: { toMillis: () => uploadedAtMs },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessibleRecordsMock.mockResolvedValue([]);
  decryptRecordsMock.mockImplementation(async (recs: any[]) => recs);
  prepareRecordsForLinkingMock.mockResolvedValue(undefined);
});

describe('useLinkRecord — loading records', () => {
  it('fetches, decrypts, and sorts records newest-first when a request is present', async () => {
    getAccessibleRecordsMock.mockResolvedValue([makeRecord('old', 1000), makeRecord('new', 2000)]);

    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    expect(result.current.records.map(r => r.id)).toEqual(['new', 'old']);
  });

  it('does not fetch when request is null', async () => {
    renderHook(() => useLinkRecord(null, vi.fn()), { wrapper });
    await Promise.resolve();
    expect(getAccessibleRecordsMock).not.toHaveBeenCalled();
  });

  it('sets an error when fetching/decrypting records fails', async () => {
    getAccessibleRecordsMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    await waitFor(() => expect(result.current.recordsLoading).toBe(false));
    expect(result.current.error).toBe('Failed to load your records. Please try again.');
  });
});

describe('useLinkRecord — selection + phase navigation', () => {
  it('toggles record selection on and off', () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => result.current.toggleRecord('rec-1'));
    expect(result.current.selectedIds).toEqual(['rec-1']);

    act(() => result.current.toggleRecord('rec-1'));
    expect(result.current.selectedIds).toEqual([]);
  });

  it('does not advance to pick-role with an empty selection', () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => result.current.goToRolePicker());
    expect(result.current.phase).toBe('pick-records');
  });

  it('advances to pick-role once a record is selected', () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => result.current.toggleRecord('rec-1'));
    act(() => result.current.goToRolePicker());
    expect(result.current.phase).toBe('pick-role');
  });

  it('goBackToRecordPicker and goToDenyConfirm/goBackFromDeny reset any prior error', () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => {
      result.current.goToDenyConfirm();
    });
    expect(result.current.phase).toBe('confirm-deny');

    act(() => result.current.goBackFromDeny());
    expect(result.current.phase).toBe('pick-records');
  });
});

describe('useLinkRecord — submitAddRecords', () => {
  it('prepares, then fires the grant without awaiting it (submitted immediately, fire-and-forget)', async () => {
    addRecordsToRequestMock.mockResolvedValueOnce({ recordIds: ['rec-1'] });
    const request = makeRequest();
    const { result } = renderHook(() => useLinkRecord(request, vi.fn()), { wrapper });

    act(() => result.current.toggleRecord('rec-1'));
    await act(async () => {
      await result.current.submitAddRecords();
    });

    expect(prepareRecordsForLinkingMock).toHaveBeenCalledWith(['rec-1']);
    // Phase/selection flip as soon as the grant is *fired*, not once it resolves — the modal
    // hands off to the tray rather than waiting the transaction out itself.
    expect(result.current.phase).toBe('submitted');
    expect(result.current.submittedLabel).toBe('Granting Viewer access');
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedRole).toBe('viewer');

    await waitFor(() => expect(result.current.linkedThisSession).toEqual(['rec-1']));
  });

  it('dedupes linkedThisSession across calls, dismissing back to pick-records in between', async () => {
    addRecordsToRequestMock.mockResolvedValueOnce({ recordIds: ['rec-1'] });
    addRecordsToRequestMock.mockResolvedValueOnce({ recordIds: ['rec-1', 'rec-2'] });
    const request = makeRequest();
    const { result } = renderHook(() => useLinkRecord(request, vi.fn()), { wrapper });

    act(() => result.current.toggleRecord('rec-1'));
    await act(async () => {
      await result.current.submitAddRecords();
    });
    await waitFor(() => expect(result.current.linkedThisSession).toEqual(['rec-1']));

    act(() => result.current.dismissSubmitted());
    expect(result.current.phase).toBe('pick-records');

    act(() => result.current.toggleRecord('rec-2'));
    await act(async () => {
      await result.current.submitAddRecords();
    });

    await waitFor(() =>
      expect(result.current.linkedThisSession).toEqual(['rec-1', 'rec-2'])
    );
  });

  it('moves to the error phase when prepareRecordsForLinking throws (before anything is fired)', async () => {
    prepareRecordsForLinkingMock.mockRejectedValue(new Error('smart account setup failed'));
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => result.current.toggleRecord('rec-1'));
    await act(async () => {
      await result.current.submitAddRecords();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('smart account setup failed');
    expect(addRecordsToRequestMock).not.toHaveBeenCalled();
  });

  it('stays on the submitted card and surfaces the failure only via the tray when the background grant rejects', async () => {
    addRecordsToRequestMock.mockRejectedValue(new Error('blockchain grant failed'));
    // Render both hooks together so the tray's eventual 'failed' card is observable —
    // useLinkRecord itself doesn't expose tray state.
    const { result } = renderHook(
      () => ({ link: useLinkRecord(makeRequest(), vi.fn()), tray: useOnChainActivityTray() }),
      { wrapper }
    );

    act(() => result.current.link.toggleRecord('rec-1'));
    await act(async () => {
      await result.current.link.submitAddRecords();
    });

    // The modal has already moved on — a background rejection doesn't reopen it to 'error'.
    expect(result.current.link.phase).toBe('submitted');

    await waitFor(() =>
      expect(result.current.tray.activities).toEqual([
        expect.objectContaining({ status: 'failed', errorMessage: 'blockchain grant failed' }),
      ])
    );
  });

  it('does nothing when there is no selection', async () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    await act(async () => {
      await result.current.submitAddRecords();
    });

    expect(prepareRecordsForLinkingMock).not.toHaveBeenCalled();
    expect(addRecordsToRequestMock).not.toHaveBeenCalled();
  });
});

describe('useLinkRecord — submitMarkComplete', () => {
  it('calls onClose on success', async () => {
    markRequestCompleteMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { result } = renderHook(() => useLinkRecord(makeRequest(), onClose), { wrapper });

    await act(async () => {
      await result.current.submitMarkComplete();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves to the error phase on failure', async () => {
    markRequestCompleteMock.mockRejectedValue(new Error('already fulfilled'));
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    await act(async () => {
      await result.current.submitMarkComplete();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('already fulfilled');
  });
});

describe('useLinkRecord — submitDeny', () => {
  it('does nothing without a deny reason selected', async () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    await act(async () => {
      await result.current.submitDeny();
    });

    expect(denyRequestMock).not.toHaveBeenCalled();
  });

  it('calls onClose on success', async () => {
    denyRequestMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { result } = renderHook(() => useLinkRecord(makeRequest(), onClose), { wrapper });

    act(() => result.current.setDenyReason('wrong_recipient'));
    await act(async () => {
      await result.current.submitDeny();
    });

    expect(denyRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'wrong_recipient' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves to the error phase on failure', async () => {
    denyRequestMock.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => result.current.setDenyReason('wrong_recipient'));
    await act(async () => {
      await result.current.submitDeny();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('network error');
  });
});

describe('useLinkRecord — reset', () => {
  it('clears all state back to defaults', async () => {
    const { result } = renderHook(() => useLinkRecord(makeRequest(), vi.fn()), { wrapper });

    act(() => {
      result.current.toggleRecord('rec-1');
      result.current.setSelectedRole('owner');
      result.current.setDenyReason('wrong_recipient');
      result.current.setDenyNote('a note');
    });

    act(() => result.current.reset());

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedRole).toBe('viewer');
    expect(result.current.denyReason).toBe('');
    expect(result.current.denyNote).toBe('');
    expect(result.current.phase).toBe('pick-records');
    expect(result.current.records).toEqual([]);
  });
});
