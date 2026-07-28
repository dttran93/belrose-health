// @vitest-environment jsdom
//
// src/features/RecordFollowUp/hooks/__tests__/useRecordFollowUps.test.ts
//
// Tier 3 — mocks every sub-hook/service this hook composes (useAuth, useReviewedByCurrentUser,
// useInboundRequests, useSubjectAlerts, SubjectPermissionService, firebase/firestore's fresh-
// subjects lookup) and drives the real followUpItems derivation: eligibility gating, the
// subject/subject-request/subject-rejection/verify/link-request conditions (including that
// subject-request and the base "tag a subject" item are mutually exclusive, not both shown),
// the isSubject exemption from verification, and the aggregate isLoading/refetch behavior.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const {
  useAuthMock,
  useReviewedByCurrentUserMock,
  useInboundRequestsMock,
  useSubjectAlertsMock,
  canManageRecordMock,
  getDocMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useReviewedByCurrentUserMock: vi.fn(),
  useInboundRequestsMock: vi.fn(),
  useSubjectAlertsMock: vi.fn(),
  canManageRecordMock: vi.fn(),
  getDocMock: vi.fn(),
}));

vi.mock('@/features/Auth/hooks/useAuth', () => ({ default: useAuthMock }));

vi.mock('@/features/Credibility/hooks/useReviewedByCurrentUser', () => ({
  useReviewedByCurrentUser: useReviewedByCurrentUserMock,
}));

vi.mock('@/features/RequestRecord/hooks/useInboundRequests', () => ({
  useInboundRequests: useInboundRequestsMock,
}));

vi.mock('@/features/Subject/hooks/useSubjectAlerts', () => ({
  useSubjectAlerts: useSubjectAlertsMock,
}));

vi.mock('@/features/Subject/services/subjectPermissionService', () => ({
  default: { canManageRecord: canManageRecordMock },
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: getDocMock,
}));

import { useRecordFollowUps } from '../useRecordFollowUps';
import type { FileObject } from '@/types/core';

function makeFile(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 'record-1',
    firestoreId: 'record-1',
    fileSize: 100,
    fileType: 'application/pdf',
    administrators: ['uploader-1'],
    status: 'completed',
    subjects: [],
    ...overrides,
  } as FileObject;
}

function defaultMocks() {
  useAuthMock.mockReturnValue({ user: { uid: 'user-1' } });
  useReviewedByCurrentUserMock.mockReturnValue({
    hasReviewed: false,
    reviewedCurrentVersion: false,
    isLoading: false,
    refetch: vi.fn(),
  });
  useInboundRequestsMock.mockReturnValue({ requests: [], loading: false, refresh: vi.fn() });
  useSubjectAlertsMock.mockReturnValue({
    hasSubjectRequest: false,
    hasPendingRejectionResponse: false,
    isLoading: false,
    refetch: vi.fn(),
  });
  canManageRecordMock.mockReturnValue(false);
  getDocMock.mockResolvedValue({ exists: () => false });
}

beforeEach(() => {
  vi.clearAllMocks();
  defaultMocks();
});

describe('useRecordFollowUps — eligibility gating', () => {
  it('returns no items when the record is not completed', async () => {
    const { result } = renderHook(() => useRecordFollowUps(makeFile({ status: 'processing' })));
    expect(result.current.followUpItems).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns no items when the record has neither id nor firestoreId', async () => {
    const { result } = renderHook(() =>
      useRecordFollowUps(makeFile({ id: '', firestoreId: undefined }))
    );
    expect(result.current.followUpItems).toEqual([]);
  });

  it('is loading while any of review/requests/alerts is loading, and shows no items meanwhile', () => {
    useInboundRequestsMock.mockReturnValue({ requests: [], loading: true, refresh: vi.fn() });
    canManageRecordMock.mockReturnValue(true);

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.followUpItems).toEqual([]);
  });
});

