//src/features/HealthProfile/components/CredibilityTab/ui/HashRow.tsx

import { DisputeDocDecrypted } from '@/features/CredibilityRecord/services/disputeService';
import { UserBadge } from '@/features/Users/components/ui/UserBadge';
import VersionReviewBadge from '@/features/ViewEditRecord/components/Edit/VersionReviewBadge';
import { VerificationDoc } from '@belrose/shared';
import { useNavigate } from 'react-router-dom';

/**
 * Hash row in the hash history section of the Health Profile
 */

function HashRow({
  recordId,
  hash,
  index,
  isCurrent,
  verifications = [],
  disputes = [],
}: {
  recordId: string | undefined;
  hash: string;
  index: number;
  isCurrent: boolean;
  verifications?: VerificationDoc[];
  disputes?: DisputeDocDecrypted[];
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3 py-1.5">
      {/* Version number - fixed width */}
      <span className="text-[10px] text-muted-foreground w-8 shrink-0">v{index + 1}</span>

      {/* Hash - takes remaining space, truncates */}
      <span className="font-mono text-xs text-foreground flex-1 truncate min-w-0">{hash}</span>

      {/* Badge area - fixed width so hashes always truncate at the same point */}
      <div className="flex items-center justify-end gap-1.5 w-56 shrink-0">
        {isCurrent && (
          <UserBadge text="Current" color="blue" tooltip="This is the current version" />
        )}
        <VersionReviewBadge
          stats={{
            verifications: {
              total: verifications.length,
              active: verifications.filter(v => v.isActive).length,
            },
            disputes: {
              total: disputes.length,
              active: disputes.filter(d => d.isActive).length,
            },
          }}
          onClick={() => {
            navigate(`/app/records/${recordId}/?view=versions`);
          }}
          isLoading={false}
        />
      </div>
    </div>
  );
}

export default HashRow;
