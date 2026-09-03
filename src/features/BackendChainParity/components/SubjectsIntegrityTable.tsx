// src/features/BackendChainParity/components/SubjectsIntegrityTable.tsx

import React, { useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { NETWORK } from '@belrose/shared';
import { useSubjectConsentRefs } from '../hooks/useSubjectConsentRefs';
import { IntegrityStatusBadge } from './IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
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

interface SubjectsIntegrityTableProps {
  items: RecordSubjectIntegrityItem[];
  searchQuery: string;
  statusFilter: IntegrityStatus | 'all';
  onClearSearch: () => void;
}

export const SubjectsIntegrityTable: React.FC<SubjectsIntegrityTableProps> = ({
  items,
  searchQuery,
  statusFilter,
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
      item.backendSubjects.some(uid => uid.toLowerCase().includes(q)) ||
      item.subjectComparisons.some(s => s.userIdHash.toLowerCase().includes(q))
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
            <th className="px-4 py-3 text-center font-medium text-gray-600">Record ID Hash</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">Backend</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">On-Chain</th>
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
                    <CopyableHash value={item.recordIdHash} />
                  </td>
                  <td className="px-4 py-3 text-xs text-center text-gray-500">
                    {item.backendSubjects.length}
                  </td>
                  <td className="px-4 py-3 text-xs text-center text-gray-500">
                    {item.onChainSubjects.length}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="px-6 py-5">
                      <ExpandedRow item={item} />
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

const ExpandedRow: React.FC<{ item: RecordSubjectIntegrityItem }> = ({ item }) => {
  const { data: consentRefs } = useSubjectConsentRefs(item.firestoreId);

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
          Subjects ({item.backendSubjects.length} backend · {item.onChainSubjects.length} on-chain)
        </div>
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
                          onClick={e => e.stopPropagation()}
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
                        onClick={e => e.stopPropagation()}
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
      </div>
    </div>
  );
};
