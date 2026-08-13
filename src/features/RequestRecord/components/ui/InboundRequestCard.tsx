// src/features/RequestRecord/components/ui/InboundRequestCard.tsx

/**
 * InboundRequestCard
 *
 * Shows a single inbound record request. When expanded, surfaces:
 *   - Decrypted patient note
 *   - Deadline detail
 *   - Action buttons: Upload new | Link existing | Mark complete | Deny
 *
 * Mark complete and Deny are also available via a small action row inline
 * in the collapsed header for fulfilled/denied status display.
 */

import { formatTimestamp, getDaysUntil } from '@/utils/dataFormattingUtils';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Link,
  Loader2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { doc, getFirestore, increment, serverTimestamp, updateDoc } from 'firebase/firestore';
import { RequestNoteService } from '../../services/requestNoteService';
import { useEffect, useState } from 'react';
import { RequestNote } from '../Request/NewRequestForm';
import { RecordRequest } from '@belrose/shared';
import NoteRow from './NoteRow';

interface InboundRequestCardProps {
  request: RecordRequest;
  onUploadNew: (request: RecordRequest) => void;
  onLinkExisting: (request: RecordRequest) => void;
  /** Opens the deny confirmation (can be inline or delegated to the modal) */
  onDeny: (request: RecordRequest) => void;
  /** Immediately marks the request complete without opening the modal */
  onMarkComplete: (request: RecordRequest) => void;
  onViewRecord: (recordIds: string[]) => void;
}

// Status badge for terminal states
const StatusBadge: React.FC<{ status: RecordRequest['status'] }> = ({ status }) => {
  if (status === 'fulfilled') {
    return (
      <div className="flex items-center gap-1.5 text-green-700 text-xs font-medium">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Fulfilled
      </div>
    );
  }
  if (status === 'denied') {
    return (
      <div className="flex items-center gap-1.5 text-red-600 text-xs font-medium">
        <Ban className="w-3.5 h-3.5" />
        Denied
      </div>
    );
  }
  return null;
};

