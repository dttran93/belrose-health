// src/features/BackendChainParity/components/SummaryCards.tsx

import React from 'react';
import { CheckCircle, AlertTriangle, XCircle, Clock, AlertCircle, Database } from 'lucide-react';
import type { ParitySummary } from '../lib/types';

interface SummaryCardsProps {
  subjects?: ParitySummary;
  hashes?: ParitySummary;
  members?: ParitySummary;
  verifications?: ParitySummary;
  disputes?: ParitySummary;
  isLoading: boolean;
}

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  colorClass: string;
  sub?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, colorClass, sub }) => (
  <div className={`rounded-xl border p-4 ${colorClass}`}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium uppercase tracking-wide opacity-70">{title}</span>
      {icon}
    </div>
    <div className="text-2xl font-bold">{value}</div>
    {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
  </div>
);

export function mergeSummaries(...summaries: (ParitySummary | undefined)[]): ParitySummary {
  const defined = summaries.filter((s): s is ParitySummary => s !== undefined);
  return defined.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      synced: acc.synced + s.synced,
      mismatch: acc.mismatch + s.mismatch,
      missing: acc.missing + s.missing,
      chainOnly: acc.chainOnly + s.chainOnly,
      pending: acc.pending + s.pending,
      notApplicable: acc.notApplicable + s.notApplicable,
      failed: acc.failed + s.failed,
    }),
    {
      total: 0,
      synced: 0,
      mismatch: 0,
      missing: 0,
      chainOnly: 0,
      pending: 0,
      notApplicable: 0,
      failed: 0,
    }
  );
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({
  subjects,
  hashes,
  members,
  verifications,
  disputes,
  isLoading,
}) => {
  const combined = mergeSummaries(subjects, hashes, members, verifications, disputes);
  const val = (n: number) => (isLoading ? '—' : n);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
      <StatCard
        title="Total Checked"
        value={val(combined.total)}
        icon={<Database className="w-4 h-4 opacity-70" />}
        colorClass="bg-white border-gray-200 text-gray-800"
        sub={`${combined.notApplicable} N/A`}
      />
      <StatCard
        title="Synced"
        value={val(combined.synced)}
        icon={<CheckCircle className="w-4 h-4" />}
        colorClass="bg-emerald-50 border-emerald-200 text-emerald-800"
      />
      <StatCard
        title="Mismatch"
        value={val(combined.mismatch)}
        icon={<AlertTriangle className="w-4 h-4" />}
        colorClass="bg-amber-50 border-amber-200 text-amber-800"
      />
      <StatCard
        title="Missing"
        value={val(combined.missing)}
        icon={<XCircle className="w-4 h-4" />}
        colorClass="bg-red-50 border-red-200 text-red-800"
      />
      <StatCard
        title="Pending"
        value={val(combined.pending)}
        icon={<Clock className="w-4 h-4" />}
        colorClass="bg-blue-50 border-blue-200 text-blue-800"
      />
      <StatCard
        title="Check Failed"
        value={val(combined.failed)}
        icon={<AlertCircle className="w-4 h-4" />}
        colorClass="bg-purple-50 border-purple-200 text-purple-800"
      />
    </div>
  );
};
