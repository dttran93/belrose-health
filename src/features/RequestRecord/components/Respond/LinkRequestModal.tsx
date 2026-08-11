// src/features/RequestRecord/components/ui/LinkRequestModal.tsx

/**
 * LinkRequestModal
 *
 * Inverse of LinkRecordModal — shown on the *record owner's* side.
 * Given a specific record (FileObject), lets the user pick one of their
 * pending inbound requests and link the record to it.
 *
 * Phases:
 *   pick-request  — scrollable list of pending inbound requests
 *   executing     — guest path only: blocks on fulfillAsGuest's Firestore write (session key +
 *                   key rewrap + batch commit); the non-guest grant needs no such prep, so it
 *                   skips straight from pick-role to submitted
 *   submitted     — success card, auto-dismisses (closes the modal); the actual chain write(s)
 *                   have already been fired (not awaited) and handed to OnChainActivityTray
 *   error         — error + retry
 *
 * Props:
 *   record       — the FileObject being linked
 *   isOpen       — controlled open state
 *   onClose      — called when modal should close
 *   onSuccess    — called after a successful link
 */

import * as Dialog from '@radix-ui/react-dialog';
import { Inbox, Loader2, X, XCircle, Search, Check, Calendar, User } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FileObject } from '@/types/core';
import { Role } from '@/features/Permissions/services/permissionsService';
import { useInboundRequests } from '../../hooks/useInboundRequests';
import {
  LinkModalOverlay,
  ExecutingPhase,
  SubmittedPhase,
  ErrorPhase,
  PickRolePhase,
} from '../ui/LinkModalShell';
import { RecordRequest } from '@belrose/shared';
import { FulfillRequestService } from '../../services/fulfillRequestService';
import { EncryptionKeyManager } from '@/features/Encryption/services/encryptionKeyManager';
import { useOnChainActivityTray } from '@/features/OnChainActivityTray/OnChainActivityTrayContext';
import { getUserFacingErrorMessage } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';

const roleLabels: Record<Role, string> = {
  viewer: 'Viewer',
  sharer: 'Sharer',
  administrator: 'Administrator',
  owner: 'Owner',
};

interface LinkRequestModalProps {
  record: FileObject;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (requests: RecordRequest[]) => void;
  isGuest?: boolean;
}

// ── Main modal ────────────────────────────────────────────────────────────────

const LinkRequestModal: React.FC<LinkRequestModalProps> = ({
  record,
  isOpen,
  onClose,
  onSuccess,
  isGuest,
}) => {
  const [phase, setPhase] = useState<
    'pick-requests' | 'pick-role' | 'executing' | 'submitted' | 'error'
  >('pick-requests');
  const [error, setError] = useState<string | null>(null);
  const [submittedLabel, setSubmittedLabel] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRole, setSelectedRole] = useState<Role>('viewer');

  const { filtered: pendingRequests, loading } = useInboundRequests();

  // OnChainActivityTray — the actual chain-writing calls below are fired without being awaited
  // and tracked here instead of behind a blocking spinner; 'executing' below is reserved for the
  // guest path's Firestore-critical prep (session key + fulfillAsGuest), which is worth blocking
  // on since it's fast, local, and is the part the guest is actually waiting for.
  const { addActivity, updateActivity } = useOnChainActivityTray();

  const handleClose = () => {
    setPhase('pick-requests');
    setSelectedIds(new Set());
    setSelectedRole('viewer');
    setError(null);
    setSubmittedLabel('');
    onClose();
  };

  const toggle = (inviteCode: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(inviteCode) ? next.delete(inviteCode) : next.add(inviteCode);
      return next;
    });
  };

  const handleConfirm = async () => {
    const selected = pendingRequests.filter(r => selectedIds.has(r.inviteCode));
    if (selected.length === 0) return;

    const activityLink = `/app/records/${record.id}?view=permissions`;

    if (isGuest) {
      // Block on the Firestore-critical part only (session key + fulfillAsGuest) — that's what
      // the guest is actually waiting on. The on-chain registration below is a best-effort
      // admin-side step, fired without awaiting it and tracked via the tray instead.
      setPhase('executing');
      setError(null);
      try {
        // Verify throwaway session key is still alive before attempting fulfill.
        // If it's gone the user needs to reload — fulfillAsGuest will also check
        // internally but this gives a cleaner error before any Firestore reads.
        const throwawayKey = await EncryptionKeyManager.getSessionKey();
        if (!throwawayKey) {
          throw new Error('Your session has expired. Please reload the page and try again.');
        }
        const historyDocIds = await Promise.all(
          selected.map(r => FulfillRequestService.fulfillAsGuest(r, record.id))
        );

        // Fire-and-forget — registerGuestFulfillmentOnChain manages its own tray card(s)
        // internally (status confirmed/failed), so nothing here needs to await or react to it.
        selected.forEach((r, i) => {
          FulfillRequestService.registerGuestFulfillmentOnChain(r, record.id, historyDocIds[i]!, {
            addActivity,
            updateActivity,
          });
        });
      } catch (err: any) {
        setError(err.message || 'Something went wrong.');
        setPhase('error');
        return;
      }

      onSuccess(selected);
      setSubmittedLabel(
        selected.length > 1 ? `Fulfilled ${selected.length} requests` : 'Request fulfilled'
      );
      setPhase('submitted');
      return;
    }

    // Non-guest: linkExistingRecord needs no preparation step, so there's nothing worth blocking
    // the modal on — fire the grant and hand straight off to the tray.
    const activityLabel =
      selected.length > 1
        ? `Granting ${roleLabels[selectedRole]} access to ${selected.length} requesters`
        : `Granting ${roleLabels[selectedRole]} access to ${selected[0]!.requesterName}`;
    const activityId = addActivity({ label: activityLabel, link: activityLink });

    setSubmittedLabel(activityLabel);
    setPhase('submitted');

    Promise.all(selected.map(r => FulfillRequestService.linkExistingRecord(r, record.id, selectedRole)))
      .then(() => {
        updateActivity(activityId, { status: 'confirmed' });
        onSuccess(selected);
      })
      .catch(err => {
        updateActivity(activityId, {
          status: 'failed',
          errorMessage: getUserFacingErrorMessage(err, 'Failed to grant access'),
        });
      });
  };

  // Build a readable summary of who's selected for the role phase
  const selectedRequests = pendingRequests.filter(r => selectedIds.has(r.inviteCode));
  const recipientLabel =
    selectedRequests.length === 1
      ? selectedRequests[0]!.requesterName
      : `${selectedRequests.length} requesters`;

  return (
    <LinkModalOverlay isOpen={isOpen} canDismiss={phase !== 'executing'} onClose={handleClose}>
      {phase === 'executing' && (
        <ExecutingPhase message="Encrypting the record for the requester and saving your fulfillment." />
      )}

      {phase === 'submitted' && (
        <SubmittedPhase label={submittedLabel} onClose={handleClose} />
      )}

      {phase === 'error' && (
        <ErrorPhase error={error} onRetry={() => setPhase('pick-requests')} onClose={handleClose} />
      )}

      {phase === 'pick-requests' && (
        <PickRequestsPhase
          record={record}
          requests={pendingRequests}
          loading={loading}
          selectedIds={selectedIds}
          onToggle={toggle}
          onClearAll={() => setSelectedIds(new Set())}
          onNext={() => (isGuest ? handleConfirm() : setPhase('pick-role'))}
          onClose={handleClose}
          isGuest={isGuest}
        />
      )}

      {phase === 'pick-role' && (
        <PickRolePhase
          itemLabel={record.belroseFields?.title || record.fileName || 'this record'}
          recipientLabel={recipientLabel}
          selectedRole={selectedRole}
          onRoleChange={setSelectedRole}
          onBack={() => setPhase('pick-requests')}
          onConfirm={handleConfirm}
          confirmLabel={`Grant access to ${selectedIds.size} requester${selectedIds.size !== 1 ? 's' : ''}`}
        />
      )}
    </LinkModalOverlay>
  );
};

