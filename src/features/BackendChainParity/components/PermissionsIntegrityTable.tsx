// src/features/BackendChainParity/components/PermissionsIntegrityTable.tsx

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { IntegrityStatusBadge } from './IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog } from './HistoryLog';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import type { IntegrityStatus } from '../lib/types';
import type {
  RecordPermissionIntegrityItem,
  PermissionMemberComparison,
  PermSyncStatus,
} from '../services/recordPermissionIntegrityService';
import { NETWORK } from '@belrose/shared';
import type { PermissionChangeEvent, TimestampLike } from '@belrose/shared';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

// ============================================================================
// STYLE MAPS
// ============================================================================

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-rose-50 text-rose-700',
  administrator: 'bg-purple-50 text-purple-700',
  sharer: 'bg-blue-50 text-blue-700',
  viewer: 'bg-gray-100 text-gray-600',
};

const SYNC_STATUS_STYLES: Record<PermSyncStatus, string> = {
  synced: 'bg-green-50 text-green-700',
  wrong_role: 'bg-amber-50 text-amber-700',
  missing_from_chain: 'bg-orange-50 text-orange-700',
  missing_from_backend: 'bg-red-50 text-red-700',
};

const SYNC_STATUS_LABEL: Record<PermSyncStatus, string> = {
  synced: 'Synced',
  wrong_role: 'Wrong Role',
  missing_from_chain: 'Missing on Chain',
  missing_from_backend: 'Chain Only',
};

const ACTION_STYLE: Record<string, string> = {
  granted: 'bg-green-50 text-green-700',
  upgraded: 'bg-blue-50 text-blue-700',
  downgraded: 'bg-amber-50 text-amber-700',
  revoked: 'bg-gray-100 text-gray-600',
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-gray-400">—</span>;
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${ROLE_STYLES[role] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {role}
    </span>
  );
}

