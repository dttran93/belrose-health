// src/features/BackendChainParity/components/ui/IntegrityStatusBadge.tsx

import React from 'react';
import { CheckCircle, AlertTriangle, XCircle, Clock, Minus, AlertCircle, Link } from 'lucide-react';
import type { IntegrityStatus } from '../../lib/types';

interface IntegrityStatusBadgeProps {
  status: IntegrityStatus;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<
  IntegrityStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  synced: {
    label: 'Synced',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  mismatch: {
    label: 'Mismatch',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  missing: {
    label: 'Missing',
    icon: <XCircle className="w-3.5 h-3.5" />,
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  pending: {
    label: 'Pending',
    icon: <Clock className="w-3.5 h-3.5" />,
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  chain_only: {
    label: 'Chain Only',
    icon: <Link className="w-3.5 h-3.5" />,
    className: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  not_applicable: {
    label: 'N/A',
    icon: <Minus className="w-3.5 h-3.5" />,
    className: 'bg-gray-50 text-gray-500 border-gray-200',
  },
  failed: {
    label: 'Check Failed',
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    className: 'bg-purple-50 text-purple-700 border-purple-200',
  },
};

export const IntegrityStatusBadge: React.FC<IntegrityStatusBadgeProps> = ({
  status,
  showLabel = true,
}) => {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}
    >
      {config.icon}
      {showLabel && config.label}
    </span>
  );
};
