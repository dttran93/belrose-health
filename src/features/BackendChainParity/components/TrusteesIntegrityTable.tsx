// src/features/BackendChainParity/components/TrusteesIntegrityTable.tsx

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { IntegrityStatusBadge } from './IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import type { IntegrityStatus } from '../lib/types';
import type { TrusteeIntegrityItem } from '../services/trusteeIntegrityService';
import { CHAIN_STATUS_LABEL, CHAIN_LEVEL_LABEL } from '../services/trusteeIntegrityService';
import { NETWORK } from '@belrose/shared';
import { TrusteeHistoryEvent } from '@/features/Trustee/services/writeTrusteeHistoryEvent';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

const TRUST_LEVEL_STYLES: Record<string, string> = {
  observer: 'bg-blue-50 text-blue-700',
  custodian: 'bg-purple-50 text-purple-700',
  controller: 'bg-rose-50 text-rose-700',
};

const FIRESTORE_STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  revoked: 'bg-gray-100 text-gray-500',
  declined: 'bg-gray-100 text-gray-500',
};

const CHAIN_STATUS_STYLES: Record<number, string> = {
  0: 'bg-gray-100 text-gray-500',
  1: 'bg-amber-50 text-amber-700',
  2: 'bg-green-50 text-green-700',
  3: 'bg-gray-100 text-gray-500',
};

interface TrusteesIntegrityTableProps {
  items: TrusteeIntegrityItem[];
  searchQuery: string;
  statusFilter: IntegrityStatus | 'all';
  onClearSearch: () => void;
}

const ACTION_LABEL: Record<string, string> = {
  propose: 'Propose',
  accept: 'Accept',
  revoke: 'Revoke',
  decline: 'Decline',
  'level-update': 'Level Update',
};

const ACTION_STYLE: Record<string, string> = {
  propose: 'bg-blue-50 text-blue-700',
  accept: 'bg-green-50 text-green-700',
  revoke: 'bg-gray-100 text-gray-600',
  decline: 'bg-gray-100 text-gray-600',
  'level-update': 'bg-purple-50 text-purple-700',
};

