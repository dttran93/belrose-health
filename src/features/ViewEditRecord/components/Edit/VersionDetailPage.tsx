// src/features/ViewEditRecord/components/VersionDetailPage.tsx

/**
 * Detail page for a specific version (recordHash).
 * Shows:
 * 1. VersionHistoryCard at the top
 * 2. VerificationManagement filtered to this hash only
 * 3. DisputeManagement filtered to this hash only
 *
 * Reuses existing credibility components and their modals.
 */

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Shield } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FileObject, BelroseUserProfile } from '@/types/core';
import { RecordVersion } from '../../services/versionControlService.types';
import { CredibilityStats } from './VersionReviewBadge';
import { useAuth } from '@/features/Auth/hooks/useAuth';
import { getUserProfiles } from '@/features/Users/services/userProfileService';

// Verification imports
import { getVerificationsByRecordId } from '@/features/CredibilityRecord/services/verificationService';
import VerificationDetailModal from '@/features/CredibilityRecord/components/Verifications/VerificationDetailModal';
import VerificationUserCard from '@/features/CredibilityRecord/components/Verifications/VerificationUserCard';

// Dispute imports
import {
  getDisputesByRecordId,
  DisputeDocDecrypted,
} from '@/features/CredibilityRecord/services/disputeService';
import DisputeDetailModal from '@/features/CredibilityRecord/components/Disputes/DisputeDetailModal';
import DisputeUserCard from '@/features/CredibilityRecord/components/Disputes/DisputeUserCard';

// Credibility flow hook for actions
import { useCredibilityFlow } from '@/features/CredibilityRecord/hooks/useCredibilityFlow';
import CredibilityActionDialog from '@/features/CredibilityRecord/components/ui/CredibilityActionDialog';
import { formatTimestamp } from '@/utils/dataFormattingUtils';
import { VerificationDoc } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

interface VersionDetailPageProps {
  record: FileObject;
  version: RecordVersion;
  credibilityStats?: CredibilityStats | null;
  onBack: () => void;
  onModifyVerification?: () => void;
  onModifyDispute?: () => void;
}

// ============================================================
// COMPONENT
// ============================================================

