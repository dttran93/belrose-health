// src/features/BackendChainParity/components/SubjectsIntegrityTable.tsx

import React from 'react';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import { NETWORK } from '@belrose/shared';
import type { SubjectHistoryAction, SubjectHistoryEvent } from '@belrose/shared';
import { useSubjectConsentRefs } from '../hooks/useSubjectConsentRefs';
import { useSubjectHistory } from '../hooks/useSubjectHistory';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import type { RecordSubjectIntegrityItem } from '../services/recordSubjectIntegrityService';
import type { IntegrityStatus, SubjectSyncStatus } from '../lib/types';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

const SUBJECT_STATUS_CONFIG: Record<
  SubjectSyncStatus,
  { dotClass: string; label: string; textClass: string }
> = {
  active_sync: {
    dotClass: 'bg-emerald-500',
    label: 'active on-chain',
    textClass: 'text-emerald-600',
  },
  missing_from_chain: {
    dotClass: 'bg-red-500',
    label: 'missing from chain',
    textClass: 'text-red-500',
  },
  missing_from_backend: {
    dotClass: 'bg-amber-500',
    label: 'missing from backend',
    textClass: 'text-amber-600',
  },
  removed_sync: { dotClass: 'bg-gray-300', label: 'removed (synced)', textClass: 'text-gray-400' },
};

const HISTORY_ACTION_LABEL: Record<SubjectHistoryAction, string> = {
  anchored: 'Anchored',
  anchored_as_controller: 'Anchored (Controller)',
  unanchored: 'Unanchored',
};

const HISTORY_ACTION_STYLE: Record<SubjectHistoryAction, string> = {
  anchored: 'bg-emerald-50 text-emerald-700',
  anchored_as_controller: 'bg-purple-50 text-purple-700',
  unanchored: 'bg-gray-100 text-gray-600',
};

function toHistoryEntries(events: SubjectHistoryEvent[]): HistoryLogEntry[] {
  return events.map((event, i) => ({
    key: i,
    badge: (
      <>
        <span
          className={`px-1.5 py-0.5 rounded font-medium ${HISTORY_ACTION_STYLE[event.action] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {HISTORY_ACTION_LABEL[event.action] ?? event.action}
        </span>
        <span className="font-mono text-gray-400">{event.subjectId.slice(0, 8)}…</span>
        {event.viaConsent && <span className="text-gray-400 italic">via consent</span>}
      </>
    ),
    txHash: event.blockchainRef?.txHash,
    timestamp: event.changedAt,
  }));
}

interface SubjectsIntegrityTableProps {
  items: RecordSubjectIntegrityItem[];
  searchQuery: string;
  statusFilter: IntegrityStatus | 'all';
  onClearSearch: () => void;
}

const columns: IntegrityTableColumn<RecordSubjectIntegrityItem>[] = [
  {
    header: 'Status',
    cell: item => <IntegrityStatusBadge status={item.integrityStatus} />,
  },
  {
    header: 'Record',
    cell: item => (
      <div className="flex flex-col gap-0.5 font-mono">
        <div className="text-xs text-gray-600">
          ID: <CopyableHash value={item.firestoreId} chars={10} />
        </div>
        <div className="text-xs text-gray-400">
          #: <CopyableHash value={item.recordIdHash} chars={10} />
        </div>
      </div>
    ),
  },
  {
    header: 'Backend',
    cellClassName: 'px-4 py-3 text-xs text-gray-500',
    cell: item => item.backendSubjects.length,
  },
  {
    header: 'On-Chain',
    cellClassName: 'px-4 py-3 text-xs text-gray-500',
    cell: item => item.onChainSubjects.length,
  },
];

export const SubjectsIntegrityTable: React.FC<SubjectsIntegrityTableProps> = ({
  items,
  searchQuery,
  statusFilter,
  onClearSearch,
}) => {
  const filtered = items.filter(item => {
    if (statusFilter !== 'all' && item.integrityStatus !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.firestoreId.toLowerCase().includes(q) ||
      item.recordIdHash.toLowerCase().includes(q) ||
      item.backendSubjects.some(uid => uid.toLowerCase().includes(q)) ||
      item.subjectComparisons.some(s => s.userIdHash.toLowerCase().includes(q))
    );
  });

  return (
    <IntegrityTable
      items={filtered}
      rowKey={item => item.firestoreId}
      columns={columns}
      emptyMessage="No records match the current filter."
      searchQuery={searchQuery}
      onClearSearch={onClearSearch}
      renderDetail={item => <ExpandedRow item={item} />}
    />
  );
};

// ─── Expanded panel ────────────────────────────────────────────────────────────

const ExpandedRow: React.FC<{ item: RecordSubjectIntegrityItem }> = ({ item }) => {
  const { data: consentRefs } = useSubjectConsentRefs(item.firestoreId);
  const { data: historyEvents } = useSubjectHistory(item.firestoreId);

  return (
    <div className="flex gap-4 flex-wrap">
      <DetailSection
        title={`Subjects (${item.backendSubjects.length} backend · ${item.onChainSubjects.length} on-chain)`}
        className="flex-1 min-w-64"
      >
        {item.subjectComparisons.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {item.subjectComparisons.map(s => {
              const cfg = SUBJECT_STATUS_CONFIG[s.syncStatus];
              return (
                <div key={s.userIdHash} className="flex items-start gap-2 py-2 text-xs">
                  <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${cfg.dotClass}`} />
                  <div className="text-left min-w-0 flex-1">
                    {s.uid ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-gray-700 truncate">{s.uid}</span>
                        <a
                          href={`?tab=members&search=${s.uid}`}
                          title="View in Members tab"
                          className="flex-shrink-0 text-gray-400 hover:text-blue-600 transition-colors"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                        </a>
                      </div>
                    ) : (
                      <span className="italic text-left text-gray-400">uid unknown</span>
                    )}
                    <div className="font-mono text-left text-gray-400 mt-0.5">
                      <CopyableHash value={s.userIdHash} />
                    </div>
                  </div>
                  <span className={`flex-shrink-0 flex items-center gap-1 ${cfg.textClass}`}>
                    {cfg.label}
                    {s.uid && consentRefs?.[s.uid]?.txHash && (
                      <a
                        href={`${BASESCAN_TX_URL}${consentRefs[s.uid]!.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View anchoring tx"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : item.integrityStatus === 'not_applicable' ? (
          <div className="text-xs text-gray-400">Not yet anchored on chain.</div>
        ) : (
          <div className="text-xs text-gray-400">No subjects.</div>
        )}
        {item.error && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 rounded p-2">{item.error}</div>
        )}
      </DetailSection>

      <DetailSection title="Subject History" className="flex-1 min-w-64">
        <HistoryLog
          entries={toHistoryEntries(historyEvents ?? [])}
          emptyMessage="No subject history recorded"
        />
      </DetailSection>
    </div>
  );
};
