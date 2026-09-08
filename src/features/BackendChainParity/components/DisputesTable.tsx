// src/features/BackendChainParity/components/DisputesTable.tsx

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { NETWORK } from '@belrose/shared';
import type { DisputeOnChainEvent } from '@belrose/shared';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
import type { DisputeIntegrityItem } from '../services/credibilityIntegrityService';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

const DISPUTE_SEVERITY: Record<number, string> = {
  1: 'Negligible',
  2: 'Moderate',
  3: 'Major',
};

const DISPUTE_CULPABILITY: Record<number, string> = {
  0: 'Unknown',
  1: 'No Fault',
  2: 'Systemic',
  3: 'Preventable',
  4: 'Reckless',
  5: 'Intentional',
};

interface DisputesTableProps {
  items: DisputeIntegrityItem[];
  searchQuery: string;
  onClearSearch: () => void;
}

function ChainStateCell({ item }: { item: DisputeIntegrityItem }) {
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

function toHistoryEntries(history: DisputeOnChainEvent[] | undefined): HistoryLogEntry[] {
  return [...(history ?? [])].reverse().map((entry, i) => ({
    key: i,
    badge: (
      <>
        <span className="px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700 capitalize">
          {entry.action}
        </span>
        {entry.fromSeverity !== undefined && entry.toSeverity !== undefined && (
          <span className="text-gray-500">
            severity: {DISPUTE_SEVERITY[entry.fromSeverity] ?? entry.fromSeverity}
            {' → '}
            {DISPUTE_SEVERITY[entry.toSeverity] ?? entry.toSeverity}
          </span>
        )}
        {entry.fromCulpability !== undefined && entry.toCulpability !== undefined && (
          <span className="text-gray-500">
            culpability: {DISPUTE_CULPABILITY[entry.fromCulpability] ?? entry.fromCulpability}
            {' → '}
            {DISPUTE_CULPABILITY[entry.toCulpability] ?? entry.toCulpability}
          </span>
        )}
      </>
    ),
    txHash: entry.blockchainRef?.txHash,
    timestamp: entry.at,
  }));
}

const columns: IntegrityTableColumn<DisputeIntegrityItem>[] = [
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
    header: 'Disputer',
    cell: item => (
      <div className="flex flex-col">
        <div className="font-mono text-xs text-gray-600">
          ID: <CopyableHash value={item.disputerId} chars={10} />
        </div>
        <div className="font-mono text-xs text-gray-400">
          #: <CopyableHash value={item.disputerIdHash} chars={10} />
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
    header: 'Severity',
    cellClassName: 'px-4 py-3 text-xs text-gray-600',
    cell: item => (item.severity ? (DISPUTE_SEVERITY[item.severity] ?? item.severity) : '—'),
  },
  {
    header: 'Culpability',
    cellClassName: 'px-4 py-3 text-xs text-gray-600',
    cell: item =>
      item.culpability !== undefined
        ? (DISPUTE_CULPABILITY[item.culpability] ?? item.culpability)
        : '—',
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

export const DisputesTable: React.FC<DisputesTableProps> = ({
  items,
  searchQuery,
  onClearSearch,
}) => (
  <IntegrityTable
    items={items}
    rowKey={item => `${item.recordHash}_${item.disputerIdHash}`}
    columns={columns}
    emptyMessage="No disputes match the current filter."
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
