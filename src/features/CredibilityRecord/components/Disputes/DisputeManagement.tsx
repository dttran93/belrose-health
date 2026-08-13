// src/features/CredibilityRecord/components/DisputeManagement.tsx

import React, { useState, useEffect } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getUserProfiles } from '@/features/Users/services/userProfileService';
import { FileObject, BelroseUserProfile } from '@/types/core';
import { useAuth } from '@/features/Auth/hooks/useAuth';
import { DisputeDocDecrypted, getDisputesByRecordId } from '../../services/disputeService';
import DisputeDetailModal from './DisputeDetailModal';
import DisputeUserCard from './DisputeUserCard';
import RecordSectionPanel from '@/components/ui/RecordSectionPanel';
import { DisputeDoc } from '@belrose/shared';

// ============================================================
// TYPES
// ============================================================

interface DisputeManagementProps {
  record: FileObject;
  onBack?: () => void;
  onAddMode?: () => void;
  isAddMode?: boolean;
  onModify?: (dispute: DisputeDoc) => void;
  onRetract?: (dispute: DisputeDoc) => void;
  onReact?: (recordHash: string, disputerId: string, support: boolean) => void;
  refreshKey?: number;
}

export const DisputeManagement: React.FC<DisputeManagementProps> = ({
  record,
  onBack,
  onAddMode,
  isAddMode,
  onModify,
  onRetract,
  onReact,
  refreshKey,
}) => {
  const { user } = useAuth();
  const [loadingDisputes, setLoadingDisputes] = useState(true);
  const [disputes, setDisputes] = useState<DisputeDocDecrypted[]>([]);
  const [userProfiles, setUserProfiles] = useState<Map<string, BelroseUserProfile>>(new Map());
  const [selectedDispute, setSelectedDispute] = useState<DisputeDocDecrypted | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch disputes and user profiles
  useEffect(() => {
    const fetchDisputes = async () => {
      const recordId = record.firestoreId || record.id;
      if (!recordId) return;

      setLoadingDisputes(true);
      try {
        // 1. Fetch all disputes for this record
        const allDisputes = await getDisputesByRecordId(recordId);

        // 2. Sort: active first, then current hash first, then by createdAt
        const sortedDisputes = [...allDisputes].sort((a, b) => {
          // Active disputes first
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          // Current hash disputes first
          const aIsCurrent = a.recordHash === record.recordHash;
          const bIsCurrent = b.recordHash === record.recordHash;
          if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
          // Then by creation date (newest first)
          return b.createdAt.toMillis() - a.createdAt.toMillis();
        });

        setDisputes(sortedDisputes);

        // 3. Get unique disputer IDs and fetch their profiles
        const disputerIds = [...new Set(allDisputes.map(d => d.disputerId))];

        await Promise.all([
          disputerIds.length > 0
            ? getUserProfiles(disputerIds).then(setUserProfiles)
            : Promise.resolve(),
        ]);
      } catch (error) {
        console.error('Error fetching disputes:', error);
      } finally {
        setLoadingDisputes(false);
      }
    };

    fetchDisputes();
  }, [record.firestoreId, record.id, record.recordHash, user?.uid, refreshKey]);

  // ============================================================
  // HANDLERS
  // ============================================================

  const handleCardClick = (dispute: DisputeDocDecrypted) => {
    setSelectedDispute(dispute);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedDispute(null);
  };

  const handleModify = () => {
    if (selectedDispute && onModify) {
      handleCloseModal();
      onModify(selectedDispute);
    }
  };

  const handleRetract = () => {
    if (selectedDispute && onRetract) {
      handleCloseModal();
      onRetract(selectedDispute);
    }
  };

  const handleModalReact = (disputerId: string, support: boolean) => {
    if (selectedDispute && onReact) {
      handleCloseModal();
      onReact(selectedDispute.recordHash, disputerId, support);
    }
  };

  // Count active disputes
  const activeCount = disputes.filter(d => d.isActive).length;

  const tooltipContent = (
    <>
      <p className="font-semibold mb-2 text-sm">
        Disputes flag concerns about the accuracy or authenticity of this record
      </p>
      <ol className="list-decimal list-inside space-y-1 text-xs">
        <li>Disputes may be filed by anyone with access to the record</li>
        <li>
          Disputes are permanently stored on a secure digital network, but may be modified or
          retracted
        </li>
        <li>Each dispute includes severity (how serious) and culpability (who's responsible)</li>
        <li>Others can react to disputes to support or oppose them</li>
      </ol>
    </>
  );

  return (
    <div>
      <RecordSectionPanel
        icon={<AlertTriangle className="w-5 h-5 text-gray-700" />}
        title="Disputes"
        badges={[
          {
            label: `${activeCount} active`,
            className: 'border border-red-500 bg-red-200 text-red-700',
          },
        ]}
        showActions={!isAddMode}
        tooltipLabel="Disputes"
        tooltipClassName="bg-red-200 border border-red-700 text-red-700"
        tooltipContent={tooltipContent}
        onAdd={onAddMode}
        isLoading={loadingDisputes}
        loadingLabel="Loading disputes..."
        isEmpty={disputes.length === 0}
        emptyState={
          <div className="flex justify-between items-center">
            <p className="text-gray-600">No disputes filed</p>
            <Button onClick={onAddMode} variant="outline" className="border-red-300 text-red-700">
              File a Dispute
            </Button>
          </div>
        }
      >
        {disputes.map(dispute => {
          return (
            <DisputeUserCard
              key={dispute.id}
              dispute={dispute}
              userProfile={userProfiles.get(dispute.disputerId)}
              isInactive={!dispute.isActive}
              currentRecordHash={record.recordHash}
              onViewUser={() => {}}
              onViewDetails={() => handleCardClick(dispute)}
            />
          );
        })}
      </RecordSectionPanel>

      {/* Detail Modal */}
      {selectedDispute && (
        <DisputeDetailModal
          record={record}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          dispute={selectedDispute}
          userProfile={userProfiles.get(selectedDispute.disputerId)}
          isOwnDispute={user?.uid === selectedDispute.disputerId}
          onModify={handleModify}
          onRetract={handleRetract}
        />
      )}
    </div>
  );
};

export default DisputeManagement;
