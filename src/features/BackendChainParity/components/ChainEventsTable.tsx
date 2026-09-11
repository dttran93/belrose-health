// src/features/BackendChainParity/components/ChainEventsTable.tsx
//
// Raw view of the chain event indexer's cache (functions/src/chainIndexer/) — the reverse
// direction every other tab in this feature is missing: "does something exist on-chain that
// Firestore has no record of." Mirrors SyncQueueTable.tsx's pattern (a raw log with its own local
// status filter, since reconciliationStatus isn't part of the IntegrityStatus pill vocabulary the
// dashboard's shared filter bar renders).
//
// Defaults to showing everything rather than only the two actionable statuses
// (admin_untracked / sync_queue_confirmed_missing_write) — an admin auditing this tab may want to
// see 'matched'/'legitimate_chain_only' rows too for context, not just the problems.

import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { NETWORK } from '@belrose/shared';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import { CopyableHash } from './ui/CopyableHash';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import type { ChainEventCacheRecord } from '../hooks/useChainEventCache';
import type { ChainEventReconciliationStatus } from '../lib/types';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

type StatusFilter = 'all' | ChainEventReconciliationStatus;

const STATUS_STYLE: Record<ChainEventReconciliationStatus, string> = {
  unclassified: 'bg-gray-100 text-gray-600',
  matched: 'bg-green-100 text-green-700',
  legitimate_chain_only: 'bg-blue-100 text-blue-700',
  sync_queue_confirmed_missing_write: 'bg-red-100 text-red-700',
  admin_untracked: 'bg-amber-100 text-amber-700',
};

const STATUS_LABEL: Record<ChainEventReconciliationStatus, string> = {
  unclassified: 'Unclassified',
  matched: 'Matched',
  legitimate_chain_only: 'Chain-Only (Expected)',
  sync_queue_confirmed_missing_write: 'Sync Confirmed, Write Missing',
  admin_untracked: 'Admin Write Untracked',
};

interface ChainEventsTableProps {
  items: ChainEventCacheRecord[];
  searchQuery: string;
  onClearSearch: () => void;
}

const columns: IntegrityTableColumn<ChainEventCacheRecord>[] = [
  {
    header: 'Status',
    cell: item => (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[item.reconciliationStatus]}`}>
        {STATUS_LABEL[item.reconciliationStatus]}
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
    header: 'Event',
    cellClassName: 'px-4 py-3 text-xs font-mono text-gray-600',
    cell: item => item.eventName,
  },
  {
    header: 'Transaction',
    cellClassName: 'px-4 py-3 text-xs font-mono text-gray-600',
    cell: item => (
      <div className="flex items-center gap-1">
        <CopyableHash value={item.blockchainRef.txHash} chars={8} />
        <a
          href={`${BASESCAN_TX_URL}${item.blockchainRef.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    ),
  },
  {
    header: 'Block',
    cellClassName: 'px-4 py-3 text-xs text-gray-400',
    cell: item => item.blockchainRef.blockNumber,
  },
  {
    header: 'Indexed',
    cellClassName: 'px-4 py-3 text-xs text-gray-400',
    cell: item => formatTimestamp(item.indexedAt),
  },
];

export const ChainEventsTable: React.FC<ChainEventsTableProps> = ({ items, searchQuery, onClearSearch }) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const counts: Record<StatusFilter, number> = {
    all: items.length,
    unclassified: items.filter(i => i.reconciliationStatus === 'unclassified').length,
    matched: items.filter(i => i.reconciliationStatus === 'matched').length,
    legitimate_chain_only: items.filter(i => i.reconciliationStatus === 'legitimate_chain_only').length,
    sync_queue_confirmed_missing_write: items.filter(i => i.reconciliationStatus === 'sync_queue_confirmed_missing_write')
      .length,
    admin_untracked: items.filter(i => i.reconciliationStatus === 'admin_untracked').length,
  };

  const filtered = items.filter(item => {
    if (statusFilter !== 'all' && item.reconciliationStatus !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.eventName.toLowerCase().includes(q) ||
      item.contract.toLowerCase().includes(q) ||
      item.blockchainRef.txHash.toLowerCase().includes(q) ||
      Object.values(item.args).some(v => String(v).toLowerCase().includes(q))
    );
  });

  const filterOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'admin_untracked', label: 'Admin Untracked' },
    { value: 'sync_queue_confirmed_missing_write', label: 'Sync Confirmed, Missing Write' },
    { value: 'legitimate_chain_only', label: 'Chain-Only (Expected)' },
    { value: 'matched', label: 'Matched' },
    { value: 'unclassified', label: 'Unclassified' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {filterOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              statusFilter === opt.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {opt.label} ({counts[opt.value]})
          </button>
        ))}
      </div>

      <IntegrityTable
        items={filtered}
        rowKey={item => item.id}
        columns={columns}
        emptyMessage={items.length === 0 ? 'No chain events indexed yet.' : 'No events match the current filter.'}
        searchQuery={searchQuery}
        onClearSearch={onClearSearch}
        renderDetail={item => (
          <DetailSection title="Event Details">
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Event Args</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                  {Object.entries(item.args).map(([key, value]) => (
                    <div key={key} className="flex gap-2 text-xs">
                      <span className="text-gray-500 font-medium shrink-0">{key}:</span>
                      <span className="font-mono text-gray-700 break-all">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {item.matchedFirestoreRef && (
                <div className="text-xs">
                  <span className="text-gray-500 font-medium">Matched Firestore doc: </span>
                  <span className="font-mono text-gray-700">{item.matchedFirestoreRef}</span>
                </div>
              )}
              {item.matchedSyncQueueId && (
                <div className="text-xs">
                  <span className="text-gray-500 font-medium">Matched blockchainSyncQueue doc: </span>
                  <span className="font-mono text-gray-700">{item.matchedSyncQueueId}</span>
                </div>
              )}
              {item.reconciledAt && (
                <div className="text-xs">
                  <span className="text-gray-500 font-medium">Reconciled at: </span>
                  <span className="text-gray-700">{formatTimestamp(item.reconciledAt)}</span>
                </div>
              )}
            </div>
          </DetailSection>
        )}
      />
    </div>
  );
};
