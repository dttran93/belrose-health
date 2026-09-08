// src/features/BackendChainParity/components/ui/DetailSection.tsx

import React from 'react';

interface DetailSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  /**
   * Defaults to 'w-full' so a single section (or a column that should fill its row) reads
   * consistently. Pass e.g. 'flex-1 min-w-48' for panels meant to sit side-by-side and wrap.
   */
  className?: string;
}

/**
 * Shared visually-distinct panel for a titled block inside an *IntegrityTable's expanded row —
 * used for things like a history log, a comparison table, or a timeline. Standardizes on the
 * bg-background/border style every table's detail panel should share.
 */
export const DetailSection: React.FC<DetailSectionProps> = ({
  title,
  children,
  className = 'w-full',
}) => (
  <div className={`bg-background rounded-lg border border-border/20 p-4 ${className}`}>
    <p className="text-xs font-medium text-gray-500 mb-2">{title}</p>
    {children}
  </div>
);
