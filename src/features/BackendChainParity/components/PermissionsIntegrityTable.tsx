// src/features/BackendChainParity/components/PermissionsIntegrityTable.tsx

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
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

const columns: IntegrityTableColumn<RecordPermissionIntegrityItem>[] = [
  {
    header: 'Status',
    cell: item => <IntegrityStatusBadge status={item.integrityStatus} />,
  },
  {
    header: 'Record',
    cell: item => (
      <div className="flex flex-col gap-0.5 font-mono">
        <div className="text-xs text-gray-600">
          ID: <CopyableHash value={item.recordId} chars={10} />
        </div>
        <div className="text-xs text-gray-400">
          #: <CopyableHash value={item.recordIdHash} chars={10} />
        </div>
      </div>
    ),
  },
  {
    header: 'Uploaded By',
    cell: item =>
      item.uploadedBy ? (
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
      ),
  },
  {
    header: 'Members (FS / Chain)',
    cell: item => (
      <MemberCountCell
        firestoreCount={item.firestoreMemberCount}
        chainCount={item.onChainMemberCount}
      />
    ),
  },
  {
    header: 'Last Change',
    cellClassName: 'px-4 py-3 text-xs text-gray-500',
    cell: item => {
      const lastChange = item.recentHistory[0]?.changedAt;
      return lastChange ? (
        formatTimestamp(lastChange as unknown as TimestampLike)
      ) : (
        <span className="text-gray-400">—</span>
      );
    },
  },
];

export const PermissionsIntegrityTable: React.FC<PermissionsIntegrityTableProps> = ({
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
      item.recordId.toLowerCase().includes(q) ||
      item.recordIdHash.toLowerCase().includes(q) ||
      (item.uploadedBy?.toLowerCase().includes(q) ?? false) ||
      (item.uploadedByIdHash?.toLowerCase().includes(q) ?? false) ||
      item.memberComparisons.some(
        m => m.userId?.toLowerCase().includes(q) || m.userIdHash.toLowerCase().includes(q)
      )
    );
  });

  return (
    <IntegrityTable
      items={filtered}
      rowKey={item => item.recordId}
      columns={columns}
      emptyMessage="No records match the current filter."
      searchQuery={searchQuery}
      onClearSearch={onClearSearch}
      renderDetail={item => (
        <div className="flex flex-col gap-4">
          <DetailSection title="Members">
            <MemberComparisonTable comparisons={item.memberComparisons} />
          </DetailSection>

          <DetailSection
            title={
              <>
                Recent Permission History
                <span className="ml-1 text-gray-400 font-normal">(last 20)</span>
              </>
            }
          >
            <HistoryLog entries={toHistoryEntries(item.recentHistory)} />
          </DetailSection>

          {/* Error */}
          {item.error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {item.error}
            </div>
          )}
        </div>
      )}
    />
  );
};