describe('useRecordFollowUps — subject item', () => {
  it('shows "Tag a subject" when no subject is set and the caller can manage the record', async () => {
    canManageRecordMock.mockReturnValue(true);
    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.followUpItems.some(i => i.id === 'subject')).toBe(true));
  });

  it('does not show "Tag a subject" when the caller cannot manage the record', async () => {
    canManageRecordMock.mockReturnValue(false);
    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.followUpItems.some(i => i.id === 'subject')).toBe(false);
  });

  it('does not show "Tag a subject" once a subject is already set', async () => {
    canManageRecordMock.mockReturnValue(true);
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ subjects: ['patient-1'] }) });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    // isLoading doesn't depend on the async fresh-subjects fetch, so wait on the actual
    // condition (once getDoc resolves and the memo recomputes) rather than on isLoading.
    await waitFor(() => expect(getDocMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(result.current.followUpItems.some(i => i.id === 'subject')).toBe(false)
    );
  });

  it('shows "Respond to subject request" instead of "Tag a subject" when the user has a pending invite', async () => {
    canManageRecordMock.mockReturnValue(true);
    useSubjectAlertsMock.mockReturnValue({
      hasSubjectRequest: true,
      hasPendingRejectionResponse: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ids = result.current.followUpItems.map(i => i.id);
    expect(ids).toContain('subject-request');
    expect(ids).not.toContain('subject'); // mutually exclusive with the base "tag a subject" prompt
  });

  it('shows "Respond to subject rejection" when there is a pending rejection response', async () => {
    useSubjectAlertsMock.mockReturnValue({
      hasSubjectRequest: false,
      hasPendingRejectionResponse: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.followUpItems.some(i => i.id === 'subject-rejection')).toBe(true);
  });
});

describe('useRecordFollowUps — verification item', () => {
  it('shows "Verify this record" when the user has never reviewed it', async () => {
    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const verify = result.current.followUpItems.find(i => i.id === 'verify');
    expect(verify?.label).toBe('Verify this record');
  });

  it('shows "Re-verify this record" when reviewed but not the current version', async () => {
    useReviewedByCurrentUserMock.mockReturnValue({
      hasReviewed: true,
      reviewedCurrentVersion: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const verify = result.current.followUpItems.find(i => i.id === 'verify');
    expect(verify?.label).toBe('Re-verify this record');
  });

  it('shows no verify item once reviewed at the current version', async () => {
    useReviewedByCurrentUserMock.mockReturnValue({
      hasReviewed: true,
      reviewedCurrentVersion: true,
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.followUpItems.some(i => i.id === 'verify')).toBe(false);
  });

  it('never shows a verify item for the record subject themselves', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ subjects: ['user-1'] }) });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(getDocMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.followUpItems.some(i => i.id === 'verify')).toBe(false));
  });
});

describe('useRecordFollowUps — link-request item', () => {
  it('shows "Relate to a request" when the user has a pending inbound request', async () => {
    useInboundRequestsMock.mockReturnValue({
      requests: [{ status: 'pending' }],
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.followUpItems.some(i => i.id === 'link-request')).toBe(true);
  });

  it('does not show it when inbound requests exist but none are pending', async () => {
    useInboundRequestsMock.mockReturnValue({
      requests: [{ status: 'fulfilled' }],
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.followUpItems.some(i => i.id === 'link-request')).toBe(false);
  });
});

describe('useRecordFollowUps — guest gating', () => {
  it('shows only "Relate to a request" for a guest, even when subject/verify would otherwise apply', async () => {
    useAuthMock.mockReturnValue({ user: { uid: 'guest-1', isGuest: true } });
    canManageRecordMock.mockReturnValue(true);
    useInboundRequestsMock.mockReturnValue({
      requests: [{ status: 'pending' }],
      loading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.followUpItems.map(i => i.id)).toEqual(['link-request']);
  });

  it('shows no items for a guest with no pending inbound requests', async () => {
    useAuthMock.mockReturnValue({ user: { uid: 'guest-1', isGuest: true } });
    canManageRecordMock.mockReturnValue(true);

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.followUpItems).toEqual([]);
  });
});

describe('useRecordFollowUps — onAction wiring', () => {
  it('invokes the provided onAction with the fileItem and item id when a CTA fires', async () => {
    canManageRecordMock.mockReturnValue(true);
    const onAction = vi.fn();
    const file = makeFile();

    const { result } = renderHook(() => useRecordFollowUps(file, { onAction }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const subjectItem = result.current.followUpItems.find(i => i.id === 'subject');
    subjectItem?.onAction();
    expect(onAction).toHaveBeenCalledWith(file, 'subject');
  });
});

describe('useRecordFollowUps — refetch', () => {
  it('delegates to every sub-hook refetch', async () => {
    const refetchReview = vi.fn();
    const refetchAlerts = vi.fn();
    const refetchRequests = vi.fn();
    useReviewedByCurrentUserMock.mockReturnValue({
      hasReviewed: false,
      reviewedCurrentVersion: false,
      isLoading: false,
      refetch: refetchReview,
    });
    useSubjectAlertsMock.mockReturnValue({
      hasSubjectRequest: false,
      hasPendingRejectionResponse: false,
      isLoading: false,
      refetch: refetchAlerts,
    });
    useInboundRequestsMock.mockReturnValue({ requests: [], loading: false, refresh: refetchRequests });

    const { result } = renderHook(() => useRecordFollowUps(makeFile()));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.refetch());

    expect(refetchReview).toHaveBeenCalledTimes(1);
    expect(refetchAlerts).toHaveBeenCalledTimes(1);
    expect(refetchRequests).toHaveBeenCalledTimes(1);
  });
});
