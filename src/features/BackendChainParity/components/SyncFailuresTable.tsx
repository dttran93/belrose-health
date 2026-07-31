// src/features/BackendChainParity/components/SyncFailuresTable.tsx

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SyncQueueRecord } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { decodeRevertReason } from '@/features/BlockchainWallet/services/blockchainSyncQueueService';
import { formatTimestamp } from '@/utils/dataFormattingUtils';

// Strips long hex blobs so the table cell stays readable.
function truncateError(error: string): string {
  const cleaned = error.replace(/0x[0-9a-f]{40,}/gi, '[hex…]');
  return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned;
}

interface SyncFailuresTableProps {
  items: SyncQueueRecord[];
  searchQuery: string;
}

const TOTAL_COLS = 9;

export const SyncFailuresTable: React.FC<SyncFailuresTableProps> = ({ items, searchQuery }) => {
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
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.contract.toLowerCase().includes(q) ||
      item.action.toLowerCase().includes(q) ||
      (item.error ?? '').toLowerCase().includes(q) ||
      item.userId.toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        {items.length === 0
          ? 'No sync failures found. All blockchain writes appear successful.'
          : 'No failures match the current search.'}
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-xl border border-gray-200 max-h-[80vh]">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th className="px-2 py-3 w-6" />
            <th className="px-4 py-3 text-left font-medium text-gray-600">Contract</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">User ID</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Error</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Retries</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Last Attempt</th>
          </tr>
        </thead>
        <tbody className="divide-y text-left divide-gray-100">
          {filtered.map(item => {
            const isExpanded = expandedRows.has(item.id);
            const decodedReason = item.error ? decodeRevertReason(item.error) : null;
            const { type: contextType, ...contextFields } = item.context;

            return (
              <React.Fragment key={item.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-2 py-3">
                    <button
                      onClick={() => toggleRow(item.id)}
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
                    <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 border border-purple-200 font-medium">
                      {item.contract}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-600">{item.action}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-400">
                    {item.userId.slice(0, 10)}…
                  </td>
                  <td className="px-4 py-3 text-xs text-red-600 max-w-xs">
                    {decodedReason ? (
                      <span className="font-medium">{decodedReason}</span>
                    ) : item.error ? (
                      <span title={item.error}>{truncateError(item.error)}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 text-center">
                    {item.retryCount ?? 0}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded ${
                        item.status === 'resolved' || item.status === 'confirmed'
                          ? 'bg-green-100 text-green-700'
                          : item.status === 'pending'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {item.status ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {formatTimestamp(item.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {formatTimestamp(item.lastAttemptAt)}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <td />
                    <td colSpan={TOTAL_COLS - 1} className="px-6 py-4">
                      <div className="flex flex-col gap-4">
                        {/* Decoded revert reason */}
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

                        {/* Operation context */}
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
                                <span className="font-mono text-gray-700 break-all">
                                  {String(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Raw error, or the confirmed tx if this attempt succeeded */}
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
