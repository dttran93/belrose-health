// src/features/RequestRecord/hooks/useLinkRecord.ts

/**
 * useLinkRecord
 *
 * Drives the LinkRecordModal. Phases:
 *
 *   pick-records  — multi-select from accessible records
 *   pick-role     — choose Viewer / Admin / Owner for all selected records
 *   confirm-deny  — select deny reason + optional note
 *   executing     — blocks only on prepareRecordsForLinking (local smart-account setup)
 *   submitted     — grant tx has been fired (not awaited) and handed to OnChainActivityTray;
 *                   auto-dismisses back to pick-records after a few seconds
 *   error         — preparation failed, can retry or cancel
 *
 * submitAddRecords blocks the UI on prepareRecordsForLinking only — once that resolves, the
 * actual grantRoleBatch transaction (addRecordsToRequest) fires without being awaited, tracked
 * via OnChainActivityTray instead of a second blocking spinner. Same fire-and-forget shape as
 * usePermissionFlow.confirmGrant.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/features/Auth/AuthContext';
import { getAccessibleRecords } from '@/features/Ai/service/recordContextService';
import { FileObject } from '@/types/core';
import { Role } from '@/features/Permissions/services/permissionsService';
import { RecordDecryptionService } from '@/features/Encryption/services/recordDecryptionService';
import {
  prepareRecordsForLinking,
  addRecordsToRequest,
  markRequestComplete,
  denyRequest,
} from '../services/linkRecordService';
import { DenyReasonValue } from '../services/fulfillRequestService';
import { RecordRequest } from '@belrose/shared';
import { useOnChainActivityTray } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';
import { getUserFacingErrorMessage } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';

export type LinkPhase =
  | 'pick-records'
  | 'pick-role'
  | 'confirm-deny'
  | 'executing'
  | 'submitted'
  | 'error';

const roleLabels: Record<Role, string> = {
  viewer: 'Viewer',
  sharer: 'Sharer',
  administrator: 'Administrator',
  owner: 'Owner',
};

interface UseLinkRecordReturn {
  // Records
  records: FileObject[];
  recordsLoading: boolean;

  // Selection
  selectedIds: string[];
  toggleRecord: (id: string) => void;
  /** Replace the entire selection at once — used by RecordPickerContent */
  setSelectedIds: (ids: string[]) => void;
  clearSelection: () => void;

  // Role
  selectedRole: Role;
  setSelectedRole: (r: Role) => void;

  // Deny
  denyReason: DenyReasonValue | '';
  setDenyReason: (r: DenyReasonValue) => void;
  denyNote: string;
  setDenyNote: (n: string) => void;

  // Phase
  phase: LinkPhase;
  error: string | null;
  /** Label shown on the 'submitted' success card (OnChainSubmittedContent) */
  submittedLabel: string;

  // Linked so far in this session (for the "X records linked" counter)
  linkedThisSession: string[];

  // Actions
  goToRolePicker: () => void;
  goBackToRecordPicker: () => void;
  dismissSubmitted: () => void;
  goToDenyConfirm: () => void;
  goBackFromDeny: () => void;
  submitAddRecords: () => Promise<void>;
  submitMarkComplete: () => Promise<void>;
  submitDeny: () => Promise<void>;
  reset: () => void;
}

