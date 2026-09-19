// src/features/BackendChainParity/components/SyncQueueTable.tsx

import React, { useState } from 'react';
import { Loader2, RotateCw, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';
import {
  BlockchainSyncQueueService,
  type SyncQueueRecord,
  type SyncQueueReviewStatus,
} from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { decodeRevertReason } from '@belrose/shared';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import { useAuth } from '@/features/Auth/hooks/useAuth';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';

// Strips long hex blobs so the table cell stays readable.
function truncateError(error: string): string {
  const cleaned = error.replace(/0x[0-9a-f]{40,}/gi, '[hex…]');
  return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned;
}

// The only sync-queue actions a Cloud Function can actually retry — everything else is signed
// by the acting end-user's own client-side key, which no server-side action has access to. Keep
// in sync with functions/src/services/blockchainSyncRetryService.ts's REPLAY_REGISTRY keys.
const RETRYABLE_ACTIONS = new Set([
  'addMember',
  'setUserStatus',
  'initializeRoleOnChain',
  'flagUnacceptedUpdate',
  'revokeUnacceptedFlag',
]);

interface RetryResult {
  outcome: 'tx-confirmed' | 'already-done';
  txHash?: string;
  reason?: string;
}

type QueueStatusFilter = 'all' | 'pending' | 'confirmed' | 'failed';

// Chain outcome only — see SyncQueueReviewStatus (blockchainSyncQueueService.ts) for why human
// triage is deliberately a separate axis, not folded in here. 'resolved' used to appear in this
// map even though nothing ever wrote status: 'resolved' — dead code from before that axis existed
// as its own field; removed now that reviewStatus is the real thing to render.
const STATUS_STYLE: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

const REVIEW_STATUS_STYLE: Record<SyncQueueReviewStatus, string> = {
  resolved: 'bg-green-100 text-green-700',
  unreviewed: 'bg-gray-100 text-gray-500',
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
    // Human triage — deliberately separate from Status above (chain outcome). See
    // SyncQueueReviewStatus's own doc comment for why these two axes never merge.
    header: 'Review',
    cell: item => {
      const reviewStatus = item.reviewStatus ?? 'unreviewed';
      const noteCount = item.reviewNotes?.length ?? 0;
      return (
        <span className="inline-flex items-center gap-1">
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${REVIEW_STATUS_STYLE[reviewStatus]}`}
          >
            {reviewStatus}
          </span>
          {noteCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-gray-400">
              <MessageSquare className="w-3 h-3" />
              {noteCount}
            </span>
          )}
        </span>
      );
    },
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
  // Draft note text per row, keyed by doc id — several rows can be expanded/mid-draft at once.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidateSyncQueue = () =>
    queryClient.invalidateQueries({ queryKey: ['backend-chain-parity', 'sync-queue'] });

  const addNoteMutation = useMutation({
    mutationFn: async ({ docId, text }: { docId: string; text: string }) => {
      if (!user) throw new Error('Not authenticated');
      await BlockchainSyncQueueService.addReviewNote(docId, text, user.uid);
    },
    onSuccess: (_data, { docId }) => {
      setNoteDrafts(prev => ({ ...prev, [docId]: '' }));
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add note');
    },
    onSettled: invalidateSyncQueue,
  });

  const reviewStatusMutation = useMutation({
    mutationFn: async ({
      docId,
      reviewStatus,
    }: {
      docId: string;
      reviewStatus: 'unreviewed' | 'resolved';
    }) => BlockchainSyncQueueService.setReviewStatus(docId, reviewStatus),
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update review status');
    },
    onSettled: invalidateSyncQueue,
  });

  const retryMutation = useMutation({
    mutationFn: async (docId: string) => {
      const retry = httpsCallable<{ docId: string }, RetryResult>(
        getFunctions(),
        'adminRetryBlockchainSync'
      );
      const result = await retry({ docId });
      return result.data;
    },
    onSuccess: data => {
      toast.success(
        data.outcome === 'tx-confirmed'
          ? 'Transaction confirmed on-chain'
          : // "resolved" here would now read as if it set reviewStatus, which this doesn't touch —
            // this only reflects that the underlying chain state was already correct (status
            // flipped to 'confirmed' server-side); worded to avoid that ambiguity.
            'Already completed on-chain — status updated to confirmed'
      );
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Retry failed');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['backend-chain-parity', 'sync-queue'] });
    },
  });

  const counts = {
    all: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    confirmed: items.filter(i => i.status === 'confirmed').length,
    failed: items.filter(i => i.status === 'failed').length,
  };

  const filtered = items.filter(item => {
    if (statusFilter === 'pending' && item.status !== 'pending') return false;
    if (statusFilter === 'confirmed' && item.status !== 'confirmed') return false;
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
                    <p className="text-xs font-medium text-gray-500 mb-1">Decoded Revert Reason</p>
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

                {/* Only the 5 admin-wallet-signed actions can be retried server-side — every
                    other action here is signed by the acting end-user's own client-side key. */}
                {item.status === 'failed' && RETRYABLE_ACTIONS.has(item.action) && (
                  <div className="pt-1 border-t border-gray-100">
                    <button
                      onClick={() => retryMutation.mutate(item.id)}
                      disabled={retryMutation.isPending && retryMutation.variables === item.id}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {retryMutation.isPending && retryMutation.variables === item.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Retrying…
                        </>
                      ) : (
                        <>
                          <RotateCw className="w-3.5 h-3.5" />
                          Retry
                        </>
                      )}
                    </button>
                  </div>
                )}

                <div className="pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-500">Review &amp; Notes</p>
                    <button
                      onClick={() =>
                        reviewStatusMutation.mutate({
                          docId: item.id,
                          reviewStatus:
                            item.reviewStatus === 'resolved' ? 'unreviewed' : 'resolved',
                        })
                      }
                      disabled={
                        reviewStatusMutation.isPending &&
                        reviewStatusMutation.variables?.docId === item.id
                      }
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        item.reviewStatus === 'resolved'
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {item.reviewStatus === 'resolved' ? 'Reopen' : 'Mark Resolved'}
                    </button>
                  </div>

                  {item.reviewNotes && item.reviewNotes.length > 0 && (
                    <div className="flex flex-col gap-2 mb-3">
                      {item.reviewNotes.map((note, i) => (
                        <div
                          key={i}
                          className="text-xs bg-white border border-gray-200 rounded-lg p-2"
                        >
                          <p className="text-gray-700 whitespace-pre-wrap break-words">
                            {note.text}
                          </p>
                          <p className="text-gray-400 mt-1">
                            {note.by} · {formatTimestamp(note.at)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <textarea
                      value={noteDrafts[item.id] ?? ''}
                      onChange={e =>
                        setNoteDrafts(prev => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder="e.g. confirmed transient RPC blip, no code change needed"
                      rows={2}
                      className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                    <button
                      onClick={() => {
                        const text = (noteDrafts[item.id] ?? '').trim();
                        if (!text) return;
                        addNoteMutation.mutate({ docId: item.id, text });
                      }}
                      disabled={
                        !(noteDrafts[item.id] ?? '').trim() ||
                        (addNoteMutation.isPending && addNoteMutation.variables?.docId === item.id)
                      }
                      className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {addNoteMutation.isPending && addNoteMutation.variables?.docId === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <MessageSquare className="w-3.5 h-3.5" />
                      )}
                      Add Note
                    </button>
                  </div>
                </div>
              </div>
            </DetailSection>
          );
        }}
      />
    </div>
  );
};
