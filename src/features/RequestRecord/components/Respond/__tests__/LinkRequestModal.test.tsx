// @vitest-environment jsdom
//
// src/features/RequestRecord/components/Respond/__tests__/LinkRequestModal.test.tsx
//
// Regression test for the guest-fulfillment bug: RecordFull.tsx used to render this modal
// without an `isGuest` prop at all, so a guest always fell through to `linkExistingRecord` ->
// PermissionsService.grantRole, which throws for a guest (no wallet). This locks in that
// `isGuest={true}` routes to FulfillRequestService.fulfillAsGuest instead, and that the
// non-guest path still calls linkExistingRecord unchanged.
//
// Also covers the fire-and-forget handoff to OnChainActivityTray: the guest path blocks only on
// fulfillAsGuest (Firestore), then fires registerGuestFulfillmentOnChain without awaiting it; the
// non-guest path fires linkExistingRecord without awaiting it at all (no prep step exists for
// that flow). Both land on 'submitted' before their underlying promise settles.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { OnChainActivityTrayProvider } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';
import type { RecordRequest } from '@belrose/shared';
import type { FileObject } from '@/types/core';

// OnChainActivityTray — real provider, same as usePermissionFlow.test.tsx (just local React
// state, no external dependencies).
function wrapper({ children }: { children: ReactNode }) {
  return <OnChainActivityTrayProvider>{children}</OnChainActivityTrayProvider>;
}

const {
  useInboundRequestsMock,
  fulfillAsGuestMock,
  registerGuestFulfillmentOnChainMock,
  linkExistingRecordMock,
  getSessionKeyMock,
} = vi.hoisted(() => ({
  useInboundRequestsMock: vi.fn(),
  fulfillAsGuestMock: vi.fn(),
  registerGuestFulfillmentOnChainMock: vi.fn(),
  linkExistingRecordMock: vi.fn(),
  getSessionKeyMock: vi.fn(),
}));

vi.mock('../../../hooks/useInboundRequests', () => ({
  useInboundRequests: useInboundRequestsMock,
}));

vi.mock('../../../services/fulfillRequestService', () => ({
  FulfillRequestService: {
    fulfillAsGuest: fulfillAsGuestMock,
    registerGuestFulfillmentOnChain: registerGuestFulfillmentOnChainMock,
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
  fulfillAsGuestMock.mockResolvedValue('history-doc-1');
  registerGuestFulfillmentOnChainMock.mockResolvedValue(undefined);
  linkExistingRecordMock.mockResolvedValue(undefined);
});

describe('LinkRequestModal — isGuest routing', () => {
  it('calls fulfillAsGuest (not linkExistingRecord), then fires registerGuestFulfillmentOnChain with the returned history doc id, when isGuest is true', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <LinkRequestModal
        record={makeRecord()}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        isGuest
      />,
      { wrapper }
    );

    await user.click(screen.getByText('Jane Doe'));
    await user.click(screen.getByRole('button', { name: 'Fulfill request' }));

    expect(fulfillAsGuestMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCode: 'invite-1' }),
      'record-1'
    );
    expect(registerGuestFulfillmentOnChainMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCode: 'invite-1' }),
      'record-1',
      'history-doc-1',
      expect.objectContaining({
        addActivity: expect.any(Function),
        updateActivity: expect.any(Function),
      })
    );
    expect(linkExistingRecordMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it('calls linkExistingRecord (not fulfillAsGuest) for a non-guest, via the role-picker path', async () => {
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <LinkRequestModal record={makeRecord()} isOpen={true} onClose={vi.fn()} onSuccess={onSuccess} />,
      { wrapper }
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
    // onSuccess for the non-guest path fires only once the fire-and-forget grant settles.
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});

describe('LinkRequestModal — submitted phase', () => {
  it('shows submitted immediately for the non-guest path — before linkExistingRecord resolves — and "Got it" closes the modal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    // Never resolves during this test — proves the modal doesn't wait for it.
    linkExistingRecordMock.mockReturnValue(new Promise(() => {}));

    render(
      <LinkRequestModal record={makeRecord()} isOpen={true} onClose={onClose} onSuccess={vi.fn()} />,
      { wrapper }
    );

    await user.click(screen.getByText('Jane Doe'));
    await user.click(screen.getByRole('button', { name: 'Next: set access level' }));
    await user.click(screen.getByRole('button', { name: /Grant access to 1 requester/ }));

    expect(screen.getByText('Transaction Submitted')).toBeInTheDocument();
    expect(screen.getByText(/Granting Viewer access to Jane Doe/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