// ============================================================================
// PHASE COMPONENTS
// ============================================================================

interface PickRequestsPhaseProps {
  record: FileObject;
  requests: RecordRequest[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggle: (inviteCode: string) => void;
  onClearAll: () => void;
  onNext: () => void;
  onClose: () => void;
  isGuest?: boolean;
}

const PickRequestsPhase: React.FC<PickRequestsPhaseProps> = ({
  record,
  requests,
  loading,
  selectedIds,
  onToggle,
  onClearAll,
  onNext,
  onClose,
  isGuest,
}) => {
  const [search, setSearch] = useState('');

  const filtered = requests.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.requesterName.toLowerCase().includes(q) || r.requesterEmail.toLowerCase().includes(q);
  });

  const recordTitle = record.belroseFields?.title || record.fileName || 'this record';

  const formatDate = (ts: any) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="flex flex-col h-[85vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-slate-500" />
          <Dialog.Title className="text-base font-semibold text-slate-900">
            Link to requests
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

      {/* Record context + counter */}
      <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex-shrink-0 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Linking <span className="font-medium text-slate-700">{recordTitle}</span>
        </p>
        {selectedIds.size > 0 && (
          <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
            {selectedIds.size} selected
          </span>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {loading ? (
          <div className="flex justify-center items-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <Inbox className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">No pending requests</p>
            <p className="text-xs text-slate-500">
              {search ? 'No requests match your search.' : "You don't have any pending requests."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(request => {
              const isSelected = selectedIds.has(request.inviteCode);
              return (
                <button
                  key={request.inviteCode}
                  onClick={() => onToggle(request.inviteCode)}
                  className={`w-full p-3 rounded-xl border-2 text-left transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg flex-shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-slate-100'}`}
                    >
                      {isSelected ? (
                        <Check className="w-4 h-4 text-blue-600" />
                      ) : (
                        <User className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {request.requesterName}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{request.requesterEmail}</p>
                    </div>
                    {request.deadline && (
                      <div className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                        <Calendar className="w-3 h-3" />
                        {formatDate(request.deadline)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 bg-white">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onClearAll}
            disabled={selectedIds.size === 0}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-0"
          >
            Clear all
          </button>
          <p className="text-xs text-slate-400">
            {selectedIds.size === 0
              ? 'Select one or more requests'
              : `${selectedIds.size} request${selectedIds.size !== 1 ? 's' : ''} will receive this record`}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={selectedIds.size === 0} onClick={onNext}>
            {isGuest ? 'Fulfill request' : 'Next: set access level'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LinkRequestModal;
