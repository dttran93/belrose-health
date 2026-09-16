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
import { ExternalLink, Loader2, PlayCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import { NETWORK } from '@belrose/shared';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import { CopyableHash } from './ui/CopyableHash';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import type { ChainEventCacheRecord } from '../hooks/useChainEventCache';
import type { ChainEventReconciliationStatus } from '../lib/types';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

interface ChainIndexerCycleResult {
  scannedFromBlock: number;
  scannedToBlock: number;
  eventsFound: number;
  newlyCached: number;
  reconciledUnclassified: number;
}

// One entry per contract the indexer covers (see functions/src/chainIndexer/chainEventIndexerService.ts's
// CHAIN_INDEXER_CONTRACTS) — a single contract's transient RPC failure is caught and recorded per
// contract rather than failing the whole callable, so this can never assume every contract
// succeeded.
interface RecomputeChainEventIndexResult {
  success: boolean;
  results: Record<string, ChainIndexerCycleResult | { error: string }>;
}

function isCycleError(
  result: ChainIndexerCycleResult | { error: string }
): result is { error: string } {
  return 'error' in result;
}

// A full historical backfill can legitimately take several minutes (see
// functions/src/handlers/chainEventIndexer.ts's timeoutSeconds: 540) — the Firebase JS SDK's
// httpsCallable defaults to a 70s client-side timeout, which would show a spurious error while
// the backend keeps working regardless. Extend it to comfortably exceed the backend's own limit.
const RECOMPUTE_TIMEOUT_MS = 560_000;

type StatusFilter = 'all' | ChainEventReconciliationStatus;

const STATUS_STYLE: Record<ChainEventReconciliationStatus, string> = {
  unclassified: 'bg-gray-100 text-gray-600',
  matched: 'bg-green-100 text-green-700',
  legitimate_chain_only: 'bg-blue-100 text-blue-700',
  sync_queue_confirmed_missing_write: 'bg-red-100 text-red-700',
  admin_untracked: 'bg-amber-100 text-amber-700',
  deactivated_tracked: 'bg-purple-100 text-purple-700',
  infrastructure: 'bg-slate-100 text-slate-600',
  infrastructure_admin_mismatch: 'bg-orange-100 text-orange-700',
};

const STATUS_LABEL: Record<ChainEventReconciliationStatus, string> = {
  unclassified: 'Unclassified',
  matched: 'Matched',
  legitimate_chain_only: 'Chain-Only (Expected)',
  sync_queue_confirmed_missing_write: 'Sync Confirmed, Write Missing',
  admin_untracked: 'Admin Write Untracked',
  deactivated_tracked: 'Deactivated, Tracked',
  infrastructure: 'Infrastructure',
  infrastructure_admin_mismatch: 'Admin Key Mismatch',
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
  const queryClient = useQueryClient();

  // Manually forces a cycle of the indexer (functions/src/handlers/chainEventIndexer.ts) instead
  // of waiting for its 15-minute schedule — same admin-callable the schedule itself calls into
  // (runChainEventIndexerCycle), so there's no separate code path to keep in sync. Safe to fire
  // even if the scheduled run happens to be mid-flight: every write here is idempotent (composite
  // doc IDs on chainEventCache, last-write-wins on the checkpoint), so an overlapping run just
  // does some redundant scanning, never corrupts anything.
  const recomputeMutation = useMutation({
    mutationFn: async () => {
      const recompute = httpsCallable<Record<string, never>, RecomputeChainEventIndexResult>(
        getFunctions(),
        'recomputeChainEventIndex',
        { timeout: RECOMPUTE_TIMEOUT_MS }
      );
      const result = await recompute({});
      return result.data;
    },
    onSuccess: data => {
      const entries = Object.entries(data.results);
      const failed = entries.filter(([, result]) => isCycleError(result));
      const succeeded = entries.filter(
        (entry): entry is [string, ChainIndexerCycleResult] => !isCycleError(entry[1])
      );

      if (succeeded.length > 0) {
        const totals = succeeded.reduce(
          (acc, [, result]) => ({
            eventsFound: acc.eventsFound + result.eventsFound,
            newlyCached: acc.newlyCached + result.newlyCached,
            reconciledUnclassified: acc.reconciledUnclassified + result.reconciledUnclassified,
          }),
          { eventsFound: 0, newlyCached: 0, reconciledUnclassified: 0 }
        );
        toast.success(
          `Indexer run complete (${succeeded.map(([contract]) => contract).join(', ')}) — ` +
            `${totals.eventsFound} event(s) found, ${totals.newlyCached} newly cached, ` +
            `${totals.reconciledUnclassified} lingering event(s) reconciled.`
        );
      }
      for (const [contract, result] of failed) {
        if (isCycleError(result)) {
          toast.error(`${contract} indexer run failed: ${result.error}`);
        }
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Indexer run failed');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['backend-chain-parity', 'chain-events'] });
      // Slice 1's Members tab also reads chainEventCache (legitimate_chain_only rows) — refresh
      // it too so a manual run's results show up there without a separate manual refresh.
      queryClient.invalidateQueries({ queryKey: ['backend-chain-parity', 'members'] });
    },
  });

  const counts: Record<StatusFilter, number> = {
    all: items.length,
    unclassified: items.filter(i => i.reconciliationStatus === 'unclassified').length,
    matched: items.filter(i => i.reconciliationStatus === 'matched').length,
    legitimate_chain_only: items.filter(i => i.reconciliationStatus === 'legitimate_chain_only').length,
    sync_queue_confirmed_missing_write: items.filter(i => i.reconciliationStatus === 'sync_queue_confirmed_missing_write')
      .length,
    admin_untracked: items.filter(i => i.reconciliationStatus === 'admin_untracked').length,
    deactivated_tracked: items.filter(i => i.reconciliationStatus === 'deactivated_tracked').length,
    infrastructure: items.filter(i => i.reconciliationStatus === 'infrastructure').length,
    infrastructure_admin_mismatch: items.filter(i => i.reconciliationStatus === 'infrastructure_admin_mismatch')
      .length,
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
    { value: 'infrastructure_admin_mismatch', label: 'Admin Key Mismatch' },
    { value: 'legitimate_chain_only', label: 'Chain-Only (Expected)' },
    { value: 'deactivated_tracked', label: 'Deactivated, Tracked' },
    { value: 'matched', label: 'Matched' },
    { value: 'infrastructure', label: 'Infrastructure' },
    { value: 'unclassified', label: 'Unclassified' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
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

        <button
          onClick={() => recomputeMutation.mutate()}
          disabled={recomputeMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {recomputeMutation.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Running indexer…
            </>
          ) : (
            <>
              <PlayCircle className="w-3.5 h-3.5" />
              Run Indexer Now
            </>
          )}
        </button>
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
