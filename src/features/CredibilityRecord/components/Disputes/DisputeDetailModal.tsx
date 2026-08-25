// src/features/CredibilityRecord/components/ui/DisputeDetailModal.tsx

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  AlertTriangle,
  ExternalLink,
  Edit,
  Undo2,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BelroseUserProfile, FileObject } from '@/types/core';
import UserCard from '@/features/Users/components/ui/UserCard';
import {
  getSeverityConfig,
  getCulpabilityConfig,
  DisputeDocDecrypted,
} from '../../services/disputeService';
import { NETWORK } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

interface DisputeDetailModalProps {
  record: FileObject;
  isOpen: boolean;
  onClose: () => void;
  dispute: DisputeDocDecrypted;
  userProfile?: BelroseUserProfile;
  isOwnDispute?: boolean;
  onModify?: () => void;
  onRetract?: () => void;
  onReact?: (disputerId: string, support: boolean) => void;
}

// ============================================================
// CONSTANTS
// ============================================================

const CHAIN_STATUS_DISPLAY = {
  pending: { text: 'Pending confirmation', color: 'text-yellow-600' },
  confirmed: { text: 'Confirmed on-network', color: 'text-green-600' },
  failed: { text: 'Transaction failed', color: 'text-red-600' },
};

// ============================================================
// COMPONENT
// ============================================================

export const DisputeDetailModal: React.FC<DisputeDetailModalProps> = ({
  record,
  isOpen,
  onClose,
  dispute,
  userProfile,
  isOwnDispute = false,
  onModify,
  onRetract,
  onReact,
}) => {
  const severityInfo = getSeverityConfig(dispute.severity);
  const culpabilityInfo = getCulpabilityConfig(dispute.culpability);
  const chainStatus = CHAIN_STATUS_DISPLAY[dispute.chainStatus];

  const isCurrentVersion = dispute.recordHash === record.recordHash;

  // Color classes based on severity
  const severityColors = {
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-700',
      icon: 'text-blue-600',
    },
    yellow: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-700',
      icon: 'text-yellow-600',
    },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-600' },
  };
  const sevColors = severityColors[severityInfo.color as keyof typeof severityColors];

  // Most recent on-chain event carries the tx we want to link to (disputed/retracted/modified)
  const latestBlockchainRef = dispute.onChainHistory?.at(-1)?.blockchainRef;

  const handleViewOnBlockchain = () => {
    if (latestBlockchainRef?.txHash) {
      window.open(`${NETWORK.explorerUrl}/tx/${latestBlockchainRef.txHash}`, '_blank');
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl z-50 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-2">
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                Dispute Details
              </Dialog.Title>
              <Dialog.Description />
              <Dialog.Close asChild>
                <button className="p-1 rounded-full hover:bg-gray-100 transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </Dialog.Close>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Record Id/Hash */}
              <div className="flex flex-col">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Record Details</h4>
                <span className="text-xs">ID: {dispute.recordId}</span>
                <span className="text-xs">Hash: {dispute.recordHash}</span>
              </div>

              <hr className="border-gray-200" />
              <h4 className="text-sm font-medium text-gray-500 mb-2">Dispute Details</h4>
              {/* User Card */}
              <h4 className="text-xs font-medium text-gray-500 mb-2">Disputer</h4>
              <UserCard
                user={userProfile}
                userId={dispute.disputerId}
                variant="compact"
                color="yellow"
              />

              {/* Severity Section */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-2">Severity</h4>
                <div className={`${sevColors.bg} ${sevColors.border} border rounded-lg p-4`}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className={`w-5 h-5 ${sevColors.icon}`} />
                    <span className={`font-semibold ${sevColors.text}`}>{severityInfo.name}</span>
                  </div>
                  <p className={`text-sm ${sevColors.text}`}>{severityInfo.description}</p>
                </div>
              </div>

              {/* Culpability Section */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-2">Culpability</h4>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-purple-800">{culpabilityInfo.name}</span>
                  </div>
                  <p className="text-sm text-purple-700">{culpabilityInfo.description}</p>
                </div>
              </div>

              {/* Notes Section */}
              {dispute.notes && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    Notes
                  </h4>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{dispute.notes}</p>
                  </div>
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Version</h4>
                  <p
                    className={`text-sm font-medium ${isCurrentVersion ? 'text-green-600' : 'text-yellow-600'}`}
                  >
                    {isCurrentVersion ? 'Current Version' : 'Previous Version'}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Status</h4>
                  <div
                    className={`inline-flex items-center gap-1 text-sm font-medium ${chainStatus.color}`}
                  >
                    {dispute.chainStatus === 'confirmed' && <CheckCircle className="w-4 h-4" />}
                    {chainStatus.text}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Filed</h4>
                  <p className="text-sm text-gray-900">
                    {dispute.createdAt.toDate().toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>

                {dispute.lastModified && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-1">Last Modified</h4>
                    <p className="text-sm text-gray-900">
                      {dispute.lastModified.toDate().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>

              {/* Inactive Warning */}
              {!dispute.isActive && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700 font-medium">
                    This dispute has been retracted and is no longer active.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between p-4 border-t bg-gray-50">
              <Button
                variant="outline"
                size="sm"
                onClick={handleViewOnBlockchain}
                disabled={!latestBlockchainRef?.txHash}
                className="text-gray-600"
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                View on Network
              </Button>

              <div className="flex gap-2">
                {/* React buttons (only if not own dispute and dispute is active) */}
                {!isOwnDispute && dispute.isActive && onReact && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReact(dispute.disputerId, true)}
                      className="text-green-600 border-green-300 hover:bg-green-50"
                    >
                      <ThumbsUp className="w-4 h-4 mr-1" />
                      Support
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReact(dispute.disputerId, false)}
                      className="text-red-600 border-red-300 hover:bg-red-50"
                    >
                      <ThumbsDown className="w-4 h-4 mr-1" />
                      Oppose
                    </Button>
                  </>
                )}

                {/* Modify/Retract buttons (only if own dispute and active) */}
                {isOwnDispute && dispute.isActive && (
                  <>
                    <Button variant="outline" size="sm" onClick={onModify}>
                      <Edit className="w-4 h-4 mr-1" />
                      Modify
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRetract}
                      className="text-red-600 border-red-300 hover:bg-red-50"
                    >
                      <Undo2 className="w-4 h-4 mr-1" />
                      Retract
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default DisputeDetailModal;
