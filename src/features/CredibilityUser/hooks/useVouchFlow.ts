// src/features/CredibilityUser/hooks/useVouchFlow.ts

import { useState, useCallback, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';
import { BlockchainPreparationService } from '@/features/BlockchainWallet/services/blockchainPreparationService';
import { createVouch, retractVouch, getVouch } from '../services/vouchService';
import { useOnChainActivityTray } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';
import { getUserFacingErrorMessage } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { VouchDoc } from '@belrose/shared';

// ============================================================================
// TYPES
// ============================================================================

export type VouchDialogPhase = 'idle' | 'preparing' | 'confirming' | 'submitted' | 'error';
export type VouchOperationType = 'vouch' | 'retract';

export interface UseVouchFlowOptions {
  targetUserId: string;
  targetDisplayName: string;
  onSuccess?: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useVouchFlow({ targetUserId, targetDisplayName, onSuccess }: UseVouchFlowOptions) {
  const [phase, setPhase] = useState<VouchDialogPhase>('idle');
  const [operationType, setOperationType] = useState<VouchOperationType>('vouch');
  const [error, setError] = useState<string | null>(null);
  const [existingVouch, setExistingVouch] = useState<VouchDoc | null>(null);
  const [isLoadingVouch, setIsLoadingVouch] = useState(true);

  const { addActivity, updateActivity } = useOnChainActivityTray();

  // ==========================================================================
  // FETCH EXISTING VOUCH
  // ==========================================================================

  const fetchVouch = useCallback(async () => {
    const auth = getAuth();
    const voucherId = auth.currentUser?.uid;
    if (!voucherId || !targetUserId) {
      setExistingVouch(null);
      setIsLoadingVouch(false);
      return;
    }
    setIsLoadingVouch(true);
    try {
      const vouch = await getVouch(voucherId, targetUserId);
      setExistingVouch(vouch);
    } catch {
      setExistingVouch(null);
    } finally {
      setIsLoadingVouch(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    fetchVouch();
  }, [fetchVouch]);

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
  }, []);

  const isActiveVouch = existingVouch?.chainStatus === 'Active';

  // ==========================================================================
  // VOUCH FLOW
  // ==========================================================================

  const initiateVouch = useCallback(async () => {
    const auth = getAuth();
    if (!auth.currentUser) {
      setError('You must be signed in to vouch for users.');
      setPhase('error');
      return;
    }

    setOperationType('vouch');
    setPhase('preparing');
    setError(null);

    try {
      await BlockchainPreparationService.ensureReady();
      setPhase('confirming');
    } catch (err) {
      const message = getUserFacingErrorMessage(err, 'Failed to prepare network');
      setError(message);
      setPhase('error');
    }
  }, []);

  const confirmVouch = useCallback(async () => {
    const auth = getAuth();
    const voucherId = auth.currentUser?.uid;
    if (!voucherId) {
      setError('You must be signed in to vouch for users.');
      setPhase('error');
      return;
    }

    const activityId = addActivity({
      label: `Vouching for ${targetDisplayName}`,
    });

    const txPromise = createVouch(voucherId, targetUserId);

    setPhase('submitted');

    txPromise
      .then(async () => {
        updateActivity(activityId, { status: 'confirmed' });
        toast.success(`Vouch for ${targetDisplayName} submitted`);
        await fetchVouch();
        onSuccess?.();
      })
      .catch(err => {
        const message = getUserFacingErrorMessage(err, 'Failed to submit vouch');
        updateActivity(activityId, { status: 'failed', errorMessage: message });
      });
  }, [targetUserId, targetDisplayName, addActivity, updateActivity, fetchVouch, onSuccess]);

  // ==========================================================================
  // RETRACT FLOW
  // ==========================================================================

  const initiateRetract = useCallback(async () => {
    const auth = getAuth();
    if (!auth.currentUser) {
      setError('You must be signed in to retract a vouch.');
      setPhase('error');
      return;
    }

    setOperationType('retract');
    setPhase('preparing');
    setError(null);

    try {
      await BlockchainPreparationService.ensureReady();
      setPhase('confirming');
    } catch (err) {
      const message = getUserFacingErrorMessage(err, 'Failed to prepare network');
      setError(message);
      setPhase('error');
    }
  }, []);

  const confirmRetract = useCallback(async () => {
    const auth = getAuth();
    const voucherId = auth.currentUser?.uid;
    if (!voucherId) {
      setError('You must be signed in to retract a vouch.');
      setPhase('error');
      return;
    }

    const activityId = addActivity({
      label: `Retracting vouch for ${targetDisplayName}`,
    });

    const txPromise = retractVouch(voucherId, targetUserId);

    setPhase('submitted');

    txPromise
      .then(async () => {
        updateActivity(activityId, { status: 'confirmed' });
        toast.success(`Vouch for ${targetDisplayName} retracted`);
        await fetchVouch();
        onSuccess?.();
      })
      .catch(err => {
        const message = getUserFacingErrorMessage(err, 'Failed to retract vouch');
        updateActivity(activityId, { status: 'failed', errorMessage: message });
      });
  }, [targetUserId, targetDisplayName, addActivity, updateActivity, fetchVouch, onSuccess]);

  // ==========================================================================
  // RETURN
  // ==========================================================================

  return {
    // Dialog control
    phase,
    operationType,
    error,
    reset,
    isDialogOpen: phase !== 'idle',

    // Vouch state
    existingVouch,
    isLoadingVouch,
    isActiveVouch,

    // Actions
    initiateVouch,
    confirmVouch,
    initiateRetract,
    confirmRetract,

    // Convenience: which action to initiate based on current state
    initiateAction: isActiveVouch ? undefined : initiateVouch,
    retractAction: isActiveVouch ? initiateRetract : undefined,

    // Refetch
    refetch: fetchVouch,
  };
}
