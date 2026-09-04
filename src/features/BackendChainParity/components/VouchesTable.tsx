// src/features/BackendChainParity/components/VouchesTable.tsx

import React from 'react';
import type { VouchOnChainEvent } from '@belrose/shared';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import type { VouchIntegrityItem } from '../services/credibilityIntegrityService';

interface VouchesTableProps {
  items: VouchIntegrityItem[];
  searchQuery: string;
  onClearSearch: () => void;
}

function ChainStateCell({ item }: { item: VouchIntegrityItem }) {
  if (item.integrityStatus === 'pending' || item.integrityStatus === 'failed') {
    return <span className="text-gray-400">—</span>;
  }
  if (item.integrityStatus === 'missing') {
    return <span className="font-medium text-red-600">Not Found</span>;
  }
  if (item.mismatchReasons && item.mismatchReasons.length > 0) {
    return (
      <ul className="space-y-0.5">
        {item.mismatchReasons.map((reason, i) => (
          <li key={i} className="text-amber-700">
            {reason}
          </li>
        ))}
      </ul>
    );
  }
  const label = item.chainStatus === 'Active' ? 'Active' : (item.chainStatus ?? '—');
  const color = item.chainStatus === 'Active' ? 'text-emerald-600' : 'text-gray-500';
  return <span className={`font-medium ${color}`}>{label}</span>;
}

function toHistoryEntries(history: VouchOnChainEvent[] | undefined): HistoryLogEntry[] {
  return [...(history ?? [])].reverse().map((entry, i) => ({
    key: i,
    badge: (
      <span className="px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700 capitalize">
        {entry.action}
      </span>
    ),
    txHash: entry.blockchainRef?.txHash,
    timestamp: entry.at,
  }));
}

const columns: IntegrityTableColumn<VouchIntegrityItem>[] = [
  {
    header: 'Status',
    cell: item => <IntegrityStatusBadge status={item.integrityStatus} />,
  },
  {
    header: 'Voucher',
    cell: item => (
      <div className="flex flex-col">
        <div className="font-mono text-xs text-gray-600">
          ID: <CopyableHash value={item.voucherId} chars={10} />
        </div>
        <div className="font-mono text-xs text-gray-400">
          #: <CopyableHash value={item.voucherIdHash} chars={10} />
        </div>
      </div>
    ),
  },
  {
    header: 'Vouchee',
    cell: item => (
      <div className="flex flex-col">
        <div className="font-mono text-xs text-gray-600">
          ID: <CopyableHash value={item.voucheeId} chars={10} />
        </div>
        <div className="font-mono text-xs text-gray-400">
          #: <CopyableHash value={item.voucheeIdHash} chars={10} />
        </div>
      </div>
    ),
  },
  {
    header: 'Firestore Status',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item => (
      <span
        className={`px-2 py-0.5 rounded font-medium ${
          item.chainStatus === 'Active'
            ? 'bg-emerald-50 text-emerald-700'
            : item.chainStatus === 'Retracted'
              ? 'bg-red-50 text-red-600'
              : 'bg-gray-100 text-gray-500'
        }`}
      >
        {item.chainStatus}
      </span>
    ),
  },
  {
    header: 'Chain State',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item => <ChainStateCell item={item} />,
  },
  {
    header: 'Created',
    cellClassName: 'px-4 py-3 text-xs text-gray-500',
    cell: item => (item.createdAt ? formatTimestamp(item.createdAt) : '—'),
  },
];

export const VouchesTable: React.FC<VouchesTableProps> = ({
  items,
  searchQuery,
  onClearSearch,
}) => (
  <IntegrityTable
    items={items}
    rowKey={item => item.vouchId}
    columns={columns}
    emptyMessage="No vouches match the current filter."
    searchQuery={searchQuery}
    onClearSearch={onClearSearch}
    renderDetail={item => (
      <DetailSection title="On-Chain History">
        <HistoryLog
          entries={toHistoryEntries(item.onChainHistory)}
          emptyMessage="No on-chain history recorded"
        />
        {item.error && <p className="mt-2 text-xs text-red-500 font-mono">{item.error}</p>}
      </DetailSection>
    )}
  />
);
