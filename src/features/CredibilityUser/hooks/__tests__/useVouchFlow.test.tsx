// @vitest-environment jsdom
//
// src/features/CredibilityUser/hooks/__tests__/useVouchFlow.test.tsx
//
// Component/hook-tier test — see Permissions/hooks/__tests__/usePermissionFlow.test.tsx for the
// general rationale. vouchService and BlockchainPreparationService (the generic network-prep
// gate vouches use — unlike Permissions/Credibility, which have their own feature-specific
// preparation services) are mocked at the service boundary; OnChainActivityTrayProvider is used
// for real. Unlike usePermissionFlow/useCredibilityFlow, useVouchFlow has no dialogProps bundle
// — its consumer (VouchManagement) spreads its flat return fields directly onto
// VouchActionDialog.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OnChainActivityTrayProvider } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';

vi.mock('../../services/vouchService', () => ({
  createVouch: vi.fn(),
  retractVouch: vi.fn(),
  getVouch: vi.fn(),
}));

vi.mock('@/features/BlockchainWallet/services/blockchainPreparationService', () => ({
  BlockchainPreparationService: { ensureReady: vi.fn() },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useVouchFlow } from '../useVouchFlow';
import { createVouch, retractVouch, getVouch } from '../../services/vouchService';
import { BlockchainPreparationService } from '@/features/BlockchainWallet/services/blockchainPreparationService';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';

const TARGET_USER = 'target1';
const TARGET_NAME = 'Target User';

function wrapper({ children }: { children: ReactNode }) {
  return <OnChainActivityTrayProvider>{children}</OnChainActivityTrayProvider>;
}

function renderFlow(options: { onSuccess?: () => void } = {}) {
  return renderHook(
    () => useVouchFlow({ targetUserId: TARGET_USER, targetDisplayName: TARGET_NAME, ...options }),
    { wrapper }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuth).mockReturnValue({ currentUser: { uid: 'voucher1' } } as any);
  vi.mocked(getVouch).mockResolvedValue(null);
});

describe('useVouchFlow — initial fetch', () => {
  it('exposes retractAction (not initiateAction) once an active vouch is loaded', async () => {
    vi.mocked(getVouch).mockResolvedValue({ chainStatus: 'Active' } as any);
    const { result } = renderFlow();

    await waitFor(() => expect(result.current.isLoadingVouch).toBe(false));
    expect(result.current.isActiveVouch).toBe(true);
    expect(result.current.initiateAction).toBeUndefined();
    expect(result.current.retractAction).toBe(result.current.initiateRetract);
  });

  it('exposes initiateAction (not retractAction) when there is no active vouch', async () => {
    const { result } = renderFlow();

    await waitFor(() => expect(result.current.isLoadingVouch).toBe(false));
    expect(result.current.isActiveVouch).toBe(false);
    expect(result.current.initiateAction).toBe(result.current.initiateVouch);
    expect(result.current.retractAction).toBeUndefined();
  });
});

describe('useVouchFlow.initiateVouch', () => {
  it('errors immediately when not signed in, without touching network prep', async () => {
    vi.mocked(getAuth).mockReturnValue({ currentUser: null } as any);
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVouch();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('You must be signed in to vouch for users.');
    expect(BlockchainPreparationService.ensureReady).not.toHaveBeenCalled();
  });

  it('moves to confirming once the network is ready', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmartAccount');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVouch();
    });

    expect(result.current.phase).toBe('confirming');
    expect(result.current.operationType).toBe('vouch');
  });

  it('moves to error when network preparation fails', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockRejectedValue(
      new Error('no smart account')
    );
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVouch();
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('no smart account');
  });
});

describe('useVouchFlow.confirmVouch', () => {
  it('dispatches createVouch and moves to submitted immediately (fire-and-forget)', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmartAccount');
    vi.mocked(createVouch).mockResolvedValue('vouch-id');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVouch();
    });
    await act(async () => {
      result.current.confirmVouch();
    });

    expect(createVouch).toHaveBeenCalledWith('voucher1', TARGET_USER);
    expect(result.current.phase).toBe('submitted');
  });

  it('shows a success toast and refetches once the tx resolves', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmartAccount');
    vi.mocked(createVouch).mockResolvedValue('vouch-id');
    const onSuccess = vi.fn();
    const { result } = renderFlow({ onSuccess });

    await act(async () => {
      await result.current.initiateVouch();
    });
    await act(async () => {
      result.current.confirmVouch();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    expect(toast.success).toHaveBeenCalledWith(`Vouch for ${TARGET_NAME} submitted`);
  });

  it('surfaces a failure through the activity tray rather than throwing', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmartAccount');
    vi.mocked(createVouch).mockRejectedValue(new Error('chain reverted'));
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVouch();
    });
    await act(async () => {
      result.current.confirmVouch();
      await Promise.resolve().then(() => Promise.resolve());
    });

    expect(result.current.phase).toBe('submitted');
  });
});

describe('useVouchFlow.confirmRetract', () => {
  it('dispatches retractVouch for the target user', async () => {
    vi.mocked(getVouch).mockResolvedValue({ chainStatus: 'Active' } as any);
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmartAccount');
    vi.mocked(retractVouch).mockResolvedValue(undefined);
    const { result } = renderFlow();
    await waitFor(() => expect(result.current.isLoadingVouch).toBe(false));

    await act(async () => {
      await result.current.initiateRetract();
    });
    await act(async () => {
      result.current.confirmRetract();
    });

    expect(retractVouch).toHaveBeenCalledWith('voucher1', TARGET_USER);
    expect(result.current.phase).toBe('submitted');
  });
});

describe('useVouchFlow reset', () => {
  it('clears the phase back to idle', async () => {
    vi.mocked(BlockchainPreparationService.ensureReady).mockResolvedValue('0xSmartAccount');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVouch();
    });
    expect(result.current.phase).toBe('confirming');

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe('idle');
  });
});