const InboundRequestCard: React.FC<InboundRequestCardProps> = ({
  request,
  onUploadNew,
  onLinkExisting,
  onDeny,
  onMarkComplete,
  onViewRecord,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [note, setNote] = useState<RequestNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const isTerminal = request.status === 'fulfilled' || request.status === 'denied';
  const isPending = request.status === 'pending';
  const daysLeft = request.deadline ? getDaysUntil(request.deadline) : null;
  const isUrgent = daysLeft !== null && daysLeft <= 7 && isPending;
  const isOverdue = daysLeft !== null && daysLeft < 0 && isPending;

  // How many records linked so far (from the array on the request doc)
  const linkedCount = request.fulfilledRecordIds?.length ?? 0;

  const initials = request.requesterName
    ? request.requesterName
        .split(' ')
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : request.requesterEmail.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!isExpanded || note || noteLoading || !request.encryptedRequestNote) return;

    if (isPending) {
      updateDoc(doc(getFirestore(), 'recordRequests', request.inviteCode), {
        ...(!request.readAt && { readAt: serverTimestamp() }),
        viewCount: increment(1),
      });
    }

    setNoteLoading(true);
    setNoteError(null);
    RequestNoteService.decryptAsProvider(request)
      .then(result => {
        setNote(result);
      })
      .catch(err => {
        setNoteError(err?.message ?? 'Failed to decrypt note.');
      })
      .finally(() => setNoteLoading(false));
  }, [isExpanded]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Urgency bar — only for pending */}
      {isPending && daysLeft !== null && (
        <div
          className={`px-5 py-2 flex items-center justify-between ${
            isOverdue
              ? 'bg-red-50 border-b border-red-100'
              : isUrgent
                ? 'bg-amber-50 border-b border-amber-100'
                : 'bg-slate-50 border-b border-slate-100'
          }`}
        >
          <span
            className={`text-xs font-medium ${
              isOverdue ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-slate-500'
            }`}
          >
            {isOverdue
              ? `Overdue by ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''}`
              : `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}
          </span>
          <span
            className={`text-xs ${isOverdue ? 'text-red-500' : isUrgent ? 'text-amber-500' : 'text-slate-400'}`}
          >
            {request.deadline && formatTimestamp(request.deadline)}
          </span>
        </div>
      )}

      {/* Main row */}
      <div
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-xs font-semibold text-blue-700 flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{request.requesterName}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {request.requesterEmail} · Requested {formatTimestamp(request.createdAt)}
          </p>
          {/* Linked records counter — visible even collapsed */}
          {linkedCount > 0 && isPending && (
            <p className="text-xs text-green-600 font-medium mt-0.5">
              {linkedCount} record{linkedCount !== 1 ? 's' : ''} linked
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isTerminal ? (
            <StatusBadge status={request.status} />
          ) : (
            <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={() => onLinkExisting(request)}
              >
                <Link className="w-3.5 h-3.5" />
                Link existing
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => onUploadNew(request)}>
                <Upload className="w-3.5 h-3.5" />
                Upload new
              </Button>
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </div>

      {/* Expanded section */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          {/* Patient note */}
          {request.encryptedRequestNote ? (
            <div className="bg-slate-50 border-l-4 border-slate-300 rounded-r-lg px-3 py-2.5">
              <p className="text-xs font-medium text-slate-500 mb-2">Patient note</p>
              {noteLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Decrypting...
                </div>
              )}
              {noteError && <p className="text-xs text-red-500">{noteError}</p>}
              {note && (
                <div className="text-left space-y-1.5">
                  {note.practice && <NoteRow label="Practice" value={note.practice} />}
                  {note.provider && <NoteRow label="Provider" value={note.provider} />}
                  {note.dateOfBirth && <NoteRow label="Date of birth" value={note.dateOfBirth} />}
                  {note.patientIdNumber && (
                    <NoteRow label="ID number" value={note.patientIdNumber} />
                  )}
                  {note.dateRange && (
                    <NoteRow
                      label="Date range"
                      value={[note.dateRange.from, note.dateRange.to].filter(Boolean).join(' – ')}
                    />
                  )}
                  {note.freeText && <NoteRow label="Note" value={note.freeText} />}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No additional note provided.</p>
          )}

          {/* Denial info — shown when denied */}
          {request.status === 'denied' && request.deniedReason && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-red-600">Denied</p>
              <p className="text-sm text-red-800">{request.deniedReason.replace(/_/g, ' ')}</p>
              {request.deniedNote && (
                <p className="text-xs text-red-600 mt-1">"{request.deniedNote}"</p>
              )}
            </div>
          )}

          {/* Deadline detail */}
          {isPending && request.deadline && (
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <span>Response deadline</span>
              <span
                className={`font-medium ${isOverdue ? 'text-red-600' : isUrgent ? 'text-amber-600' : 'text-slate-700'}`}
              >
                {formatTimestamp(request.deadline)}
              </span>
            </div>
          )}

          {/* Fulfilled records — shown when records have been linked */}
          {linkedCount > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                Linked Records
              </p>
              <div className="space-y-1">
                {request.fulfilledRecordIds!.map((id, index) => (
                  <Button
                    key={id}
                    variant="secondary"
                    size="sm"
                    className="justify-between text-xs bg-slate-50 hover:bg-slate-100 border-slate-200 h-9 w-full"
                    onClick={() => onViewRecord([id])}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span className="truncate">Record {index + 1}</span>
                    </div>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons in expanded panel */}
          {isPending && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              {/* Add records row */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-2 justify-center text-sm"
                  onClick={() => onLinkExisting(request)}
                >
                  <Link className="w-4 h-4" />
                  Link existing
                </Button>
                <Button
                  className="flex-1 gap-2 justify-center text-sm"
                  onClick={() => onUploadNew(request)}
                >
                  <Upload className="w-4 h-4" />
                  Upload new
                </Button>
              </div>

              {/* Terminal actions row */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className={`flex-1 gap-1.5 justify-center text-sm ${
                    linkedCount > 0
                      ? 'text-green-700 border-green-300 hover:bg-green-50'
                      : 'text-slate-400 cursor-not-allowed'
                  }`}
                  disabled={linkedCount === 0}
                  onClick={() => onMarkComplete(request)}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Mark as complete
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5 justify-center text-sm text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => onDeny(request)}
                >
                  <Ban className="w-4 h-4" />
                  Deny request
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InboundRequestCard;
