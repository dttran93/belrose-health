// src/features/BackendChainParity/components/RecordHashesIntegrityTable.tsx

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IntegrityStatusBadge } from './IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { VersionReviewBadge } from '@/features/ViewEditRecord/components/Edit/VersionReviewBadge';
import type { RecordHashIntegrityItem } from '../services/recordHashIntegrityService';
import type { HashSyncStatus, IntegrityStatus } from '../lib/types';
import type {
  DisputeIntegrityItem,
  VerificationIntegrityItem,
} from '../services/credibilityIntegrityService';

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

export const RecordHashesIntegrityTable: React.FC<RecordHashesIntegrityTableProps> = ({
  items,
  searchQuery,
  statusFilter,
  verificationsMap,
  disputesMap,
  onClearSearch,
}) => {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

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

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>No records match the current filter.</p>
        {searchQuery && (
          <button
            onClick={onClearSearch}
            className="mt-2 text-sm text-blue-500 hover:text-blue-700"
          >
            Clear search
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-xl border border-gray-200 max-h-[80vh]">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th className="w-6 px-3 py-3" />
            <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Record ID</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Record Hash</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Backend</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">On-Chain</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Credibility</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filtered.map(item => {
            const isExpanded = expandedRow === item.firestoreId;
            return (
              <React.Fragment key={item.firestoreId}>
                <tr
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedRow(isExpanded ? null : item.firestoreId)}
                >
                  <td className="px-3 py-3 text-gray-400">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <IntegrityStatusBadge status={item.integrityStatus} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    <CopyableHash value={item.firestoreId} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    <CopyableHash value={item.recordHash} />
                  </td>
                  <td className="px-4 py-3 text-xs text-center text-gray-500">
                    {item.backendHashes.length}
                  </td>
                  <td className="px-4 py-3 text-xs text-center text-gray-500">
                    {item.onChainHashes.length}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(() => {
                      const vCount = verificationsMap[item.firestoreId]?.length ?? 0;
                      const dCount = disputesMap[item.firestoreId]?.length ?? 0;
                      if (vCount === 0 && dCount === 0)
                        return <span className="text-gray-300 text-xs">—</span>;
                      return (
                        <div className="flex items-center justify-center gap-2 text-xs">
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
                    })()}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-gray-50">
                    <td colSpan={7} className="px-6 py-5">
                      <ExpandedRow
                        item={item}
                        verifications={verificationsMap[item.firestoreId] ?? []}
                        disputes={disputesMap[item.firestoreId] ?? []}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
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
    <div className="space-y-4">
      {/* ── Identifiers ── */}
      <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs font-mono text-gray-500">
        <span>
          <span className="text-gray-400 mr-2">Record ID</span>
          <CopyableHash value={item.firestoreId} full />
        </span>
        <span>
          <span className="text-gray-400 mr-2">Record ID Hash</span>
          <CopyableHash value={item.recordIdHash} full />
        </span>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Hashes ({item.backendHashes.length} backend · {item.onChainHashes.length} on-chain)
        </div>
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
      </div>
    </div>
  );
};
