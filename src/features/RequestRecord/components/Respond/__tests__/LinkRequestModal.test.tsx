// @vitest-environment jsdom
//
// src/features/RequestRecord/components/Respond/__tests__/LinkRequestModal.test.tsx
//
// Regression test for the guest-fulfillment bug: RecordFull.tsx used to render this modal
// without an `isGuest` prop at all, so a guest always fell through to `linkExistingRecord` ->
// PermissionsService.grantRole, which throws for a guest (no wallet). This locks in that
// `isGuest={true}` routes to FulfillRequestService.fulfillAsGuest instead, and that the
// non-guest path still calls linkExistingRecord unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordRequest } from '@belrose/shared';
import type { FileObject } from '@/types/core';

const { useInboundRequestsMock, fulfillAsGuestMock, linkExistingRecordMock, getSessionKeyMock } =
  vi.hoisted(() => ({
    useInboundRequestsMock: vi.fn(),
    fulfillAsGuestMock: vi.fn(),
    linkExistingRecordMock: vi.fn(),
    getSessionKeyMock: vi.fn(),
  }));

vi.mock('../../../hooks/useInboundRequests', () => ({
  useInboundRequests: useInboundRequestsMock,
}));

vi.mock('../../../services/fulfillRequestService', () => ({
  FulfillRequestService: {
    fulfillAsGuest: fulfillAsGuestMock,
    linkExistingRecord: linkExistingRecordMock,
  },
}));

vi.mock('@/features/Encryption/services/encryptionKeyManager', () => ({
  EncryptionKeyManager: { getSessionKey: getSessionKeyMock },
}));

import LinkRequestModal from '../LinkRequestModal';

function makeRequest(overrides: Partial<RecordRequest> = {}): RecordRequest {
  return {
    inviteCode: 'invite-1',
    requesterId: 'requester-1',
    requesterName: 'Jane Doe',
    requesterEmail: 'jane@example.com',
    status: 'pending',
    createdAt: { toMillis: () => 1700000000000 },
    ...overrides,
  } as unknown as RecordRequest;
}

function makeRecord(overrides: Partial<FileObject> = {}): FileObject {
  return { id: 'record-1', fileName: 'Blood Panel.pdf', ...overrides } as FileObject;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionKeyMock.mockResolvedValue({} as CryptoKey);
  useInboundRequestsMock.mockReturnValue({ filtered: [makeRequest()], loading: false });
});

describe('LinkRequestModal — isGuest routing', () => {
  it('calls fulfillAsGuest (not linkExistingRecord) when isGuest is true', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    fulfillAsGuestMock.mockResolvedValue(undefined);

    render(
      <LinkRequestModal
        record={makeRecord()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        isGuest
      />
    );

    await user.click(screen.getByText('Jane Doe'));
    await user.click(screen.getByRole('button', { name: 'Fulfill request' }));

    expect(fulfillAsGuestMock).toHaveBeenCalledWith(expect.objectContaining({ inviteCode: 'invite-1' }), 'record-1');
    expect(linkExistingRecordMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it('calls linkExistingRecord (not fulfillAsGuest) for a non-guest, via the role-picker path', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    linkExistingRecordMock.mockResolvedValue(undefined);

    render(
      <LinkRequestModal record={makeRecord()} isOpen={true} onClose={vi.fn()} onSuccess={onSuccess} />
    );

    await user.click(screen.getByText('Jane Doe'));
    await user.click(screen.getByRole('button', { name: 'Next: set access level' }));
    await user.click(screen.getByRole('button', { name: /Grant access to 1 requester/ }));

    expect(linkExistingRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCode: 'invite-1' }),
      'record-1',
      'viewer'
    );
    expect(fulfillAsGuestMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });
});
