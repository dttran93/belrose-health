// src/features/RequestRecord/components/ui/LinkRecordModal.tsx

/**
 * LinkRecordModal
 *
 * Phases:
 *   pick-records  — RecordPickerContent (inline, no overlay) + terminal actions
 *   pick-role     — RoleSelector applied to all selected records
 *   confirm-deny  — reason select + optional free-text note
 *   executing     — spinner
 *   error         — error + retry
 *
 * After a successful addRecords call the modal returns to pick-records so
 * the provider can keep linking more. They close out via "Mark as complete"
 * or "Deny request".
 */

import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Link, Loader2, X } from 'lucide-react';
import React, { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { useLinkRecord } from '../../hooks/useLinkRecord';
import { DENY_REASONS, DenyReasonValue } from '../../services/fulfillRequestService';
import { RecordPickerContent } from '@/features/Ai/components/ui/RecordPicker';
import { RecordRequest } from '@belrose/shared';
import { LinkModalOverlay, ExecutingPhase, ErrorPhase, PickRolePhase } from '../ui/LinkModalShell';

interface LinkRecordModalProps {
  request: RecordRequest | null;
  onClose: () => void;
  onSuccess: () => void;
  initialPhase?: 'pick-records' | 'confirm-deny';
}

const LinkRecordModal: React.FC<LinkRecordModalProps> = ({
  request,
  onClose,
  onSuccess,
  initialPhase,
}) => {
  const handleClose = () => {
    reset();
    onClose();
  };

  const hook = useLinkRecord(request, () => {
    onSuccess();
    handleClose();
  });

  const {
    records,
    recordsLoading,
    selectedIds,
    selectedRole,
    setSelectedRole,
    denyReason,
    setDenyReason,
    denyNote,
    setDenyNote,
    phase,
    error,
    linkedThisSession,
    goToRolePicker,
    goBackToRecordPicker,
    goToDenyConfirm,
    goBackFromDeny,
    submitAddRecords,
    submitMarkComplete,
    submitDeny,
    reset,
  } = hook;

  useEffect(() => {
    if (request !== null && initialPhase === 'confirm-deny') {
      goToDenyConfirm();
    }
  });

  const isOpen = request !== null;

  return (
    <LinkModalOverlay isOpen={isOpen} canDismiss={phase !== 'executing'} onClose={handleClose}>
      {phase === 'executing' && <ExecutingPhase />}

      {phase === 'error' && (
        <ErrorPhase error={error} onRetry={goBackToRecordPicker} onClose={handleClose} />
      )}

      {phase === 'pick-records' && (
        <PickRecordsPhase
          request={request}
          records={records}
          recordsLoading={recordsLoading}
          selectedIds={selectedIds}
          linkedThisSession={linkedThisSession}
          onSelectionChange={newIds => hook.setSelectedIds(newIds)}
          onNext={goToRolePicker}
          onDeny={goToDenyConfirm}
          onMarkComplete={submitMarkComplete}
          onClose={handleClose}
        />
      )}

      {phase === 'pick-role' && (
        <PickRolePhase
          itemLabel={`${selectedIds.length} record${selectedIds.length !== 1 ? 's' : ''}`}
          recipientLabel={request?.requesterName ?? ''}
          selectedRole={selectedRole}
          onRoleChange={setSelectedRole}
          onBack={goBackToRecordPicker}
          onConfirm={submitAddRecords}
          confirmLabel="Grant access & add more"
        />
      )}

      {phase === 'confirm-deny' && (
        <ConfirmDenyPhase
          request={request}
          denyReason={denyReason}
          denyNote={denyNote}
          onReasonChange={setDenyReason}
          onNoteChange={setDenyNote}
          onBack={initialPhase === 'confirm-deny' ? handleClose : goBackFromDeny}
          onConfirm={submitDeny}
        />
      )}
    </LinkModalOverlay>
  );
};

// ============================================================================
// PHASE COMPONENTS
// ============================================================================

// ── Pick records ──────────────────────────────────────────────────────────────

interface PickRecordsPhaseProps {
  request: RecordRequest | null;
  records: ReturnType<typeof useLinkRecord>['records'];
  recordsLoading: boolean;
  selectedIds: string[];
  linkedThisSession: string[];
  onSelectionChange: (ids: string[]) => void;
  onNext: () => void;
  onDeny: () => void;
  onMarkComplete: () => void;
  onClose: () => void;
}

const PickRecordsPhase: React.FC<PickRecordsPhaseProps> = ({
  request,
  records,
  recordsLoading,
  selectedIds,
  linkedThisSession,
  onSelectionChange,
  onNext,
  onDeny,
  onMarkComplete,
  onClose,
}) => {
  const hasLinkedSome = linkedThisSession.length > 0;

  return (
    <div className="flex flex-col h-[90vh]">
      {/* Modal header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Link className="w-4 h-4 text-slate-500" />
          <Dialog.Title className="text-base font-semibold text-slate-900">
            Link existing records
          </Dialog.Title>
        </div>
        <Dialog.Close asChild>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </Dialog.Close>
      </div>

      {/* Request context + linked-so-far counter */}
      {request && (
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex-shrink-0 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Request from <span className="font-medium text-slate-700">{request.requesterName}</span>
          </p>
          {hasLinkedSome && (
            <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
              {linkedThisSession.length} linked so far
            </span>
          )}
        </div>
      )}

      {/* Record picker — inline, no overlay */}
      {recordsLoading ? (
        <div className="flex justify-center items-center py-20 flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden h-full">
          <RecordPickerContent
            records={records}
            selectedRecordIds={selectedIds}
            onSelectionChange={onSelectionChange}
            onApply={onNext}
            actionLabel="Next: set access level"
            disabledIds={linkedThisSession}
            disabledLabel="Linked"
          />
        </div>
      )}

      {/* Terminal actions — sit below the picker's own footer */}
      <div className="px-4 py-3 border-t border-slate-100 flex-shrink-0 flex gap-2 bg-white">
        <Button
          variant="outline"
          className={`flex-1 text-sm ${
            hasLinkedSome
              ? 'text-green-700 border-green-300 hover:bg-green-50'
              : 'text-slate-400 border-slate-200 cursor-not-allowed'
          }`}
          disabled={!hasLinkedSome}
          onClick={onMarkComplete}
        >
          ✓ Mark as complete
        </Button>
        <Button
          variant="outline"
          className="flex-1 text-sm text-red-600 border-red-200 hover:bg-red-50"
          onClick={onDeny}
        >
          Deny request
        </Button>
      </div>
    </div>
  );
};

// ── Confirm deny ──────────────────────────────────────────────────────────────

interface ConfirmDenyPhaseProps {
  request: RecordRequest | null;
  denyReason: DenyReasonValue | '';
  denyNote: string;
  onReasonChange: (r: DenyReasonValue) => void;
  onNoteChange: (n: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}

const ConfirmDenyPhase: React.FC<ConfirmDenyPhaseProps> = ({
  request,
  denyReason,
  denyNote,
  onReasonChange,
  onNoteChange,
  onBack,
  onConfirm,
}) => (
  <>
    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
      <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
        <ArrowLeft className="w-4 h-4 text-slate-500" />
      </button>
      <Dialog.Title className="text-base font-semibold text-slate-900">Deny request</Dialog.Title>
    </div>

    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
      {request && (
        <p className="text-sm text-slate-600">
          You're about to deny the request from{' '}
          <span className="font-medium text-slate-800">{request.requesterName}</span>. They will be
          notified so they can seek records elsewhere.
        </p>
      )}

      {/* Reason select */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1.5">
          Reason <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {DENY_REASONS.map(opt => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                denyReason === opt.value
                  ? 'border-red-300 bg-red-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="denyReason"
                value={opt.value}
                checked={denyReason === opt.value}
                onChange={() => onReasonChange(opt.value as DenyReasonValue)}
                className="w-4 h-4 accent-red-600"
              />
              <span className="text-sm text-slate-800">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Optional note */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1.5">
          Additional note <span className="text-slate-400">(optional)</span>
        </label>
        <textarea
          value={denyNote}
          onChange={e => onNoteChange(e.target.value)}
          placeholder="Any additional context for the requester…"
          rows={3}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
        />
      </div>
    </div>

    <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 flex gap-3">
      <Button variant="outline" className="flex-1" onClick={onBack}>
        Back
      </Button>
      <Button
        className="flex-1 bg-red-600 hover:bg-red-700 text-white"
        disabled={!denyReason}
        onClick={onConfirm}
      >
        Deny request
      </Button>
    </div>
  </>
);

export default LinkRecordModal;
