// src/features/CredibilityRecord/components/ui/VerificationDetailModal.tsx

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, CheckCircle, ExternalLink, Edit, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BelroseUserProfile, FileObject } from '@/types/core';
import UserCard from '@/features/Users/components/ui/UserCard';
import { getVerificationConfig } from '../../services/verificationService';
import { VerificationDoc } from '@belrose/shared';
import { NETWORK } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

interface VerificationDetailModalProps {
  record: FileObject;
  isOpen: boolean;
  onClose: () => void;
  verification: VerificationDoc;
  userProfile?: BelroseUserProfile;
  isOwnVerification?: boolean;
  onModify?: () => void;
  onRetract?: () => void;
}

// ============================================================
// CONSTANTS
// ============================================================

const CHAIN_STATUS_DISPLAY = {
  pending: { text: 'Pending confirmation', color: 'text-yellow-600', bg: 'bg-yellow-50' },
  confirmed: { text: 'Confirmed on-network', color: 'text-green-600', bg: 'bg-green-50' },
  failed: { text: 'Network confirmation failed', color: 'text-red-600', bg: 'bg-red-50' },
};

// ============================================================
// COMPONENT
// ============================================================

export const VerificationDetailModal: React.FC<VerificationDetailModalProps> = ({
  record,
  isOpen,
  onClose,
  verification,
  userProfile,
  isOwnVerification = false,
  onModify,
  onRetract,
}) => {
  const verificationInfo = getVerificationConfig(verification.level);
  const levelDescription = verificationInfo.description;
  const levelName = verificationInfo.name;
  const chainStatus = CHAIN_STATUS_DISPLAY[verification.chainStatus];

  const isCurrentVersion = verification.recordHash === record.recordHash;

  // Most recent on-chain event carries the tx we want to link to (verified/retracted/modified)
  const latestBlockchainRef = verification.onChainHistory?.at(-1)?.blockchainRef;

  const handleViewOnBlockchain = () => {
    if (latestBlockchainRef?.txHash) {
      window.open(`${NETWORK.explorerUrl}/tx/${latestBlockchainRef.txHash}`, '_blank');
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        {/* Changed: Removed overflow-y-auto, added flex flex-col */}
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl z-50 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
          <div className="p-2 flex flex-col h-full overflow-hidden">
            {/* Header: Stays fixed at the top because it's outside the scroll area */}
            <div className="flex items-center justify-between p-4 border-b bg-white rounded-t-lg">
              <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Verification Details
              </Dialog.Title>
              <Dialog.Description />
              <Dialog.Close asChild>
                <button className="p-1 rounded-full hover:bg-gray-100 transition-colors">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </Dialog.Close>
            </div>

            {/* Content: Added flex-1 and overflow-y-auto to make ONLY this part scroll */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Record Id/Hash */}
              <div className="flex flex-col">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Record Details</h4>
                <span className="text-xs">ID: {verification.recordId}</span>
                <span className="text-xs">Hash: {verification.recordHash}</span>
              </div>

              <hr className="border-gray-200" />
              <h4 className="text-sm font-medium text-gray-500 mb-2">Verification Details</h4>

              {/* User Card */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-2">Verifier</h4>
                <UserCard
                  user={userProfile}
                  userId={verification.verifierId}
                  variant="compact"
                  color="green"
                  menuType="none"
                />
              </div>

              {/* Level Section */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-2">Verification Level</h4>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <span className="font-semibold text-green-800">{levelName}</span>
                  </div>
                  <p className="text-sm text-green-700">{levelDescription}</p>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Version</h4>
                  <p
                    className={`text-sm font-medium ${isCurrentVersion ? 'text-green-600' : 'text-yellow-600'}`}
                  >
                    {isCurrentVersion ? `Current Version` : `Previous Version`}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Status</h4>
                  <div
                    className={`inline-flex items-center gap-1 text-sm font-medium ${chainStatus.color}`}
                  >
                    {verification.chainStatus === 'confirmed' && (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {chainStatus.text}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-500 mb-1">Verified</h4>
                  <p className="text-sm text-gray-900">
                    {verification.createdAt.toDate().toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>

                {verification.lastModified && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 mb-1">Last Modified</h4>
                    <p className="text-sm text-gray-900">
                      {verification.lastModified.toDate().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>

              {/* Inactive Warning */}
              {!verification.isActive && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-700 font-medium">
                    This verification has been retracted and is no longer active.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Actions: Stays fixed at the bottom */}
            <div className="flex items-center justify-between p-4 border-t bg-gray-50 rounded-b-lg">
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

              {isOwnVerification && verification.isActive && (
                <div className="flex gap-2">
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
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default VerificationDetailModal;
