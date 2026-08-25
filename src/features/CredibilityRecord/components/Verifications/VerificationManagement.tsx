// src/features/CredibilityRecord/components/VerificationManagement.tsx

/**
 * Component for managing all the verifications on a recordId
 * including verifications across different hashes and made by different users
 *
 * This is in contrast to the Verification Form which contains details on the specific
 * user's review and options to create Verifications.
 *
 * Management View includes modal to see further details on each verification.
 */

import React, { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getUserProfiles } from '@/features/Users/services/userProfileService';
import { FileObject, BelroseUserProfile } from '@/types/core';
import { useAuth } from '@/features/Auth/hooks/useAuth';
import { getVerificationsByRecordId } from '../../services/verificationService';
import VerificationDetailModal from './VerificationDetailModal';
import VerificationUserCard from './VerificationUserCard';
import RecordSectionPanel from '@/components/ui/RecordSectionPanel';
import { VerificationDoc } from '@belrose/shared';

interface VerificationManagementProps {
  record: FileObject;
  onBack?: () => void;
  onAddMode?: () => void;
  isAddMode?: boolean;
  onModify?: () => void;
  onRetract?: (verification: VerificationDoc) => void;
  refreshKey?: number;
}

export const VerificationManagement: React.FC<VerificationManagementProps> = ({
  record,
  onBack,
  onAddMode,
  isAddMode,
  onModify,
  onRetract,
  refreshKey,
}) => {
  const { user } = useAuth();
  const [loadingVerifications, setLoadingVerifications] = useState(true);
  const [verifications, setVerifications] = useState<VerificationDoc[]>([]);
  const [userProfiles, setUserProfiles] = useState<Map<string, BelroseUserProfile>>(new Map());

  // Modal state
  const [selectedVerification, setSelectedVerification] = useState<VerificationDoc | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch verifications and user profiles
  useEffect(() => {
    const fetchVerifications = async () => {
      const recordId = record.firestoreId || record.id;
      if (!recordId) return;

      setLoadingVerifications(true);
      try {
        // 1. Fetch all verifications for this record
        const allVerifications = await getVerificationsByRecordId(recordId);

        // 2. Sort: active first, then by whether it matches current hash, then by createdAt
        const sortedVerifications = [...allVerifications].sort((a, b) => {
          // Active verifications first
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          // Current hash verifications first
          const aIsCurrent = a.recordHash === record.recordHash;
          const bIsCurrent = b.recordHash === record.recordHash;
          if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
          // Then by creation date (newest first)
          return b.createdAt.toMillis() - a.createdAt.toMillis();
        });

        setVerifications(sortedVerifications);

        // 3. Get unique verifier IDs and fetch their profiles
        const verifierIds = [...new Set(allVerifications.map(v => v.verifierId))];
        if (verifierIds.length > 0) {
          const profiles = await getUserProfiles(verifierIds);
          setUserProfiles(profiles);
        }
      } catch (error) {
        console.error('Error fetching verifications:', error);
      } finally {
        setLoadingVerifications(false);
      }
    };

    fetchVerifications();
  }, [record.firestoreId, record.id, record.recordHash, record.previousRecordHash, refreshKey]);

  // Handlers
  const handleCardClick = (verification: VerificationDoc) => {
    setSelectedVerification(verification);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedVerification(null);
  };

  const handleModify = () => {
    if (selectedVerification && onModify) {
      handleCloseModal();
      onModify();
    }
  };

  const handleRetract = () => {
    if (selectedVerification && onRetract) {
      handleCloseModal();
      onRetract(selectedVerification);
    }
  };

  // Count active verifications
  const activeCount = verifications.filter(v => v.isActive).length;

  const tooltipContent = (
    <>
      <p className="font-semibold mb-2 text-sm">
        Verifications represent the support of 2nd and 3rd parties for the content or origin of this
        record
      </p>
      <ol className="list-decimal list-inside space-y-1 text-xs">
        <li>Verifications may be given by anyone with access to the record</li>
        <li>
          Verifications are permanently stored on a secure digital network, but may be modified or
          retracted
        </li>
        <li>
          A record's credibility score is calculated based on the number and quality of
          verifications and disputes
        </li>
      </ol>
    </>
  );

  return (
    <div>
      <RecordSectionPanel
        icon={<Shield className="w-5 h-5 text-gray-700" />}
        title="Verifications"
        badges={[
          {
            label: `${activeCount} active`,
            className: 'border border-complement-3 bg-complement-3/20 text-complement-3',
          },
        ]}
        showActions={!isAddMode}
        tooltipLabel="Verifications"
        tooltipClassName="bg-complement-3/30 border border-complement-3 text-complement-3"
        tooltipContent={tooltipContent}
        onAdd={onAddMode}
        isLoading={loadingVerifications}
        loadingLabel="Loading verifications..."
        isEmpty={verifications.length === 0}
        emptyState={
          <div className="flex justify-between items-center">
            <p className="text-gray-600">No verifications yet</p>
            <Button onClick={onAddMode}>Add a Verification</Button>
          </div>
        }
      >
        {verifications.map(verification => (
          <VerificationUserCard
            key={verification.id}
            verification={verification}
            userProfile={userProfiles.get(verification.verifierId)}
            isInactive={!verification.isActive}
            currentRecordHash={record.recordHash}
            onViewUser={() => {}}
            onViewDetails={() => handleCardClick(verification)}
          />
        ))}
      </RecordSectionPanel>

      {/* Detail Modal */}
      {selectedVerification && (
        <VerificationDetailModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          verification={selectedVerification}
          record={record}
          userProfile={userProfiles.get(selectedVerification.verifierId)}
          isOwnVerification={user?.uid === selectedVerification.verifierId}
          onModify={handleModify}
          onRetract={handleRetract}
        />
      )}
    </div>
  );
};

export default VerificationManagement;
