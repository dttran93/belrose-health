// src/features/BackendChainParity/components/TrusteesIntegrityTable.tsx

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
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

function toHistoryEntries(events: TrusteeHistoryEvent[]): HistoryLogEntry[] {
  return events.map((event, i) => ({
    key: i,
    badge: (
      <>
        <span
          className={`px-1.5 py-0.5 rounded font-medium ${ACTION_STYLE[event.action] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {ACTION_LABEL[event.action] ?? event.action}
        </span>
        {event.trustLevel && (
          <span className="text-gray-400 capitalize">· {event.trustLevel}</span>
        )}
      </>
    ),
    txHash: event.blockchainRef?.txHash,
    timestamp: event.changedAt as unknown as import('@belrose/shared').TimestampLike,
  }));
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

const columns: IntegrityTableColumn<TrusteeIntegrityItem>[] = [
  {
    header: 'Status',
    cell: item => <IntegrityStatusBadge status={item.integrityStatus} />,
  },
  {
    header: 'Trustor',
    cell: item => (
      <div className="flex flex-col">
        <div className="font-mono text-xs text-gray-600">
          ID: <CopyableHash value={item.trustorId} chars={10} />
        </div>
        <div className="font-mono text-xs text-gray-400">
          #: <CopyableHash value={item.trustorIdHash} chars={10} />
        </div>
      </div>
    ),
  },
  {
    header: 'Trustee',
    cell: item => (
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
    ),
  },
  {
    header: 'Level',
    cell: item => (
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
          TRUST_LEVEL_STYLES[item.firestoreTrustLevel] ?? 'bg-gray-100 text-gray-600'
        }`}
      >
        {item.firestoreTrustLevel}
      </span>
    ),
  },
  {
    header: 'Firestore Status',
    cell: item => (
      <span
        className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
          FIRESTORE_STATUS_STYLES[item.firestoreStatus] ?? 'bg-gray-100 text-gray-600'
        }`}
      >
        {item.firestoreStatus}
      </span>
    ),
  },
  {
    header: 'Chain State',
    cell: item => <ChainStateCell item={item} />,
  },
  {
    header: 'Invite Tx',
    cell: item => {
      const proposeEvent = [...item.trusteeHistory]
        .reverse()
        .find(e => e.action === 'propose' && e.blockchainRef);
      const proposeTxHash = proposeEvent?.blockchainRef?.txHash;
      return proposeTxHash ? (
        <div className="flex items-center gap-1">
          <CopyableHash value={proposeTxHash} chars={8} className="font-mono text-xs text-gray-500" />
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
      );
    },
  },
];

export const TrusteesIntegrityTable: React.FC<TrusteesIntegrityTableProps> = ({
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
      item.trustorId.toLowerCase().includes(q) ||
      item.trusteeId.toLowerCase().includes(q) ||
      item.trustorIdHash.toLowerCase().includes(q) ||
      item.trusteeIdHash.toLowerCase().includes(q) ||
      item.firestoreStatus.toLowerCase().includes(q) ||
      item.firestoreTrustLevel.toLowerCase().includes(q)
    );
  });

  return (
    <IntegrityTable
      items={filtered}
      rowKey={item => item.id}
      columns={columns}
      emptyMessage="No trustee relationships match the current filter."
      searchQuery={searchQuery}
      onClearSearch={onClearSearch}
      renderDetail={item => (
        <div className="flex gap-4 flex-wrap">
          <DetailSection title="On-Chain Events" className="flex-1 min-w-48">
            <HistoryLog
              entries={toHistoryEntries(item.trusteeHistory)}
              emptyMessage="No on-chain events recorded"
            />
          </DetailSection>

          <DetailSection title="Timeline" className="flex-1 min-w-48">
            <div className="flex flex-col gap-1.5 text-xs">
              {item.createdAt && (
                <div className="flex gap-2">
                  <span className="text-gray-500 font-medium w-20 shrink-0">Created:</span>
                  <span className="text-gray-600">{formatTimestamp(item.createdAt)}</span>
                </div>
              )}
              {item.respondedAt && (
                <div className="flex gap-2">
                  <span className="text-gray-500 font-medium w-20 shrink-0">Responded:</span>
                  <span className="text-gray-600">{formatTimestamp(item.respondedAt)}</span>
                </div>
              )}
              {item.revokedAt && (
                <div className="flex gap-2">
                  <span className="text-gray-500 font-medium w-20 shrink-0">Revoked:</span>
                  <span className="text-gray-600">{formatTimestamp(item.revokedAt)}</span>
                </div>
              )}
            </div>
          </DetailSection>

          {item.mismatchReasons && item.mismatchReasons.length > 0 && (
            <DetailSection title="Mismatch Details" className="flex-1 min-w-48">
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
            </DetailSection>
          )}
        </div>
      )}
    />
  );
};
