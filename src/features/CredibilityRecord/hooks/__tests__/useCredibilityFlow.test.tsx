// @vitest-environment jsdom
//
// src/features/CredibilityRecord/hooks/__tests__/useCredibilityFlow.test.tsx
//
// Component/hook-tier test — see Permissions/hooks/__tests__/usePermissionFlow.test.tsx for the
// general rationale (one rung cheaper than orchestration — no real Firestore/blockchain/emulator
// — but one rung more realistic than pure unit tests: a real React hook lifecycle via
// renderHook, real state transitions). verificationService, disputeService, and
// CredibilityPreparationService are mocked at the service boundary, same as the orchestration
// suite; OnChainActivityTrayProvider is used for real since it's just local React state with no
// external dependencies.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OnChainActivityTrayProvider } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';

vi.mock('../../services/verificationService', () => ({
  createVerification: vi.fn(),
  retractVerification: vi.fn(),
  modifyVerificationLevel: vi.fn(),
  getVerification: vi.fn(),
  getVerificationConfig: vi.fn(),
}));

vi.mock('../../services/disputeService', () => ({
  createDispute: vi.fn(),
  retractDispute: vi.fn(),
  modifyDispute: vi.fn(),
  getDispute: vi.fn(),
  getSeverityConfig: vi.fn(),
  getCulpabilityConfig: vi.fn(),
}));

vi.mock('../../services/credibilityPreparationService', () => ({
  CredibilityPreparationService: {
    verifyPrerequisites: vi.fn(),
    prepare: vi.fn(),
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useCredibilityFlow } from '../useCredibilityFlow';
import {
  createVerification,
  retractVerification,
  getVerification,
  getVerificationConfig,
} from '../../services/verificationService';
import { createDispute, getDispute, getSeverityConfig } from '../../services/disputeService';
import { CredibilityPreparationService } from '../../services/credibilityPreparationService';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';

const READY = { ready: true };
const NOT_READY_CALLER_READY = {
  ready: false,
  reason: 'No role on this record',
  checks: { callerReady: true, hasRecordRole: false },
};
const NOT_READY_CALLER_NOT_READY = {
  ready: false,
  reason: 'Network not ready',
  checks: { callerReady: false, hasRecordRole: false },
};

const RECORD_ID = 'rec1';
const RECORD_HASH = 'hash1';

function wrapper({ children }: { children: ReactNode }) {
  return <OnChainActivityTrayProvider>{children}</OnChainActivityTrayProvider>;
}

function renderFlow(options: { onSuccess?: () => void } = {}) {
  return renderHook(
    () => useCredibilityFlow({ recordId: RECORD_ID, recordHash: RECORD_HASH, ...options }),
    { wrapper }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuth).mockReturnValue({ currentUser: { uid: 'verifier1' } } as any);
  vi.mocked(getVerification).mockResolvedValue(null);
  vi.mocked(getDispute).mockResolvedValue(null);
  vi.mocked(getVerificationConfig).mockReturnValue({ name: 'Full' } as any);
  vi.mocked(getSeverityConfig).mockReturnValue({ name: 'Major' } as any);
});

describe('useCredibilityFlow — initial fetch', () => {
  it('loads existing verification/dispute state on mount', async () => {
    vi.mocked(getVerification).mockResolvedValue({ level: 2 } as any);
    const { result } = renderFlow();

    await waitFor(() => expect(result.current.isLoadingVerification).toBe(false));
    expect(result.current.verification).toEqual({ level: 2 });
    expect(result.current.dispute).toBeNull();
  });
});

describe('useCredibilityFlow.initiateVerification', () => {
  it('goes straight to confirming when prerequisites are already met', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVerification(2);
    });

    expect(result.current.phase).toBe('confirming');
    expect(CredibilityPreparationService.prepare).toHaveBeenCalled();
  });

  it('fails immediately (without preparing) when the caller cannot fix readiness themselves', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(
      NOT_READY_CALLER_READY as any
    );
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVerification(2);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('No role on this record');
    expect(CredibilityPreparationService.prepare).not.toHaveBeenCalled();
  });

  it('runs prepare() when not ready but the caller can fix it, then confirms', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(
      NOT_READY_CALLER_NOT_READY as any
    );
    vi.mocked(CredibilityPreparationService.prepare).mockResolvedValue('0xSmartAccount');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVerification(2);
    });

    expect(CredibilityPreparationService.prepare).toHaveBeenCalledWith(
      RECORD_ID,
      RECORD_HASH,
      expect.any(Function)
    );
    expect(result.current.phase).toBe('confirming');
  });
});

describe('useCredibilityFlow.confirmVerification', () => {
  it('dispatches createVerification and moves to submitted immediately (fire-and-forget)', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(createVerification).mockResolvedValue('verification-id');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVerification(3);
    });
    await act(async () => {
      result.current.dialogProps.onConfirmVerification(3);
    });

    expect(createVerification).toHaveBeenCalledWith(RECORD_ID, RECORD_HASH, 'verifier1', 3, undefined);
    expect(result.current.phase).toBe('submitted');
  });

  it('shows a success toast and refetches once the tx resolves', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(createVerification).mockResolvedValue('verification-id');
    const onSuccess = vi.fn();
    const { result } = renderFlow({ onSuccess });

    await act(async () => {
      await result.current.initiateVerification(3);
    });
    await act(async () => {
      result.current.dialogProps.onConfirmVerification(3);
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    expect(toast.success).toHaveBeenCalledWith('Record verified at Full level');
  });

  it('surfaces a failure through the activity tray rather than throwing or flipping the dialog to error', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(createVerification).mockRejectedValue(new Error('chain reverted'));
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVerification(3);
    });
    await act(async () => {
      result.current.dialogProps.onConfirmVerification(3);
      // Let the rejected txPromise's .catch() handler run.
      await Promise.resolve().then(() => Promise.resolve());
    });

    expect(result.current.phase).toBe('submitted');
  });
});

describe('useCredibilityFlow — retract and dispute dispatch', () => {
  it('confirmRetractVerification dispatches retractVerification with the pending hash', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(retractVerification).mockResolvedValue(undefined);
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateRetractVerification('stale-hash');
    });
    await act(async () => {
      result.current.dialogProps.onConfirmRetract();
    });

    expect(retractVerification).toHaveBeenCalledWith('stale-hash', 'verifier1');
  });

  it('confirmDispute dispatches createDispute with severity/culpability/notes', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    vi.mocked(createDispute).mockResolvedValue('dispute-id');
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateDispute(2, 3, 'incorrect dosage');
    });
    await act(async () => {
      result.current.dialogProps.onConfirmDispute();
    });

    expect(createDispute).toHaveBeenCalledWith(RECORD_ID, RECORD_HASH, 'verifier1', 2, 3, 'incorrect dosage');
  });
});

describe('useCredibilityFlow reset', () => {
  it('clears the phase and pending operation back to idle', async () => {
    vi.mocked(CredibilityPreparationService.verifyPrerequisites).mockResolvedValue(READY as any);
    const { result } = renderFlow();

    await act(async () => {
      await result.current.initiateVerification(2);
    });
    expect(result.current.phase).toBe('confirming');

    act(() => {
      result.current.dialogProps.onClose();
    });

    expect(result.current.phase).toBe('idle');
  });
});
