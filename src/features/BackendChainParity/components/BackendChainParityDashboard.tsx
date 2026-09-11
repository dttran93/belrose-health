// src/features/BackendChainParity/components/BackendChainParityDashboard.tsx

import React, { useMemo } from 'react';
import { RefreshCw, Loader2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { SummaryCards } from './SummaryCards';
import { SubjectsIntegrityTable } from './SubjectsIntegrityTable';
import { RecordHashesIntegrityTable } from './RecordHashesIntegrityTable';
import { MembersIntegrityTable } from './MembersIntegrityTable';
import { CredibilityIntegrityTable } from './CredibilityIntegrityTable';
import { SyncQueueTable } from './SyncQueueTable';
import { TrusteesIntegrityTable } from './TrusteesIntegrityTable';
import { PermissionsIntegrityTable } from './PermissionsIntegrityTable';
import { ChainEventsTable } from './ChainEventsTable';
import { useRecordSubjectsIntegrity } from '../hooks/useRecordSubjectsIntegrity';
import { useRecordHashesIntegrity } from '../hooks/useRecordHashesIntegrity';
import { useMembersIntegrity } from '../hooks/useMembersIntegrity';
import {
  useVerificationsIntegrity,
  useDisputesIntegrity,
  useVouchesIntegrity,
} from '../hooks/useVerificationsIntegrity';
import { useSyncQueue } from '../hooks/useSyncQueue';
import { useTrusteesIntegrity } from '../hooks/useTrusteesIntegrity';
import { usePermissionsIntegrity } from '../hooks/usePermissionsIntegrity';
import { useChainEventCache } from '../hooks/useChainEventCache';
import { computeSummary } from '../lib/types';
import type { IntegrityStatus } from '../lib/types';

type TabId =
  | 'summary'
  | 'subjects'
  | 'record-hashes'
  | 'members'
  | 'credibility'
  | 'sync-queue'
  | 'trustees'
  | 'permissions'
  | 'chain-events';

const TABS: Array<{ id: TabId; label: string; phase2?: boolean }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'record-hashes', label: 'Record Hashes' },
  { id: 'members', label: 'Members' },
  { id: 'credibility', label: 'Credibility' },
  { id: 'trustees', label: 'Trustees' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'sync-queue', label: 'Sync Queue' },
  { id: 'chain-events', label: 'Chain Events' },
];

