// src/features/BackendChainParity/components/SyncQueueTable.tsx

import React, { useState } from 'react';
import type { SyncQueueRecord } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { decodeRevertReason } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';

// Strips long hex blobs so the table cell stays readable.
function truncateError(error: string): string {
  const cleaned = error.replace(/0x[0-9a-f]{40,}/gi, '[hex…]');
  return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned;
}

type QueueStatusFilter = 'all' | 'pending' | 'confirmed' | 'failed';

const STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  resolved: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

interface SyncQueueTableProps {
  items: SyncQueueRecord[];
  searchQuery: string;
  onClearSearch: () => void;
}

const columns: IntegrityTableColumn<SyncQueueRecord>[] = [
  {
    header: 'Status',
    cell: item => (
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[item.status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}
      >
        {item.status ?? '—'}
      </span>
    ),
  },
  {
    header: 'Contract',
    cell: item => (
      <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 border border-purple-200 font-medium">
        {item.contract}
      </span>
    ),
  },
  {
    header: 'Action',
    cellClassName: 'px-4 py-3 text-xs font-mono text-gray-600',
    cell: item => item.action,
  },
  {
    header: 'User ID',
    cellClassName: 'px-4 py-3 text-xs font-mono text-gray-400',
    cell: item => `${item.userId.slice(0, 10)}…`,
  },
  {
    header: 'Error',
    cellClassName: 'px-4 py-3 text-xs text-red-600 max-w-xs',
    cell: item => {
      const decodedReason = item.error ? decodeRevertReason(item.error) : null;
      if (decodedReason) return <span className="font-medium">{decodedReason}</span>;
      if (item.error) return <span title={item.error}>{truncateError(item.error)}</span>;
      return <span className="text-gray-400">—</span>;
    },
  },
  {
    header: 'Retries',
    cellClassName: 'px-4 py-3 text-xs text-gray-600 text-center',
    cell: item => item.retryCount ?? 0,
  },
  {
    header: 'Created',
    cellClassName: 'px-4 py-3 text-xs text-gray-400',
    cell: item => formatTimestamp(item.createdAt),
  },
  {
    header: 'Last Attempt',
    cellClassName: 'px-4 py-3 text-xs text-gray-400',
    cell: item => formatTimestamp(item.lastAttemptAt),
  },
];

export const SyncQueueTable: React.FC<SyncQueueTableProps> = ({
  items,
  searchQuery,
  onClearSearch,
}) => {
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>('all');

  const counts = {
    all: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    confirmed: items.filter(i => i.status === 'confirmed' || i.status === 'resolved').length,
    failed: items.filter(i => i.status === 'failed').length,
  };

  const filtered = items.filter(item => {
    if (statusFilter === 'pending' && item.status !== 'pending') return false;
    if (statusFilter === 'confirmed' && item.status !== 'confirmed' && item.status !== 'resolved')
      return false;
    if (statusFilter === 'failed' && item.status !== 'failed') return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.contract.toLowerCase().includes(q) ||
      item.action.toLowerCase().includes(q) ||
      (item.error ?? '').toLowerCase().includes(q) ||
      item.userId.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {(['all', 'pending', 'confirmed', 'failed'] as QueueStatusFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s} ({counts[s]})
          </button>
        ))}
      </div>

      <IntegrityTable
        items={filtered}
        rowKey={item => item.id}
        columns={columns}
        emptyMessage={
          items.length === 0
            ? 'No sync queue entries found.'
            : 'No entries match the current filter.'
        }
        searchQuery={searchQuery}
        onClearSearch={onClearSearch}
        renderDetail={item => {
          const decodedReason = item.error ? decodeRevertReason(item.error) : null;
          const { type: contextType, ...contextFields } = item.context;

          return (
            <DetailSection title="Sync Attempt Details">
              <div className="flex flex-col gap-4">
                {decodedReason && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      Decoded Revert Reason
                    </p>
                    <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium">
                      {decodedReason}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    Operation Context
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-mono text-xs">
                      {contextType}
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                    {Object.entries(contextFields).map(([key, value]) => (
                      <div key={key} className="flex gap-2 text-xs">
                        <span className="text-gray-500 font-medium shrink-0">{key}:</span>
                        <span className="font-mono text-gray-700 break-all">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {item.error ? (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Full Error</p>
                    <pre className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                      {item.error}
                    </pre>
                  </div>
                ) : (
                  item.txHash && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        Confirmed Transaction
                      </p>
                      <p className="text-xs font-mono text-gray-600 break-all">
                        {item.txHash} (block {item.blockNumber})
                      </p>
                    </div>
                  )
                )}
              </div>
            </DetailSection>
          );
        }}
      />
    </div>
  );
};
