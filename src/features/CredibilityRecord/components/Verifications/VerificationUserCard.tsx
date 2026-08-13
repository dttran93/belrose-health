//src/features/CredibilityRecord/components/Verifications/VerificationUserCard.tsx

import React from 'react';
import UserCard from '@/features/Users/components/ui/UserCard';
import { UserBadge } from '@/features/Users/components/ui/UserBadge';
import { getVerificationConfig } from '../../services/verificationService';
import { BelroseUserProfile } from '@/types/core';
import { useNavigate } from 'react-router-dom';
import { VerificationDoc } from '@belrose/shared';
import { MenuItem } from '@/features/Users/components/ui/UserMenu';

interface VerificationCardProps {
  verification: VerificationDoc;
  userProfile: BelroseUserProfile | undefined;
  isInactive: boolean;
  currentRecordHash: string | null | undefined;
  onViewUser: () => void;
  onViewDetails: () => void;
  onClick?: () => void;
  additionalItems?: MenuItem[];
}

const VerificationUserCard: React.FC<VerificationCardProps> = ({
  verification,
  userProfile,
  isInactive,
  currentRecordHash,
  onViewUser,
  onViewDetails,
  onClick,
  additionalItems,
}) => {
  const levelInfo = getVerificationConfig(verification.level);
  const navigate = useNavigate();

  // Simple hash comparison to determine if current
  const isCurrent = verification.recordHash === currentRecordHash;
  const versionBadgeText = isCurrent ? 'Current' : 'Non-current';

  const renderBadges = () => (
    <div className="flex items-center gap-2">
      {/* Version Badge */}
      <UserBadge
        text={versionBadgeText}
        color={isCurrent ? 'green' : 'yellow'}
        tooltip={
          isCurrent ? 'Verified the current version' : 'Verified a previous version of this record'
        }
        onClick={e => {
          e.stopPropagation();
          navigate(`/app/records/${verification.recordId}?view=versions`);
        }}
      />

      {/* Level Badge */}
      <UserBadge
        text={levelInfo.name}
        color="purple"
        tooltip={`Verification level: ${levelInfo.name}`}
      />

      {/* Retracted Status Badge */}
      {isInactive && (
        <UserBadge text="Retracted" color="red" tooltip="This verification has been retracted" />
      )}
    </div>
  );

  return (
    <div className={`transition-colors ${isInactive ? 'opacity-60' : ''}`}>
      <UserCard
        user={userProfile}
        userId={verification.verifierId}
        variant="default"
        color={isInactive ? 'red' : 'green'}
        content={renderBadges()}
        onViewUser={onViewUser}
        onViewDetails={onViewDetails}
        additionalItems={additionalItems}
        metadata={[
          {
            label: 'Verified',
            value: verification.createdAt.toDate().toLocaleDateString(),
          },
        ]}
        onCardClick={onClick}
        clickable={!!onClick}
      />
    </div>
  );
};

export default VerificationUserCard;