const BackendChainParityDashboard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') ?? 'summary') as TabId;
  const searchQuery = searchParams.get('search') ?? '';
  const statusFilter = (searchParams.get('status') ?? 'all') as IntegrityStatus | 'all';

  function setActiveTab(tab: TabId) {
    setSearchParams(prev => { prev.set('tab', tab); prev.delete('search'); return prev; });
  }
  function setSearchQuery(q: string) {
    setSearchParams(prev => { q ? prev.set('search', q) : prev.delete('search'); return prev; });
  }
  function setStatusFilter(s: IntegrityStatus | 'all') {
    setSearchParams(prev => { s !== 'all' ? prev.set('status', s) : prev.delete('status'); return prev; });
  }

  const queryClient = useQueryClient();

  const subjects = useRecordSubjectsIntegrity();
  const hashes = useRecordHashesIntegrity();
  const members = useMembersIntegrity();
  const verifications = useVerificationsIntegrity();
  const disputes = useDisputesIntegrity();
  const vouchesIntegrity = useVouchesIntegrity();
  const syncQueue = useSyncQueue();
  const trustees = useTrusteesIntegrity();
  const permissions = usePermissionsIntegrity();
  const chainEvents = useChainEventCache();

  const isAnyLoading =
    subjects.isFetching ||
    hashes.isFetching ||
    members.isFetching ||
    verifications.isFetching ||
    disputes.isFetching ||
    vouchesIntegrity.isFetching ||
    trustees.isFetching ||
    permissions.isFetching ||
    syncQueue.isFetching ||
    chainEvents.isFetching;

  const lastChecked = [
    subjects.dataUpdatedAt,
    hashes.dataUpdatedAt,
    members.dataUpdatedAt,
    verifications.dataUpdatedAt,
    disputes.dataUpdatedAt,
    vouchesIntegrity.dataUpdatedAt,
    trustees.dataUpdatedAt,
    permissions.dataUpdatedAt,
    syncQueue.dataUpdatedAt,
    chainEvents.dataUpdatedAt,
  ]
    .filter(Boolean)
    .reduce((a, b) => Math.min(a, b), Infinity);

  const subjectsSummary = subjects.data ? computeSummary(subjects.data) : undefined;
  const hashesSummary = hashes.data ? computeSummary(hashes.data) : undefined;
  const membersSummary = members.data ? computeSummary(members.data) : undefined;
  const verificationsSummary = verifications.data ? computeSummary(verifications.data) : undefined;
  const disputesSummary = disputes.data ? computeSummary(disputes.data) : undefined;
  const trusteesSummary = trustees.data ? computeSummary(trustees.data) : undefined;
  const permissionsSummary = permissions.data ? computeSummary(permissions.data) : undefined;

  // Keyed by recordId so RecordHashesIntegrityTable can show counts per record in the expanded panel
  const verificationsMap = useMemo(() => {
    const map: Record<string, typeof verifications.data> = {};
    for (const v of verifications.data ?? []) {
      if (v.recordId) {
        (map[v.recordId] ??= []).push(v);
      }
    }
    return map;
  }, [verifications.data]);

  const disputesMap = useMemo(() => {
    const map: Record<string, typeof disputes.data> = {};
    for (const d of disputes.data ?? []) {
      if (d.recordId) {
        (map[d.recordId] ??= []).push(d);
      }
    }
    return map;
  }, [disputes.data]);

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['backend-chain-parity'] });
  }

  const statusFilterOptions: Array<{ value: IntegrityStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'synced', label: 'Synced' },
    { value: 'mismatch', label: 'Mismatch' },
    { value: 'missing', label: 'Missing' },
    { value: 'chain_only', label: 'Chain Only' },
    { value: 'pending', label: 'Pending' },
    { value: 'failed', label: 'Failed' },
    { value: 'not_applicable', label: 'N/A' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Backend ↔ Chain Parity</h1>
              <p className="text-gray-500 mt-1 text-sm">
                Firestore-first reconciliation against on-chain state
                {lastChecked !== Infinity && (
                  <span className="ml-2 text-gray-400">
                    · Last checked {new Date(lastChecked).toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>
            <Button
              onClick={handleRefresh}
              disabled={isAnyLoading}
              className="flex items-center gap-2"
            >
              {isAnyLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Refresh from Chain
            </Button>
          </div>

          {/* Tab Navigation */}
          <nav className="mt-6 -mb-px flex space-x-6 overflow-x-auto">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                  {tab.phase2 && (
                    <span className="text-xs text-gray-400 font-normal">(Phase 2)</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Search + Filter Bar (hidden on summary tab) */}
      {activeTab !== 'summary' && !['trustees', 'role-events'].includes(activeTab) && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search by ID, hash, name, email, or wallet..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 bg-background border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* The IntegrityStatus vocabulary these pills filter on doesn't apply to the sync
                queue (pending/confirmed/failed) or chain events (reconciliationStatus) — both
                tabs have their own local status filter instead, so these are hidden there rather
                than doing nothing silently. */}
            {activeTab !== 'sync-queue' && activeTab !== 'chain-events' && (
              <div className="flex gap-2 flex-wrap">
                {statusFilterOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setStatusFilter(opt.value)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      statusFilter === opt.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {activeTab === 'summary' && (
          <div className="pt-6">
            <SummaryCards
              subjects={subjectsSummary}
              hashes={hashesSummary}
              members={membersSummary}
              verifications={verificationsSummary}
              disputes={disputesSummary}
              isLoading={isAnyLoading}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: 'Subjects', summary: subjectsSummary, tab: 'subjects' as TabId },
                { label: 'Record Hashes', summary: hashesSummary, tab: 'record-hashes' as TabId },
                { label: 'Members', summary: membersSummary, tab: 'members' as TabId },
                {
                  label: 'Verifications',
                  summary: verificationsSummary,
                  tab: 'verifications' as TabId,
                },
                { label: 'Disputes', summary: disputesSummary, tab: 'verifications' as TabId },
              ].map(({ label, summary, tab }) => (
                <div
                  key={label}
                  className="bg-white rounded-xl border border-gray-200 p-5 cursor-pointer hover:border-blue-300 transition-colors"
                  onClick={() => setActiveTab(tab)}
                >
                  <div className="font-semibold text-gray-800 mb-3">{label}</div>
                  {summary ? (
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="text-2xl font-bold text-emerald-600">{summary.synced}</div>
                        <div className="text-xs text-gray-500">Synced</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-amber-600">
                          {summary.mismatch + summary.missing}
                        </div>
                        <div className="text-xs text-gray-500">Issues</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-gray-400">{summary.pending}</div>
                        <div className="text-xs text-gray-500">Pending</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'subjects' && (
          <div className="pt-2">
            {subjects.isLoading ? (
              <LoadingState label="record subjects" />
            ) : subjects.error ? (
              <ErrorState error={String(subjects.error)} />
            ) : (
              <SubjectsIntegrityTable
                items={subjects.data ?? []}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'record-hashes' && (
          <div className="pt-2">
            {hashes.isLoading ? (
              <LoadingState label="record hashes" />
            ) : hashes.error ? (
              <ErrorState error={String(hashes.error)} />
            ) : (
              <RecordHashesIntegrityTable
                items={hashes.data ?? []}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                verificationsMap={verificationsMap}
                disputesMap={disputesMap}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'members' && (
          <div className="pt-2">
            {members.isLoading ? (
              <LoadingState label="members" />
            ) : members.error ? (
              <ErrorState error={String(members.error)} />
            ) : (
              <MembersIntegrityTable
                items={members.data ?? []}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'credibility' && (
          <div className="pt-2">
            {verifications.isLoading || disputes.isLoading || vouchesIntegrity.isLoading ? (
              <LoadingState label="verifications, disputes & vouches" />
            ) : (
              <CredibilityIntegrityTable
                verifications={verifications.data ?? []}
                disputes={disputes.data ?? []}
                vouches={vouchesIntegrity.data ?? []}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'sync-queue' && (
          <div className="pt-2">
            {syncQueue.isLoading ? (
              <LoadingState label="the sync queue" />
            ) : syncQueue.error ? (
              <ErrorState error={String(syncQueue.error)} />
            ) : (
              <SyncQueueTable
                items={syncQueue.data ?? []}
                searchQuery={searchQuery}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'trustees' && (
          <div className="pt-2">
            {trustees.isLoading ? (
              <LoadingState label="trustee relationships" />
            ) : trustees.error ? (
              <ErrorState error={String(trustees.error)} />
            ) : (
              <TrusteesIntegrityTable
                items={trustees.data ?? []}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'permissions' && (
          <div className="pt-2">
            {permissions.isLoading ? (
              <LoadingState label="record permissions" />
            ) : permissions.error ? (
              <ErrorState error={String(permissions.error)} />
            ) : (
              <PermissionsIntegrityTable
                items={permissions.data ?? []}
                searchQuery={searchQuery}
                statusFilter={statusFilter}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}

        {activeTab === 'chain-events' && (
          <div className="pt-2">
            {chainEvents.isLoading ? (
              <LoadingState label="the chain event cache" />
            ) : chainEvents.error ? (
              <ErrorState error={String(chainEvents.error)} />
            ) : (
              <ChainEventsTable
                items={chainEvents.data ?? []}
                searchQuery={searchQuery}
                onClearSearch={() => setSearchQuery('')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const LoadingState: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center py-16">
    <div className="text-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
      <p className="text-gray-500 text-sm">Checking {label} against blockchain…</p>
    </div>
  </div>
);

const ErrorState: React.FC<{ error: string }> = ({ error }) => (
  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
    <span className="font-medium">Error: </span>
    {error}
  </div>
);

export default BackendChainParityDashboard;
