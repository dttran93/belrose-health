// src/features/BackendChainParity/components/RecordHashesIntegrityTable.tsx

import React from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { RecordHashHistoryAction, RecordHashHistoryEvent } from '@belrose/shared';
import { useRecordHashHistory } from '../hooks/useRecordHashHistory';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { VersionReviewBadge } from '@/features/ViewEditRecord/components/Edit/VersionReviewBadge';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import type { RecordHashIntegrityItem } from '../services/recordHashIntegrityService';
import type { HashSyncStatus, IntegrityStatus } from '../lib/types';
import type {
  DisputeIntegrityItem,
  VerificationIntegrityItem,
} from '../services/credibilityIntegrityService';

const HISTORY_ACTION_LABEL: Record<RecordHashHistoryAction, string> = {
  anchored: 'Anchored',
};

const HISTORY_ACTION_STYLE: Record<RecordHashHistoryAction, string> = {
  anchored: 'bg-emerald-50 text-emerald-700',
};

function toHistoryEntries(events: RecordHashHistoryEvent[]): HistoryLogEntry[] {
  return events.map((event, i) => ({
    key: i,
    badge: (
      <>
        <span
          className={`px-1.5 py-0.5 rounded font-medium ${HISTORY_ACTION_STYLE[event.action] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {HISTORY_ACTION_LABEL[event.action] ?? event.action}
        </span>
        <span className="font-mono text-gray-400">{event.hash.slice(0, 10)}…</span>
        <span className="text-gray-400 italic">via {event.anchoredVia}</span>
      </>
    ),
    txHash: event.blockchainRef?.txHash,
    timestamp: event.changedAt,
  }));
}

const HASH_STATUS_CONFIG: Record<
  HashSyncStatus,
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

interface RecordHashesIntegrityTableProps {
  items: RecordHashIntegrityItem[];
  searchQuery: string;
  statusFilter: IntegrityStatus | 'all';
  verificationsMap: Record<string, VerificationIntegrityItem[] | undefined>;
  disputesMap: Record<string, DisputeIntegrityItem[] | undefined>;
  onClearSearch: () => void;
}

function CredibilityCell({
  firestoreId,
  verificationsMap,
  disputesMap,
}: {
  firestoreId: string;
  verificationsMap: Record<string, VerificationIntegrityItem[] | undefined>;
  disputesMap: Record<string, DisputeIntegrityItem[] | undefined>;
}) {
  const vCount = verificationsMap[firestoreId]?.length ?? 0;
  const dCount = disputesMap[firestoreId]?.length ?? 0;
  if (vCount === 0 && dCount === 0) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <div className="flex items-center gap-2 text-xs">
      {vCount > 0 && (
        <span className="flex items-center gap-0.5 text-emerald-600">
          <CheckCircle className="w-3 h-3" />
          {vCount}
        </span>
      )}
      {dCount > 0 && (
        <span className="flex items-center gap-0.5 text-amber-500">
          <AlertTriangle className="w-3 h-3" />
          {dCount}
        </span>
      )}
    </div>
  );
}

export const RecordHashesIntegrityTable: React.FC<RecordHashesIntegrityTableProps> = ({
  items,
  searchQuery,
  statusFilter,
  verificationsMap,
  disputesMap,
  onClearSearch,
}) => {
  const filtered = items.filter(item => {
    if (statusFilter !== 'all' && item.integrityStatus !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.firestoreId.toLowerCase().includes(q) ||
      item.recordIdHash.toLowerCase().includes(q) ||
      (item.recordHash?.toLowerCase().includes(q) ?? false) ||
      item.hashComparisons.some(h => h.hash.toLowerCase().includes(q))
    );
  });

  const columns: IntegrityTableColumn<RecordHashIntegrityItem>[] = [
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
            Hash: <CopyableHash value={item.recordHash} chars={10} />
          </div>
        </div>
      ),
    },
    {
      header: 'Backend',
      cellClassName: 'px-4 py-3 text-xs text-gray-500',
      cell: item => item.backendHashes.length,
    },
    {
      header: 'On-Chain',
      cellClassName: 'px-4 py-3 text-xs text-gray-500',
      cell: item => item.onChainHashes.length,
    },
    {
      header: 'Credibility',
      cell: item => (
        <CredibilityCell
          firestoreId={item.firestoreId}
          verificationsMap={verificationsMap}
          disputesMap={disputesMap}
        />
      ),
    },
  ];

  return (
    <IntegrityTable
      items={filtered}
      rowKey={item => item.firestoreId}
      columns={columns}
      emptyMessage="No records match the current filter."
      searchQuery={searchQuery}
      onClearSearch={onClearSearch}
      renderDetail={item => (
        <ExpandedRow
          item={item}
          verifications={verificationsMap[item.firestoreId] ?? []}
          disputes={disputesMap[item.firestoreId] ?? []}
        />
      )}
    />
  );
};

// ─── Expanded panel ────────────────────────────────────────────────────────────

interface ExpandedRowProps {
  item: RecordHashIntegrityItem;
  verifications: VerificationIntegrityItem[];
  disputes: DisputeIntegrityItem[];
}

const ExpandedRow: React.FC<ExpandedRowProps> = ({ item, verifications, disputes }) => {
  const navigate = useNavigate();
  const { data: historyEvents } = useRecordHashHistory(item.firestoreId);
  // Group verifications and disputes by their recordHash so each hash row
  // gets its own accurate V&D counts (same pattern as VersionHistory.tsx)
  const versByHash = new Map<string, VerificationIntegrityItem[]>();
  for (const v of verifications) {
    if (!v.recordHash) continue;
    const key = v.recordHash.toLowerCase();
    versByHash.set(key, [...(versByHash.get(key) ?? []), v]);
  }

  const dispsByHash = new Map<string, DisputeIntegrityItem[]>();
  for (const d of disputes) {
    if (!d.recordHash) continue;
    const key = d.recordHash.toLowerCase();
    dispsByHash.set(key, [...(dispsByHash.get(key) ?? []), d]);
  }

  return (
    <div className="flex gap-4 flex-wrap">
      <DetailSection
        title={`Hashes (${item.backendHashes.length} backend · ${item.onChainHashes.length} on-chain)`}
        className="flex-1 min-w-64"
      >
        {item.hashComparisons.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {item.hashComparisons.map(h => {
              const cfg = HASH_STATUS_CONFIG[h.syncStatus];
              return (
                <div key={h.hash} className="flex items-start gap-2 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5 font-mono text-gray-700">
                      <div className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dotClass}`} />
                        <CopyableHash value={h.hash} />
                        {h.isCurrentHash && (
                          <span className="text-[10px] font-sans font-medium text-blue-600 bg-blue-50 rounded px-1 py-0.5 leading-none">
                            current
                          </span>
                        )}
                        <span className={`font-sans ${cfg.textClass}`}>{cfg.label}</span>
                      </div>
                      {(() => {
                        const hashVers = versByHash.get(h.hash) ?? [];
                        const hashDisps = dispsByHash.get(h.hash) ?? [];
                        return (
                          <VersionReviewBadge
                            stats={{
                              verifications: {
                                total: hashVers.length,
                                active: hashVers.filter(v => v.isActiveOnChain !== false).length,
                              },
                              disputes: {
                                total: hashDisps.length,
                                active: hashDisps.filter(d => d.isActiveOnChain !== false).length,
                              },
                            }}
                            onClick={() => navigate(`?tab=credibility&search=${h.hash}`)}
                          />
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : item.integrityStatus === 'not_applicable' ? (
          <div className="text-xs text-gray-400">Not yet anchored on chain.</div>
        ) : (
          <div className="text-xs text-gray-400">No hashes.</div>
        )}
        {item.error && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 rounded p-2">{item.error}</div>
        )}
      </DetailSection>

      <DetailSection title="Hash History" className="flex-1 min-w-64">
        <HistoryLog
          entries={toHistoryEntries(historyEvents ?? [])}
          emptyMessage="No hash history recorded"
        />
      </DetailSection>
    </div>
  );
};
