// src/features/BackendChainParity/components/MembersIntegrityTable.tsx

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { IntegrityStatusBadge } from './ui/IntegrityStatusBadge';
import { CopyableHash } from './ui/CopyableHash';
import { HistoryLog, type HistoryLogEntry } from './ui/HistoryLog';
import { IntegrityTable, type IntegrityTableColumn } from './ui/IntegrityTable';
import { DetailSection } from './ui/DetailSection';
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

function toHistoryEntries(history: onChainIdentityStatus[]): HistoryLogEntry[] {
  return [...history].reverse().map((entry, i) => ({
    key: i,
    badge: (
      <span className="px-1.5 py-0.5 rounded font-medium bg-blue-50 text-blue-700">
        {entry.status}
      </span>
    ),
    txHash: entry.statusBlockchainRef?.txHash,
    timestamp: entry.statusUpdatedAt,
  }));
}

const columns: IntegrityTableColumn<MemberIntegrityItem>[] = [
  {
    header: 'Status',
    cell: item => <IntegrityStatusBadge status={item.integrityStatus} />,
  },
  {
    header: 'User',
    cell: item => (
      <>
        <div className="font-medium text-gray-900 text-sm">{item.displayName}</div>
        <div className="text-xs text-gray-400">{item.email}</div>
      </>
    ),
  },
  {
    header: 'Identity',
    cell: item => (
      <div className="flex flex-col">
        <div className="font-mono text-xs text-gray-600">
          ID: <CopyableHash value={item.uid} chars={10} />
        </div>
        <div className="font-mono text-xs text-gray-400">
          #: {item.userIdHash && <CopyableHash value={item.userIdHash} chars={10} />}
        </div>
      </div>
    ),
  },
  {
    header: 'Account Type',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item => (
      <AccountTypeBadge
        isGuest={item.isGuest}
        isDependent={item.isDependent}
        isPlatformAdmin={item.isPlatformAdmin}
      />
    ),
  },
  {
    header: 'Firestore Status',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item => (
      <FirestoreStatusBadge
        isGuest={item.isGuest}
        identityVerified={item.identityVerified}
        healthcareProviderVerified={item.healthcareProviderVerified}
      />
    ),
  },
  {
    header: 'On-Chain Status',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item =>
      item.onChainStatus !== undefined ? (
        <span
          className={`px-2 py-0.5 rounded ${
            item.statusMismatch ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {MEMBER_STATUS_LABEL[item.onChainStatus] ?? item.onChainStatus}
        </span>
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
  {
    header: 'Wallets',
    cellClassName: 'px-4 py-3 text-xs',
    cell: item => {
      const walletCount = item.linkedWallets?.length ?? 0;
      return (
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            walletCount > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'
          }`}
        >
          {walletCount} {walletCount === 1 ? 'wallet' : 'wallets'}
        </span>
      );
    },
  },
];

export const MembersIntegrityTable: React.FC<MembersIntegrityTableProps> = ({
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
      item.uid.toLowerCase().includes(q) ||
      item.displayName.toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q) ||
      (item.userIdHash?.toLowerCase().includes(q) ?? false) ||
      (item.firestoreWalletAddress?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <IntegrityTable
      items={filtered}
      rowKey={item => item.uid}
      columns={columns}
      emptyMessage="No members match the current filter."
      searchQuery={searchQuery}
      onClearSearch={onClearSearch}
      renderDetail={item => (
        <div className="flex gap-4 flex-wrap">
          <DetailSection title="Wallets" className="flex-1 min-w-64">
            <WalletCards wallets={item.linkedWallets ?? []} />
          </DetailSection>
          <DetailSection title="On-Chain Status History" className="flex-1 min-w-64">
            <HistoryLog
              entries={toHistoryEntries(item.onChainStatusHistory ?? [])}
              emptyMessage="No status history recorded"
            />
          </DetailSection>
        </div>
      )}
    />
  );
};