function MemberComparisonTable({ comparisons }: { comparisons: PermissionMemberComparison[] }) {
  if (comparisons.length === 0) {
    return <p className="text-xs text-gray-400 italic">No members</p>;
  }
  return (
    <table className="w-full text-xs border-separate border-spacing-y-0.5">
      <thead>
        <tr className="text-gray-400 font-medium">
          <th className="text-left pr-3 pb-1 font-medium">User</th>
          <th className="text-left pr-3 pb-1 font-medium">Firestore Role</th>
          <th className="text-left pr-3 pb-1 font-medium">On-Chain Role</th>
          <th className="text-left pr-3 pb-1 font-medium">Status</th>
          <th className="text-left pb-1 font-medium">Last TX</th>
        </tr>
      </thead>
      <tbody>
        {comparisons.map((m, i) => (
          <tr key={i} className="align-middle">
            <td className="pr-3 py-1 font-mono">
              {m.userId ? (
                <div className="flex flex-col gap-0.5">
                  <CopyableHash value={m.userId} chars={10} className="text-gray-600" />
                  <CopyableHash value={m.userIdHash} chars={10} className="text-gray-400" />
                </div>
              ) : (
                <CopyableHash value={m.userIdHash} chars={10} className="text-gray-400" />
              )}
            </td>
            <td className="pr-3 py-1">
              <RoleBadge role={m.firestoreRole} />
            </td>
            <td className="pr-3 py-1">
              <RoleBadge role={m.onChainRole} />
            </td>
            <td className="pr-3 py-1">
              <span
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${SYNC_STATUS_STYLES[m.syncStatus]}`}
              >
                {SYNC_STATUS_LABEL[m.syncStatus]}
              </span>
            </td>
            <td className="py-1">
              {m.lastBlockchainRef ? (
                <div className="flex items-center gap-1">
                  <CopyableHash
                    value={m.lastBlockchainRef.txHash}
                    chars={8}
                    className="font-mono text-gray-500"
                  />
                  <a
                    href={`${BASESCAN_TX_URL}${m.lastBlockchainRef.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {m.lastChangedAt && (
                    <span className="text-gray-400">
                      {formatTimestamp(m.lastChangedAt as unknown as TimestampLike)}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function toHistoryEntries(events: PermissionChangeEvent[]) {
  return events.map((event, i) => ({
    key: i,
    badge: (
      <div className="flex flex-wrap gap-1 w-full">
        {event.changes.map((c, j) => (
          <span
            key={j}
            className={`px-1.5 py-0.5 rounded font-medium ${ACTION_STYLE[c.action] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {c.action} · <span className="font-mono opacity-75">{c.userId.slice(0, 8)}…</span>
            {c.previousRole && ` ${c.previousRole}`}
            {c.newRole && ` → ${c.newRole}`}
          </span>
        ))}
      </div>
    ),
    txHash: event.blockchainRef?.txHash,
    timestamp: event.changedAt as unknown as TimestampLike,
  }));
}

function MemberCountCell({
  firestoreCount,
  chainCount,
}: {
  firestoreCount: number;
  chainCount: number;
}) {
  const mismatch = firestoreCount !== chainCount;
  return (
    <div
      className={`flex items-center gap-1 text-xs font-mono ${mismatch ? 'text-amber-700' : 'text-gray-600'}`}
    >
      <span>{firestoreCount}</span>
      <span className="text-gray-400">/</span>
      <span>{chainCount}</span>
      {mismatch && <span className="text-amber-500">⚠</span>}
    </div>
  );
}

// ============================================================================
// MAIN TABLE
// ============================================================================

interface PermissionsIntegrityTableProps {
  items: RecordPermissionIntegrityItem[];
  searchQuery: string;
  statusFilter: IntegrityStatus | 'all';
  onClearSearch: () => void;
}

const TOTAL_COLS = 6;

export const PermissionsIntegrityTable: React.FC<PermissionsIntegrityTableProps> = ({
  items,
  searchQuery,
  statusFilter,
  onClearSearch,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = items.filter(item => {
    if (statusFilter !== 'all' && item.integrityStatus !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.recordId.toLowerCase().includes(q) ||
      item.recordIdHash.toLowerCase().includes(q) ||
      (item.uploadedBy?.toLowerCase().includes(q) ?? false) ||
      (item.uploadedByIdHash?.toLowerCase().includes(q) ?? false) ||
      item.memberComparisons.some(
        m => m.userId?.toLowerCase().includes(q) || m.userIdHash.toLowerCase().includes(q)
      )
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
            <th className="px-2 py-3 w-6" />
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Record</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Uploaded By</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Members (FS / Chain)</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Last Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-left">
          {filtered.map(item => {
            const isExpanded = expandedRows.has(item.recordId);
            const lastChange = item.recentHistory[0]?.changedAt;

            return (
              <React.Fragment key={item.recordId}>
                <tr className="hover:bg-gray-50">
                  <td className="px-2 py-3">
                    <button
                      onClick={() => toggleRow(item.recordId)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  </td>

                  <td className="px-4 py-3">
                    <IntegrityStatusBadge status={item.integrityStatus} />
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5 font-mono">
                      <div className="text-xs text-gray-600">
                        ID: <CopyableHash value={item.recordId} chars={10} />
                      </div>
                      <div className="text-xs text-gray-400">
                        #: <CopyableHash value={item.recordIdHash} chars={10} />
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    {item.uploadedBy ? (
                      <div className="flex flex-col gap-0.5 font-mono">
                        <div className="text-xs text-gray-600">
                          ID: <CopyableHash value={item.uploadedBy} chars={10} />
                        </div>
                        <div className="text-xs text-gray-400">
                          #: <CopyableHash value={item.uploadedByIdHash!} chars={10} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <MemberCountCell
                      firestoreCount={item.firestoreMemberCount}
                      chainCount={item.onChainMemberCount}
                    />
                  </td>

                  <td className="px-4 py-3 text-xs text-gray-500">
                    {lastChange ? (
                      formatTimestamp(lastChange as unknown as TimestampLike)
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <td />
                    <td colSpan={TOTAL_COLS - 1} className="px-6 py-5">
                      <div className="flex flex-col gap-6">
                        {/* Members comparison */}
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-3">Members</p>
                          <MemberComparisonTable comparisons={item.memberComparisons} />
                        </div>

                        {/* Permission history */}
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-2">
                            Recent Permission History
                            <span className="ml-1 text-gray-400 font-normal">(last 20)</span>
                          </p>
                          <HistoryLog entries={toHistoryEntries(item.recentHistory)} />
                        </div>

                        {/* Error */}
                        {item.error && (
                          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                            {item.error}
                          </div>
                        )}
                      </div>
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