export const VersionDetailPage: React.FC<VersionDetailPageProps> = ({
  record,
  version,
  credibilityStats,
  onBack,
  onModifyVerification,
  onModifyDispute,
}) => {
  const { user } = useAuth();
  const recordId = record.firestoreId || record.id;
  const recordHash = version.recordHash;

  // Verification state
  const [verifications, setVerifications] = useState<VerificationDoc[]>([]);
  const [loadingVerifications, setLoadingVerifications] = useState(true);
  const [selectedVerification, setSelectedVerification] = useState<VerificationDoc | null>(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

  // Dispute state
  const [disputes, setDisputes] = useState<DisputeDocDecrypted[]>([]);
  const [loadingDisputes, setLoadingDisputes] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<DisputeDocDecrypted | null>(null);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);

  // User profiles
  const [userProfiles, setUserProfiles] = useState<Map<string, BelroseUserProfile>>(new Map());

  // Credibility flow hook for actions (verify, dispute, react, etc.)
  const {
    dialogProps,
    verification: userVerification,
    dispute: userDispute,
    initiateVerification,
    initiateRetractVerification,
    initiateModifyVerification,
    initiateDispute,
    initiateRetractDispute,
    initiateModifyDispute,
    isLoading,
    refetch,
  } = useCredibilityFlow({
    recordId,
    recordHash,
    onSuccess: handleOperationSuccess,
  });

  // ============================================================
  // DATA FETCHING
  // ============================================================

  async function handleOperationSuccess() {
    await refetch();
    await fetchVerifications();
    await fetchDisputes();
  }

  const fetchVerifications = async () => {
    if (!recordId) return;

    setLoadingVerifications(true);
    try {
      const allVerifications = await getVerificationsByRecordId(recordId);

      // Filter to only this hash and add version info
      const filtered: VerificationDoc[] = allVerifications
        .filter(v => v.recordHash === recordHash)
        .map(v => ({
          ...v,
          versionNumber: version.versionNumber,
          totalVersions: 1, // We're showing just this version
        }));

      // Sort: active first, then by createdAt
      filtered.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.createdAt.toMillis() - a.createdAt.toMillis();
      });

      setVerifications(filtered);

      // Collect user IDs for profile fetching
      const userIds = filtered.map(v => v.verifierId);
      return userIds;
    } catch (error) {
      console.error('Error fetching verifications:', error);
      return [];
    } finally {
      setLoadingVerifications(false);
    }
  };

  const fetchDisputes = async () => {
    if (!recordId) return;

    setLoadingDisputes(true);
    try {
      const allDisputes = await getDisputesByRecordId(recordId);

      // Filter to only this hash and add version info
      const filtered: DisputeDocDecrypted[] = allDisputes
        .filter(d => d.recordHash === recordHash)
        .map(d => ({
          ...d,
          versionNumber: version.versionNumber,
          totalVersions: 1,
        }));

      // Sort: active first, then by createdAt
      filtered.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.createdAt.toMillis() - a.createdAt.toMillis();
      });

      setDisputes(filtered);

      // Collect user IDs for profile fetching
      const userIds = filtered.map(d => d.disputerId);
      return userIds;
    } catch (error) {
      console.error('Error fetching disputes:', error);
      return [];
    } finally {
      setLoadingDisputes(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    const fetchAll = async () => {
      const [verifierIds, disputerIds] = await Promise.all([fetchVerifications(), fetchDisputes()]);

      // Fetch all user profiles
      const allUserIds = [...new Set([...(verifierIds || []), ...(disputerIds || [])])];
      if (allUserIds.length > 0) {
        const profiles = await getUserProfiles(allUserIds);
        setUserProfiles(profiles);
      }
    };

    fetchAll();
  }, [recordId, recordHash]);

  // ============================================================
  // HANDLERS
  // ============================================================

  // Verification handlers
  const handleVerificationClick = (verification: VerificationDoc) => {
    setSelectedVerification(verification);
    setIsVerificationModalOpen(true);
  };

  const handleCloseVerificationModal = () => {
    setIsVerificationModalOpen(false);
    setSelectedVerification(null);
  };

  // Dispute handlers
  const handleDisputeClick = (dispute: DisputeDocDecrypted) => {
    setSelectedDispute(dispute);
    setIsDisputeModalOpen(true);
  };

  const handleCloseDisputeModal = () => {
    setIsDisputeModalOpen(false);
    setSelectedDispute(null);
  };

  // ============================================================
  // RENDER
  // ============================================================

  const activeVerifications = verifications.filter(v => v.isActive).length;
  const activeDisputes = disputes.filter(d => d.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-1">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Version {version.versionNumber} Details
          </h2>
        </div>
        <div>
          <Button
            className="text-primary w-8 h-8 border-none bg-transparent hover:bg-gray-200"
            size="sm"
            onClick={onBack}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Version Info Card */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-gray-200 text-gray-800">
                v{version.versionNumber}
              </span>
              {version.commitMessage && (
                <span className="text-sm font-medium">{version.commitMessage}</span>
              )}
            </div>
            <div className="text-xs text-gray-600 mb-2">
              <span className="font-medium">Record Hash:</span>{' '}
              <code className="bg-white px-1 py-0.5 rounded font-mono">{version.recordHash}</code>
            </div>
            <div className="text-xs text-left text-gray-500">
              Edited by {version.editedByName || 'Unknown'} •{' '}
              {formatTimestamp(version.editedAt, 'short') || 'Unknown time'} •{' '}
              {formatTimestamp(version.editedAt, 'relative')}
            </div>
          </div>
        </div>
      </div>

      {/* Verifications Section */}
      <div className="border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Verifications</h3>
            <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
              {activeVerifications} active
            </span>
          </div>
        </div>

        <div className="p-4">
          {loadingVerifications ? (
            <div className="flex justify-center items-center py-8">
              <p className="text-gray-500">Loading verifications...</p>
            </div>
          ) : verifications.length > 0 ? (
            <div className="space-y-3">
              {verifications.map(verification => {
                const verifierProfile = userProfiles.get(verification.verifierId);
                const isInactive = !verification.isActive;

                return (
                  <VerificationUserCard
                    key={verification.id}
                    verification={verification}
                    userProfile={verifierProfile}
                    currentRecordHash={record.recordHash}
                    isInactive={isInactive}
                    onViewUser={() => {}}
                    onViewDetails={() => handleVerificationClick(verification)}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No verifications for this version</p>
          )}
        </div>
      </div>

      {/* Disputes Section */}
      <div className="border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-t-lg">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Disputes</h3>
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
              {activeDisputes} active
            </span>
          </div>
        </div>

        <div className="p-4">
          {loadingDisputes ? (
            <div className="flex justify-center items-center py-8">
              <p className="text-gray-500">Loading disputes...</p>
            </div>
          ) : disputes.length > 0 ? (
            <div className="space-y-3">
              {disputes.map(dispute => {
                const disputerProfile = userProfiles.get(dispute.disputerId);
                const isInactive = !dispute.isActive;
                const statsKey = `${dispute.recordHash}_${dispute.disputerId}`;

                return (
                  <DisputeUserCard
                    key={dispute.id}
                    dispute={dispute}
                    userProfile={disputerProfile}
                    isInactive={isInactive}
                    currentRecordHash={record.recordHash}
                    onViewUser={() => {}}
                    onViewDetails={() => handleDisputeClick(dispute)}
                  />
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">No disputes for this version</p>
          )}
        </div>
      </div>

      {/* Verification Detail Modal */}
      {selectedVerification && (
        <VerificationDetailModal
          isOpen={isVerificationModalOpen}
          onClose={handleCloseVerificationModal}
          verification={selectedVerification}
          record={record}
          userProfile={userProfiles.get(selectedVerification.verifierId)}
          isOwnVerification={user?.uid === selectedVerification.verifierId}
          onModify={() => {
            handleCloseVerificationModal();
            onModifyVerification?.();
          }}
          onRetract={() => {
            handleCloseVerificationModal();
            initiateRetractVerification(selectedVerification.recordHash);
          }}
        />
      )}

      {/* Dispute Detail Modal */}
      {selectedDispute && (
        <DisputeDetailModal
          record={record}
          isOpen={isDisputeModalOpen}
          onClose={handleCloseDisputeModal}
          dispute={selectedDispute}
          userProfile={userProfiles.get(selectedDispute.disputerId)}
          isOwnDispute={user?.uid === selectedDispute.disputerId}
          onModify={() => {
            handleCloseDisputeModal();
            onModifyDispute?.();
          }}
          onRetract={() => {
            handleCloseDisputeModal();
            initiateRetractDispute(selectedDispute.recordHash);
          }}
        />
      )}

      {/* Credibility Action Dialog (for confirmations, etc.) */}
      <CredibilityActionDialog {...dialogProps} />
    </div>
  );
};

export default VersionDetailPage;