function EventLog({ events }: { events: TrusteeHistoryEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-gray-400 italic">No on-chain events recorded</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((event, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={`px-1.5 py-0.5 rounded font-medium ${ACTION_STYLE[event.action] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {ACTION_LABEL[event.action] ?? event.action}
          </span>
          {event.trustLevel && (
            <span className="text-gray-400 capitalize">· {event.trustLevel}</span>
          )}
          {event.blockchainRef ? (
            <>
              <CopyableHash
                value={event.blockchainRef.txHash}
                chars={8}
                className="font-mono text-gray-600"
              />
              <a
                href={`${BASESCAN_TX_URL}${event.blockchainRef.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </>
          ) : (
            <span className="text-gray-400 italic">pending confirmation</span>
          )}
          {event.changedAt && (
            <span className="text-gray-400">
              {formatTimestamp(
                event.changedAt as unknown as import('@belrose/shared').TimestampLike
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ChainStateCell({ item }: { item: TrusteeIntegrityItem }) {
  if (item.integrityStatus === 'not_applicable') {
    return <span className="text-xs text-gray-400">N/A (declined)</span>;
  }
  if (item.integrityStatus === 'missing') {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
        Not Found
      </span>
    );
  }
  if (item.onChainStatus === undefined) {
    return <span className="text-gray-400">—</span>;
  }

  const statusLabel = CHAIN_STATUS_LABEL[item.onChainStatus] ?? String(item.onChainStatus);
  const statusStyle = CHAIN_STATUS_STYLES[item.onChainStatus] ?? 'bg-gray-100 text-gray-500';
  const levelLabel =
    item.onChainLevel !== undefined
      ? (CHAIN_LEVEL_LABEL[item.onChainLevel] ?? String(item.onChainLevel))
      : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle}`}>
          {statusLabel}
        </span>
        {levelLabel && item.onChainStatus === 2 && (
          <span className="text-xs text-gray-400">· {levelLabel}</span>
        )}
      </div>
    </div>
  );
}

const TOTAL_COLS = 8;

export const TrusteesIntegrityTable: React.FC<TrusteesIntegrityTableProps> = ({
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
      item.trustorId.toLowerCase().includes(q) ||
      item.trusteeId.toLowerCase().includes(q) ||
      item.trustorIdHash.toLowerCase().includes(q) ||
      item.trusteeIdHash.toLowerCase().includes(q) ||
      item.firestoreStatus.toLowerCase().includes(q) ||
      item.firestoreTrustLevel.toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>No trustee relationships match the current filter.</p>
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
            <th className="px-4 py-3 text-left font-medium text-gray-600">Trustor</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Trustee</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Level</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Firestore Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Chain State</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Invite Tx</th>
          </tr>
        </thead>
        <tbody className="divide-y text-left divide-gray-100">
          {filtered.map(item => {
            const isExpanded = expandedRows.has(item.id);
            const proposeEvent = [...item.trusteeHistory]
              .reverse()
              .find(e => e.action === 'propose' && e.blockchainRef);
            const proposeTxHash = proposeEvent?.blockchainRef?.txHash;

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
                    <IntegrityStatusBadge status={item.integrityStatus} />
                  </td>

                  {/* Trustor */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <div className="font-mono text-xs text-gray-600">
                        ID: <CopyableHash value={item.trustorId} chars={10} />
                      </div>
                      <div className="font-mono text-xs text-gray-400">
                        #: <CopyableHash value={item.trustorIdHash} chars={10} />
                      </div>
                    </div>
                  </td>

                  {/* Trustee */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-mono text-xs text-gray-600">
                        ID: <CopyableHash value={item.trusteeId} chars={10} />
                      </div>
                      <div className="font-mono text-xs text-gray-400">
                        #: <CopyableHash value={item.trusteeIdHash} chars={10} />
                      </div>
                      {item.isDependentRelationship && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 self-start mt-0.5">
                          Dependent
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Level */}
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        TRUST_LEVEL_STYLES[item.firestoreTrustLevel] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {item.firestoreTrustLevel}
                    </span>
                  </td>

                  {/* Firestore Status */}
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        FIRESTORE_STATUS_STYLES[item.firestoreStatus] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {item.firestoreStatus}
                    </span>
                  </td>

                  {/* Chain State */}
                  <td className="px-4 py-3">
                    <ChainStateCell item={item} />
                  </td>

                  {/* Invite Tx */}
                  <td className="px-4 py-3">
                    {proposeTxHash ? (
                      <div className="flex items-center gap-1">
                        <CopyableHash
                          value={proposeTxHash}
                          chars={8}
                          className="font-mono text-xs text-gray-500"
                        />
                        <a
                          href={`${BASESCAN_TX_URL}${proposeTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-700"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <td />
                    <td colSpan={TOTAL_COLS - 1} className="px-6 py-4">
                      <div className="flex gap-8 flex-wrap">
                        {/* On-Chain Event Log */}
                        <div className="flex-1 min-w-48">
                          <p className="text-xs font-medium text-gray-500 mb-2">On-Chain Events</p>
                          <EventLog events={item.trusteeHistory} />
                        </div>

                        {/* Timeline */}
                        <div className="flex-1 min-w-48">
                          <p className="text-xs font-medium text-gray-500 mb-2">Timeline</p>
                          <div className="flex flex-col gap-1.5 text-xs">
                            {item.createdAt && (
                              <div className="flex gap-2">
                                <span className="text-gray-500 font-medium w-20 shrink-0">
                                  Created:
                                </span>
                                <span className="text-gray-600">
                                  {formatTimestamp(item.createdAt)}
                                </span>
                              </div>
                            )}
                            {item.respondedAt && (
                              <div className="flex gap-2">
                                <span className="text-gray-500 font-medium w-20 shrink-0">
                                  Responded:
                                </span>
                                <span className="text-gray-600">
                                  {formatTimestamp(item.respondedAt)}
                                </span>
                              </div>
                            )}
                            {item.revokedAt && (
                              <div className="flex gap-2">
                                <span className="text-gray-500 font-medium w-20 shrink-0">
                                  Revoked:
                                </span>
                                <span className="text-gray-600">
                                  {formatTimestamp(item.revokedAt)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Mismatch Details */}
                        {item.mismatchReasons && item.mismatchReasons.length > 0 && (
                          <div className="flex-1 min-w-48">
                            <p className="text-xs font-medium text-gray-500 mb-2">
                              Mismatch Details
                            </p>
                            <div className="flex flex-col gap-1">
                              {item.mismatchReasons.map((reason, i) => (
                                <div
                                  key={i}
                                  className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1"
                                >
                                  {reason}
                                </div>
                              ))}
                            </div>
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
