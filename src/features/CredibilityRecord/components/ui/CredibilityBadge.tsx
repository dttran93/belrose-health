// src/features/CredibilityRecord/components/ui/CredibilityBadge.tsx

/**
 * The credibility score (0-1000), or undefined/null if not yet rated
 * Currently just verified, versus disputed if there's a credibility score.
 * If not self-reported.
 *
 */

import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

// ==================== TYPES ====================

export type CredibilityStatus = 'verified' | 'disputed' | 'self-reported';

export interface CredibilityBadgeProps {
  score?: number | null;
  className?: string;
}

// ==================== HELPERS ====================

/**
 * Get the status based on score
 */
export function getCredibilityStatus(score?: number | null): CredibilityStatus {
  if (score === undefined || score === null) return 'self-reported';
  if (score >= 500) return 'verified';
  return 'disputed';
}

/**
 * Get the display label for a status
 */
export function getStatusLabel(status: CredibilityStatus): string {
  switch (status) {
    case 'verified':
      return 'Verified';
    case 'disputed':
      return 'Disputed';
    case 'self-reported':
      return 'Self-Reported';
  }
}

/**
 * Get tooltip description for a status
 */
function getStatusDescription(status: CredibilityStatus): string {
  switch (status) {
    case 'verified':
      return 'This record has been verified by others.';
    case 'disputed':
      return 'This record has been disputed. Review with caution.';
    case 'self-reported':
      return 'This record has not yet been verified or disputed by others.';
  }
}

// ==================== STYLING ====================

interface StatusStyle {
  bg: string;
  text: string;
  border: string;
  icon: React.ReactNode;
}

const statusStyles: Record<CredibilityStatus, StatusStyle> = {
  verified: {
    bg: 'bg-complement-3/20',
    text: 'text-complement-3',
    border: 'border-complement-3',
    icon: <ShieldCheck className="w-4 h-4" />,
  },
  disputed: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-600',
    border: 'border-yellow-500',
    icon: <ShieldAlert className="w-4 h-4" />,
  },
  'self-reported': {
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-700',
    icon: '',
  },
};

// ==================== COMPONENT ====================

export const CredibilityBadge: React.FC<CredibilityBadgeProps> = ({ score, className = '' }) => {
  const status = getCredibilityStatus(score);
  const label = getStatusLabel(status);
  const description = getStatusDescription(status);
  const style = statusStyles[status];

  const badgeContent = (
    <span
      className={`
        inline-flex items-center rounded-full border font-medium cursor-help px-2 py-0.5 text-xs gap-1
        ${style.bg} ${style.text} ${style.border}
        ${className}
      `}
    >
      <span>{style.icon}</span>
      <span>{label}</span>
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
