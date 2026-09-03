// src/features/BackendChainParity/components/HistoryLog.tsx

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { CopyableHash } from './ui/CopyableHash';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import { NETWORK } from '@belrose/shared';
import type { TimestampLike } from '@belrose/shared';

const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

export interface HistoryLogEntry {
  key: string | number;
  /** Action pill(s) / label content for this row — arbitrary so callers keep their own action→style maps. */
  badge: React.ReactNode;
  /** Omit/null when the chain call hasn't resolved yet — renders a "pending confirmation" note instead. */
  txHash?: string | null;
  timestamp?: TimestampLike | null;
}

interface HistoryLogProps {
  entries: HistoryLogEntry[];
  emptyMessage?: string;
}

/**
 * Shared append-only audit-ledger row list, used by every *IntegrityTable's expanded row to
 * render a records/{id}/*History (or trusteeRelationships/{id}/trusteeHistory) subcollection —
 * badge(s) + tx hash/Basescan link (or "pending confirmation") + timestamp per row. Each
 * consuming table maps its own event shape into HistoryLogEntry[] and keeps its own
 * action→label/style maps local, since those differ per concern.
 */
export const HistoryLog: React.FC<HistoryLogProps> = ({
  entries,
  emptyMessage = 'No history recorded',
}) => {
  if (entries.length === 0) {
    return <p className="text-xs text-gray-400 italic">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {entries.map(entry => (
        <div key={entry.key} className="flex flex-wrap items-center gap-1.5 text-xs">
          {entry.badge}
          {entry.txHash ? (
            <>
              <CopyableHash value={entry.txHash} chars={8} className="font-mono text-gray-600" />
              <a
                href={`${BASESCAN_TX_URL}${entry.txHash}`}
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
          {entry.timestamp && (
            <span className="text-gray-400">{formatTimestamp(entry.timestamp)}</span>
          )}
        </div>
      ))}
    </div>
  );
};
