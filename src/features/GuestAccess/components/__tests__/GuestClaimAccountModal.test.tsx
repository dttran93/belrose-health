// @vitest-environment jsdom
//
// src/features/GuestAccess/components/__tests__/GuestClaimAccountModal.test.tsx
//
// Now that handleClaim's orchestration lives in GuestClaimService (see
// guestClaimService.test.ts for the full write-strategy coverage — atomic batch, Step 1c
// degradation, call order, etc.), this file only covers what's still genuinely the component's
// own job:
//   (a) handleCredentialsSubmit's own stale-guest-file-keys guard (fires before any crypto is
//       generated, independent of guestContext).
//   (b) handleClaim is a thin wrapper: it delegates to GuestClaimService.claimAccount, shows the
//       skipped-record toast / success toast / done step on resolve, and surfaces the error +
//       returns to the recovery step on reject.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const FAKE_MASTER_KEY = { fake: 'master-key' } as any;

const { mockAuthContextState, hasGuestFileKeysMock, generateEncryptionBundleMock, claimAccountMock } =
  vi.hoisted(() => ({
    mockAuthContextState: {
      user: null as any,
      refreshUser: vi.fn(async () => undefined),
    },
    hasGuestFileKeysMock: vi.fn(() => true),
    generateEncryptionBundleMock: vi.fn(),
    claimAccountMock: vi.fn(),
  }));

vi.mock('@/features/Auth/AuthContext', () => ({
  useAuthContext: () => mockAuthContextState,
}));

vi.mock('@/features/Encryption/services/encryptionKeyManager', () => ({
  EncryptionKeyManager: { hasGuestFileKeys: hasGuestFileKeysMock },
}));

vi.mock('@/features/Auth/services/accountEncryptionService', () => ({
  AccountEncryptionService: { generateEncryptionBundle: generateEncryptionBundleMock },
}));

vi.mock('@/features/GuestAccess/services/guestClaimService', () => ({
  GuestClaimService: { claimAccount: claimAccountMock },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { GuestClaimAccountModal } from '../GuestClaimAccountModal';
import { toast } from 'sonner';

function fakeBundle() {
  return {
    masterKey: FAKE_MASTER_KEY,
    encryptedMasterKey: 'enc-master-key',
    masterKeyIV: 'master-iv',
    masterKeySalt: 'master-salt',
    recoveryKey: 'word1 word2 ... word24',
    recoveryKeyHash: 'recovery-hash',
    publicKey: 'public-key',
    encryptedPrivateKey: 'enc-private-key',
    encryptedPrivateKeyIV: 'private-iv',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthContextState.user = { uid: 'guest-1', email: 'guest@example.com' };
  mockAuthContextState.refreshUser = vi.fn(async () => undefined);
  hasGuestFileKeysMock.mockReturnValue(true);
  generateEncryptionBundleMock.mockResolvedValue(fakeBundle());
  claimAccountMock.mockResolvedValue({ skippedRecordCount: 0 });
});

async function fillCredentialsAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('Jane'), 'Jane');
  await user.type(screen.getByPlaceholderText('Smith'), 'Doe');
  await user.type(screen.getByPlaceholderText('At least 8 characters'), 'password123');
  await user.type(screen.getByPlaceholderText('Repeat your password'), 'password123');
  await user.click(screen.getByRole('button', { name: /Continue/ }));
}

async function completeClaim(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Save Your Recovery Key');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Complete Registration' }));
}

describe('GuestClaimAccountModal — handleCredentialsSubmit guard', () => {
  it('blocks at credentials-submit time when sharing-context guest file keys are gone', async () => {
    hasGuestFileKeysMock.mockReturnValue(false);
    const user = userEvent.setup();
    render(<GuestClaimAccountModal isOpen onClose={() => {}} guestContext="sharing" />);

    await fillCredentialsAndSubmit(user);

    expect(await screen.findByText(/session has expired/)).toBeInTheDocument();
    expect(generateEncryptionBundleMock).not.toHaveBeenCalled();
  });

  it('does NOT block a record_request guest even with no guest file keys', async () => {
    hasGuestFileKeysMock.mockReturnValue(false);
    const user = userEvent.setup();
    render(<GuestClaimAccountModal isOpen onClose={() => {}} guestContext="record_request" />);

    await fillCredentialsAndSubmit(user);

    expect(await screen.findByText('Save Your Recovery Key')).toBeInTheDocument();
  });
});

describe('GuestClaimAccountModal — handleClaim delegates to GuestClaimService', () => {
  it('calls GuestClaimService.claimAccount with the right params and shows the done step on success', async () => {
    const user = userEvent.setup();
    render(<GuestClaimAccountModal isOpen onClose={() => {}} guestContext="sharing" />);
    await fillCredentialsAndSubmit(user);
    await completeClaim(user);

    expect(await screen.findByText('Welcome to Belrose!')).toBeInTheDocument();
    expect(claimAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        guestUid: 'guest-1',
        guestEmail: 'guest@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'password123',
        guestContext: 'sharing',
        cryptoData: expect.objectContaining({ masterKey: FAKE_MASTER_KEY }),
      }),
      expect.any(Function)
    );
    expect(toast.success).toHaveBeenCalledWith(
      'Welcome to Belrose!',
      expect.objectContaining({ description: expect.any(String) })
    );
  });

  it('shows the skipped-record toast when the service reports a nonzero skippedRecordCount', async () => {
    claimAccountMock.mockResolvedValue({ skippedRecordCount: 2 });
    const user = userEvent.setup();
    render(<GuestClaimAccountModal isOpen onClose={() => {}} guestContext="record_request" />);
    await fillCredentialsAndSubmit(user);
    await completeClaim(user);

    await screen.findByText('Welcome to Belrose!');
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("2 uploaded records couldn't be secured"),
      expect.anything()
    );
  });

  it("surfaces the service's error and returns to the recovery step on failure", async () => {
    claimAccountMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<GuestClaimAccountModal isOpen onClose={() => {}} guestContext="sharing" />);
    await fillCredentialsAndSubmit(user);
    await completeClaim(user);

    expect(await screen.findByText('boom')).toBeInTheDocument();
    // Still on the recovery step (not stuck on 'processing') — Complete Registration is
    // clickable again for a retry.
    expect(screen.getByRole('button', { name: 'Complete Registration' })).toBeInTheDocument();
  });
});
