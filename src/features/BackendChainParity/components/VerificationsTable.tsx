// src/features/BackendChainParity/components/VerificationsTable.tsx

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { NETWORK } from '@belrose/shared';
import type { VerificationOnChainEvent } from '@belrose/shared';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import type { VerificationIntegrityItem } from '../services/credibilityIntegrityService';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

const VERIFICATION_LEVEL: Record<number, string> = {
  1: 'Provenance',
  2: 'Content',
  3: 'Full',
};

interface VerificationsTableProps {
  items: VerificationIntegrityItem[];
  searchQuery: string;
  onClearSearch: () => void;
}

function ChainStateCell({ item }: { item: VerificationIntegrityItem }) {
  if (item.integrityStatus === 'pending' || item.integrityStatus === 'failed') {
    return <span className="text-gray-400">—</span>;
  }
  if (!item.existsOnChain || item.integrityStatus === 'missing') {
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
  return <span className="font-medium text-emerald-600">Active</span>;
}

function toHistoryEntries(history: VerificationOnChainEvent[] | undefined): HistoryLogEntry[] {
  return [...(history ?? [])].reverse().map((entry, i) => ({
    key: i,
    badge: (
      <>
        <span className="px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700 capitalize">
          {entry.action}
        </span>
        {entry.fromLevel !== undefined && entry.toLevel !== undefined && (
          <span className="text-gray-500">
            {VERIFICATION_LEVEL[entry.fromLevel] ?? entry.fromLevel}
            {' → '}
            {VERIFICATION_LEVEL[entry.toLevel] ?? entry.toLevel}
          </span>
        )}
      </>
    ),
    txHash: entry.blockchainRef?.txHash,
    timestamp: entry.at,
  }));
}

const columns: IntegrityTableColumn<VerificationIntegrityItem>[] = [
  {
    header: 'Status',
    cell: item => <IntegrityStatusBadge status={item.integrityStatus} />,
  },
  {
    header: 'Record ID',
    cellClassName: 'px-4 py-3 font-mono text-xs text-gray-500',
    cell: item => <CopyableHash value={item.recordId} />,
  },
  {
    header: 'Verifier',
    cell: item => (
      <div className="flex flex-col">
        <div className="font-mono text-xs text-gray-600">
          ID: <CopyableHash value={item.verifierId} chars={10} />
        </div>
        <div className="font-mono text-xs text-gray-400">
          #: <CopyableHash value={item.verifierIdHash} chars={10} />
        </div>
      </div>
    ),
  },
  {
    header: 'Record Hash',
    cellClassName: 'px-4 py-3 font-mono text-xs text-gray-500',
    cell: item => <CopyableHash value={item.recordHash} />,
  },
  {
    header: 'Level',
    cellClassName: 'px-4 py-3 text-xs text-gray-600',
    cell: item => (item.level ? (VERIFICATION_LEVEL[item.level] ?? item.level) : '—'),
  },
  {
    header: 'Chain State',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item => <ChainStateCell item={item} />,
  },
  {
    header: 'Latest Tx',
    cell: item =>
      item.blockchainRef?.txHash && (
        <a
          href={`${BASESCAN_TX_URL}${item.blockchainRef.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ),
  },
];

export const VerificationsTable: React.FC<VerificationsTableProps> = ({
  items,
  searchQuery,
  onClearSearch,
}) => (
  <IntegrityTable
    items={items}
    rowKey={item => `${item.recordHash}_${item.verifierIdHash}`}
    columns={columns}
    emptyMessage="No verifications match the current filter."
    searchQuery={searchQuery}
    onClearSearch={onClearSearch}
    renderDetail={item => (
      <DetailSection title="On-Chain History">
        <HistoryLog
          entries={toHistoryEntries(item.onChainHistory)}
          emptyMessage="No on-chain history recorded"
        />
      </DetailSection>
    )}
  />
);
