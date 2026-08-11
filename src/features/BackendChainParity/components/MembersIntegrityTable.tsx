// src/features/BackendChainParity/components/MembersIntegrityTable.tsx

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { IntegrityStatusBadge } from './IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import type { IntegrityStatus, LinkedWalletRecord, onChainIdentityStatus } from '../lib/types';
import { MemberIntegrityItem } from '../services/memberIntegrityService';
import { NETWORK } from '@belrose/shared';

const BASESCAN_ADDR_URL = `${NETWORK.explorerUrl}/address/`;
const BASESCAN_TX_URL = `${NETWORK.explorerUrl}/tx/`;

// Mirrors MemberRoleManager.sol's MemberStatus enum exactly — there is no "Guest" status
// on-chain; guests are deliberately kept off the blockchain entirely.
const MEMBER_STATUS_LABEL: Record<number, string> = {
  0: 'NotRegistered',
  1: 'Inactive',
  2: 'Active',
  3: 'Verified',
  4: 'VerifiedProvider',
};

const WALLET_TYPE_LABEL: Record<string, string> = {
  eoa: 'EOA',
  'smart-account': 'Smart Account',
};

interface MembersIntegrityTableProps {
  items: MemberIntegrityItem[];
  searchQuery: string;
  statusFilter: IntegrityStatus | 'all';
  onClearSearch: () => void;
}

function AccountTypeBadge({
  isGuest,
  isDependent,
  isPlatformAdmin,
}: {
  isGuest?: boolean;
  isDependent?: boolean;
  isPlatformAdmin?: boolean;
}) {
  if (isGuest) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
        Guest
      </span>
    );
  }
  if (isDependent) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
        Dependent
      </span>
    );
  }
  if (isPlatformAdmin) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-700">
        Admin
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Member
    </span>
  );
}

function FirestoreStatusBadge({
  isGuest,
  identityVerified,
  healthcareProviderVerified,
}: {
  isGuest?: boolean;
  identityVerified?: boolean;
  healthcareProviderVerified?: boolean;
}) {
  if (isGuest) {
    return <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">Guest</span>;
  }
  if (healthcareProviderVerified) {
    return (
      <span className="px-2 py-0.5 rounded text-xs bg-teal-100 text-teal-700">
        Provider Verified
      </span>
    );
  }
  if (identityVerified) {
    return (
      <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">ID Verified</span>
    );
  }
  return <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">Active</span>;
}

function WalletCards({ wallets }: { wallets: LinkedWalletRecord[] }) {
  if (wallets.length === 0) {
    return <p className="text-xs text-gray-400 italic">No wallet records in Firestore</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {wallets.map((w, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`px-1.5 py-0.5 rounded font-medium ${
              w.isWalletActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {WALLET_TYPE_LABEL[w.type ?? ''] ?? w.type ?? 'Unknown'}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-xs ${
              w.isWalletActive ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
            }`}
          >
            {w.isWalletActive ? 'Active' : 'Inactive'}
          </span>
          <div className="flex items-center gap-1 font-mono text-gray-600">
            <CopyableHash value={w.address} chars={8} />
            <a
              href={`${BASESCAN_ADDR_URL}${w.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {w.blockchainRef?.txHash && (
            <div className="flex items-center gap-1 text-gray-400">
              <span>Tx:</span>
              <CopyableHash value={w.blockchainRef.txHash} chars={8} className="font-mono" />
              <a
                href={`${BASESCAN_TX_URL}${w.blockchainRef.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusHistoryCards({ history }: { history: onChainIdentityStatus[] }) {
  if (history.length === 0) {
    return <p className="text-xs text-gray-400 italic">No status history recorded</p>;
  }

  const sorted = [...history].reverse();

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((entry, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700">
            {entry.status}
          </span>
          {entry.statusUpdatedAt && (
            <span className="text-gray-400">{formatTimestamp(entry.statusUpdatedAt)}</span>
          )}
          {entry.statusBlockchainRef?.txHash && (
            <div className="flex items-center gap-1 text-gray-400">
              <span>Tx:</span>
              <CopyableHash
                value={entry.statusBlockchainRef.txHash}
                chars={8}
                className="font-mono"
              />
              <a
                href={`${BASESCAN_TX_URL}${entry.statusBlockchainRef.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const MembersIntegrityTable: React.FC<MembersIntegrityTableProps> = ({
  items,
  searchQuery,
  statusFilter,
  onClearSearch,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (uid: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  const filtered = items.filter(item => {
    if (statusFilter !== 'all' && item.integrityStatus !== statusFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.uid.toLowerCase().includes(q) ||
      item.displayName.toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q) ||
      (item.userIdHash?.toLowerCase().includes(q) ?? false) ||
      (item.firestoreWalletAddress?.toLowerCase().includes(q) ?? false)
    );
  });

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>No members match the current filter.</p>
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

  const TOTAL_COLS = 9;

  return (
    <div className="overflow-auto rounded-xl border border-gray-200 max-h-[80vh]">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th className="px-2 py-3 w-6" />
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Identity</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Account Type</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Firestore Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">On-Chain Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Wallets</th>
          </tr>
        </thead>
        <tbody className="divide-y text-left divide-gray-100">
          {filtered.map(item => {
            const isExpanded = expandedRows.has(item.uid);
            const walletCount = item.linkedWallets?.length ?? 0;

            return (
              <React.Fragment key={item.uid}>
                <tr className="hover:bg-gray-50">
                  <td className="px-2 py-3">
                    <button
                      onClick={() => toggleRow(item.uid)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={isExpanded ? 'Collapse wallets' : 'Expand wallets'}
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
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-sm">{item.displayName}</div>
                    <div className="text-xs text-gray-400">{item.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <div className="font-mono text-xs text-gray-600">
                        ID: <CopyableHash value={item.uid} chars={10} />
                      </div>
                      <div className="font-mono text-xs text-gray-400">
                        #: {item.userIdHash && <CopyableHash value={item.userIdHash} chars={10} />}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <AccountTypeBadge
                      isGuest={item.isGuest}
                      isDependent={item.isDependent}
                      isPlatformAdmin={item.isPlatformAdmin}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <FirestoreStatusBadge
                      isGuest={item.isGuest}
                      identityVerified={item.identityVerified}
                      healthcareProviderVerified={item.healthcareProviderVerified}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {item.onChainStatus !== undefined ? (
                      <span
                        className={`px-2 py-0.5 rounded ${
                          item.statusMismatch
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {MEMBER_STATUS_LABEL[item.onChainStatus] ?? item.onChainStatus}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <button
                      onClick={() => toggleRow(item.uid)}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        walletCount > 0
                          ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          : 'bg-gray-100 text-gray-400 cursor-default'
                      }`}
                    >
                      {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <td />
                    <td colSpan={TOTAL_COLS - 1} className="px-6 py-4">
                      <div className="flex gap-8">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-500 mb-2">Wallets</p>
                          <WalletCards wallets={item.linkedWallets ?? []} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-500 mb-2">
                            On-Chain Status History
                          </p>
                          <StatusHistoryCards history={item.onChainStatusHistory ?? []} />
                        </div>
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
