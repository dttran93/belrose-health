// src/features/CredibilityRecord/components/Disputes/DisputeUserCard.tsx

import React from 'react';
import UserCard from '@/features/Users/components/ui/UserCard';
import { UserBadge } from '@/features/Users/components/ui/UserBadge';
import {
  DisputeDocDecrypted,
  getCulpabilityConfig,
  getSeverityConfig,
} from '../../services/disputeService';
import { BelroseUserProfile } from '@/types/core';
import { useNavigate } from 'react-router-dom';
import { MenuItem } from '@/features/Users/components/ui/UserMenu';

interface DisputeCardProps {
  dispute: DisputeDocDecrypted;
  userProfile: BelroseUserProfile | undefined;
  isInactive: boolean;
  currentRecordHash: string | null | undefined;
  onViewUser: () => void;
  onViewDetails: () => void;
  additionalItems?: MenuItem[];
}

const DisputeUserCard: React.FC<DisputeCardProps> = ({
  dispute,
  userProfile,
  isInactive,
  currentRecordHash,
  onViewUser,
  onViewDetails,
  additionalItems,
}) => {
  const severityInfo = getSeverityConfig(dispute.severity);
  const culpabilityInfo = getCulpabilityConfig(dispute.culpability);
  const navigate = useNavigate();

  if (!severityInfo || !culpabilityInfo) {
    throw new Error('Invalid severity or culpability level');
  }

  const isCurrent = dispute.recordHash === currentRecordHash;

  const renderDisputeContent = () => {
    return (
      <div className="flex items-center gap-3">
        {/* Dispute Badges */}
        <div className="flex flex-wrap gap-2">
          <UserBadge
            text={isCurrent ? 'Current' : 'Non-current'}
            color={isCurrent ? 'green' : 'yellow'}
            tooltip={
              isCurrent
                ? 'Disputed the current version'
                : `Disputed a previous version of this record`
            }
            onClick={e => {
              e.stopPropagation();
              navigate(`/app/records/${dispute.recordId}?view=versions`);
            }}
          />
          <UserBadge
            text={severityInfo.name}
            color={dispute.severity === 3 ? 'red' : dispute.severity === 2 ? 'yellow' : 'blue'}
            tooltip={`Severity: ${severityInfo.name}`}
          />
          <UserBadge
            text={culpabilityInfo.name}
            color="purple"
            tooltip={`Culpability: ${culpabilityInfo.name}`}
          />
          {isInactive && (
            <UserBadge text="Retracted" color="red" tooltip="This dispute has been retracted" />
          )}
          {dispute.chainStatus === 'pending' && (
            <UserBadge text="Pending" color="yellow" tooltip="Awaiting network confirmation" />
          )}
          {dispute.chainStatus === 'failed' && (
            <UserBadge text="Failed" color="red" tooltip="Network transaction failed" />
          )}
        </div>
      </div>
    );
  };

  return (
    <UserCard
      user={userProfile}
      userId={dispute.disputerId}
      variant="default"
      color={isInactive ? 'red' : 'yellow'}
      content={renderDisputeContent()}
      onViewUser={onViewUser}
      onViewDetails={onViewDetails}
      additionalItems={additionalItems}
      className={isInactive ? 'opacity-60' : ''}
      metadata={[
        {
          label: 'Filed',
          value: dispute.createdAt.toDate().toLocaleDateString(),
        },
      ]}
    />
  );
};

export default DisputeUserCard;
