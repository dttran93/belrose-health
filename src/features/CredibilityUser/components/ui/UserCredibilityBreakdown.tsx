// src/features/CredibilityUser/components/ui/UserCredibilityBreakdown.tsx
//
// Renders a user's computed UserCredibilityScore: the overall score plus the EarnedTrust
// breakdown (AvgRecordCredibility, DisputeAccuracy, CulpabilityPenalty, CredentialFloor) and the
// vouch-propagated contribution. Not CredibilityBadge — that component's status/copy
// ("This record has been verified/disputed...") is record-flavored and doesn't fit a person's
// own trust score.
//
// Not yet wired into a specific page — this is the reusable display piece; where it's surfaced
// (HealthProfile tab, Settings, etc.) is a follow-up once the batch computation actually produces
// scores to look at.

import React from 'react';
import { ShieldQuestion } from 'lucide-react';
import type { UserCredibilityScore } from '@belrose/shared';
import { getScoreTier } from '@belrose/shared';
import { getTierStyle } from '@/components/ui/CredibilityTierStyle';

interface ComponentRowProps {
  label: string;
  value: number | null;
  hint: string;
}

const ComponentRow: React.FC<ComponentRowProps> = ({ label, value, hint }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
    <div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="text-xs text-gray-400">{hint}</div>
    </div>
    <div className="text-sm font-semibold text-gray-900 tabular-nums">
      {value === null ? '—' : Math.round(value)}
    </div>
  </div>
);

export interface UserCredibilityBreakdownProps {
  credibility: UserCredibilityScore | null | undefined;
  isLoading?: boolean;
  className?: string;
}

export const UserCredibilityBreakdown: React.FC<UserCredibilityBreakdownProps> = ({
  credibility,
  isLoading = false,
  className = '',
}) => {
  if (isLoading) {
    return (
      <div className={`rounded-lg border border-gray-200 p-4 animate-pulse ${className}`}>
        <div className="h-6 w-32 bg-gray-200 rounded mb-3" />
        <div className="h-4 w-full bg-gray-100 rounded mb-2" />
        <div className="h-4 w-full bg-gray-100 rounded" />
      </div>
    );
  }

  if (!credibility) {
    return (
      <div className={`rounded-lg border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-500">
          <ShieldQuestion className="w-5 h-5" />
          <span className="text-sm">
            Not yet scored — credibility is calculated periodically and will appear here once
            computed.
          </span>
        </div>
      </div>
    );
  }

  const style = getTierStyle(getScoreTier(credibility.score));

  return (
    <div className={`rounded-lg border ${style.border} p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${style.bg} ${style.text}`}>
          <style.Icon className="w-5 h-5" />
          <span className="font-semibold">{style.label}</span>
        </div>
        <div className="text-2xl font-bold text-gray-900 tabular-nums">
          {Math.round(credibility.score)}
          <span className="text-sm font-normal text-gray-400">/1000</span>
        </div>
      </div>

      <div className="space-y-0">
        <ComponentRow
          label="Average record credibility"
          value={credibility.components.avgRecordCredibility}
          hint="Average score of records you've verified"
        />
        <ComponentRow
          label="Dispute accuracy"
          value={credibility.components.disputeAccuracy}
          hint="How often your disputes have been borne out"
        />
        <ComponentRow
          label="Culpability penalty"
          value={-credibility.components.culpabilityPenalty}
          hint="Deduction from disputes against records you've verified"
        />
        <ComponentRow
          label="Unaccepted records penalty"
          value={-credibility.components.unacceptedRecordsPenalty}
          hint="Deduction for records flagged as refused when a provider requested anchoring"
        />
        <ComponentRow
          label="Credential floor"
          value={credibility.components.credentialFloor}
          hint="Minimum from verified professional credentials, if any"
        />
        <ComponentRow
          label="Earned trust"
          value={credibility.earnedTrust}
          hint="Combined score from your own track record"
        />
        <ComponentRow
          label="From vouches"
          value={credibility.vouchPropagated}
          hint="Trust propagated from people who vouch for you"
        />
      </div>

      <div className="mt-3 text-xs text-gray-400">
        Last updated {credibility.lastUpdated.toDate().toLocaleDateString()}
      </div>
    </div>
  );
};

export default UserCredibilityBreakdown;
