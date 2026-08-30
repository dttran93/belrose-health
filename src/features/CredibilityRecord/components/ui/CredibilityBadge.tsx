// src/features/CredibilityRecord/components/ui/CredibilityBadge.tsx

/**
 * Compact inline badge for a record's credibility score (0-1000, or null/undefined if not yet
 * scored). Driven by the same five-tier system as UserCredibilityBreakdown
 * (packages/shared/src/credibility.ts's getScoreTier + src/components/ui/CredibilityTierStyle.tsx)
 * rather than its own logic, so Record and User credibility read consistently everywhere they
 * appear. "Not yet scored" renders as a distinct neutral gray state — it is not the same signal
 * as a Poor score.
 *
 * Layout/visual chrome (pill + tooltip) is otherwise unchanged; a denser or differently-shaped
 * badge is a separate follow-up once a direction is picked.
 */

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { getScoreTier, type ScoreTier } from '@belrose/shared';
import { getTierStyle } from '@/components/ui/CredibilityTierStyle';

// ==================== TYPES ====================

export interface CredibilityBadgeProps {
  score?: number | null;
  className?: string;
}

// ==================== HELPERS ====================

/**
 * Tooltip copy per tier. Not shared with UserCredibilityBreakdown — that component's copy is
 * about a person's own trust score, this one is about a specific record's content.
 */
function getStatusDescription(tier: ScoreTier | null): string {
  switch (tier) {
    case null:
      return 'This record has not yet been verified or disputed by others.';
    case 'excellent':
      return 'This record is strongly verified with no significant disputes.';
    case 'veryGood':
      return 'This record is well-verified with no significant disputes.';
    case 'good':
      return 'This record has more supporting verification than dispute.';
    case 'fair':
      return 'This record has unresolved disputes. Review with caution.';
    case 'poor':
      return 'This record has been significantly disputed. Review with caution.';
  }
}

// ==================== COMPONENT ====================

export const CredibilityBadge: React.FC<CredibilityBadgeProps> = ({ score, className = '' }) => {
  const tier = getScoreTier(score);
  const style = getTierStyle(tier);
  const description = getStatusDescription(tier);

  const badgeContent = (
    <span
      className={`
        inline-flex items-center rounded-full border font-medium cursor-help px-2 py-0.5 text-xs gap-1
        ${style.bg} ${style.text} ${style.border}
        ${className}
      `}
    >
      <style.Icon className="w-4 h-4" />
      <span>{score === null || score === undefined ? style.label : `${Math.round(score)} · ${style.label}`}</span>
    </span>
  );

  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{badgeContent}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 z-50 max-w-xs"
            sideOffset={5}
          >
            {description}
            <Tooltip.Arrow className="fill-gray-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

export default CredibilityBadge;