export function useLinkRecord(
  request: RecordRequest | null,
  onClose: () => void
): UseLinkRecordReturn {
  const { user } = useAuthContext();

  // OnChainActivityTray — surfaces the grant transaction in the bottom-right tray, same as
  // usePermissionFlow, while this modal still blocks on it via the 'executing' phase.
  const { addActivity, updateActivity } = useOnChainActivityTray();

  const [records, setRecords] = useState<FileObject[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role>('viewer');
  const [denyReason, setDenyReason] = useState<DenyReasonValue | ''>('');
  const [denyNote, setDenyNote] = useState('');
  const [phase, setPhase] = useState<LinkPhase>('pick-records');
  const [error, setError] = useState<string | null>(null);
  const [linkedThisSession, setLinkedThisSession] = useState<string[]>([]);
  const [submittedLabel, setSubmittedLabel] = useState('');

  // Fetch + decrypt records when modal opens
  useEffect(() => {
    if (!request || !user?.uid) return;

    setRecordsLoading(true);
    getAccessibleRecords(user.uid)
      .then(async recs => {
        const decrypted = await RecordDecryptionService.decryptRecords(recs as any);
        const sorted = [...decrypted].sort((a, b) => {
          const ms = (r: FileObject) => {
            const t = r.uploadedAt;
            if (!t) return 0;
            if (typeof (t as any).toMillis === 'function') return (t as any).toMillis();
            return new Date(t as any).getTime();
          };
          return ms(b) - ms(a);
        });
        setRecords(sorted as FileObject[]);
      })
      .catch(() => setError('Failed to load your records. Please try again.'))
      .finally(() => setRecordsLoading(false));
  }, [request?.inviteCode, user?.uid]);

  const toggleRecord = useCallback((id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const goToRolePicker = useCallback(() => {
    if (selectedIds.length === 0) return;
    setPhase('pick-role');
  }, [selectedIds]);

  const goBackToRecordPicker = useCallback(() => {
    setPhase('pick-records');
    setError(null);
  }, []);

  const goToDenyConfirm = useCallback(() => {
    setPhase('confirm-deny');
    setError(null);
  }, []);

  const goBackFromDeny = useCallback(() => {
    setPhase('pick-records');
    setError(null);
  }, []);

  // Dismiss the 'submitted' success card (auto-fires after 3s, or via "Got it") — returns to
  // pick-records rather than closing the whole modal, since a provider typically has more
  // records left to link.
  const dismissSubmitted = useCallback(() => {
    setPhase('pick-records');
  }, []);

  const submitAddRecords = useCallback(async () => {
    if (!request || selectedIds.length === 0) return;
    const ids = selectedIds;
    const role = selectedRole;

    // Block only on preparation — local smart-account setup, not the transaction itself.
    setPhase('executing');
    setError(null);
    try {
      await prepareRecordsForLinking(ids);
    } catch (err: any) {
      setError(getUserFacingErrorMessage(err, 'Failed to prepare records. Please try again.'));
      setPhase('error');
      return;
    }

    // Fire the grant tx — don't await. Hand off to the tray immediately so the modal isn't just
    // duplicating a "still working" spinner the tray already owns.
    const roleLabel = roleLabels[role];
    const activityLabel =
      ids.length > 1
        ? `Granting ${roleLabel} access on ${ids.length} records`
        : `Granting ${roleLabel} access`;
    const activityId = addActivity({ label: activityLabel, link: '/app/record-requests' });

    setSelectedIds([]);
    setSelectedRole('viewer');
    setSubmittedLabel(activityLabel);
    setPhase('submitted');

    addRecordsToRequest(ids, request, role)
      .then(result => {
        updateActivity(activityId, { status: 'confirmed' });
        setLinkedThisSession(prev => [...new Set([...prev, ...result.recordIds])]);
      })
      .catch(err => {
        const message = getUserFacingErrorMessage(err, 'Failed to link records. Please try again.');
        updateActivity(activityId, { status: 'failed', errorMessage: message });
      });
  }, [request, selectedIds, selectedRole, addActivity, updateActivity]);

  const submitMarkComplete = useCallback(async () => {
    if (!request) return;
    setPhase('executing');
    setError(null);
    try {
      await markRequestComplete(request);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to mark request complete.');
      setPhase('error');
    }
  }, [request, onClose]);

  const submitDeny = useCallback(async () => {
    if (!request || !denyReason) return;
    setPhase('executing');
    setError(null);
    try {
      await denyRequest({ request, reason: denyReason, note: denyNote });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to deny request.');
      setPhase('error');
    }
  }, [request, denyReason, denyNote, onClose]);

  const reset = useCallback(() => {
    setSelectedIds([]);
    setSelectedRole('viewer');
    setDenyReason('');
    setDenyNote('');
    setPhase('pick-records');
    setError(null);
    setLinkedThisSession([]);
    setRecords([]);
    setSubmittedLabel('');
  }, []);

  return {
    records,
    recordsLoading,
    selectedIds,
    toggleRecord,
    setSelectedIds,
    clearSelection,
    selectedRole,
    setSelectedRole,
    denyReason,
    setDenyReason,
    denyNote,
    setDenyNote,
    phase,
    error,
    submittedLabel,
    linkedThisSession,
    goToRolePicker,
    goBackToRecordPicker,
    dismissSubmitted,
    goToDenyConfirm,
    goBackFromDeny,
    submitAddRecords,
    submitMarkComplete,
    submitDeny,
    reset,
  };
}
