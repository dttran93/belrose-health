// src/features/Settings/components/CredibilitySettings.tsx

import { useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { useUserCredibility } from '@/features/CredibilityUser/hooks/useUserCredibility';
import { getActiveVouchesReceived } from '@/features/CredibilityUser/services/vouchService';
import UserCredibilityGauge from '@/features/CredibilityUser/components/ui/UserCredibilityGauge';
import UserCredibilityBreakdown from '@/features/CredibilityUser/components/ui/UserCredibilityBreakdown';

const CredibilitySettings = () => {
  const auth = getAuth();
  const userId = auth.currentUser?.uid;
  const navigate = useNavigate();

  const { data: credibility, isLoading } = useUserCredibility(userId);

  const { data: vouchesReceived } = useQuery({
    queryKey: ['credibility-user', 'active-vouches-received', userId],
    queryFn: () => getActiveVouchesReceived(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  if (!userId) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Credibility</h2>
        <p className="text-sm text-gray-500">
          Your standing across the Belrose network — built from records you've verified, disputes
          you've filed, and trust vouched to you by others.
        </p>
      </div>

      <UserCredibilityGauge credibility={credibility} isLoading={isLoading} />

      {!isLoading && (
        <button
          onClick={() => navigate('/app/settings/vouches')}
          className="w-full flex items-center justify-between text-left rounded-lg border border-gray-200 px-4 py-3 hover:border-gray-300 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm text-gray-700">
            {vouchesReceived === undefined
              ? 'Loading vouches…'
              : vouchesReceived.length === 0
                ? 'No one has vouched for you yet'
                : `${vouchesReceived.length} ${vouchesReceived.length === 1 ? 'person vouches' : 'people vouch'} for you`}
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            Manage vouches
            <ArrowUpRight className="w-4 h-4" />
          </span>
        </button>
      )}

      <UserCredibilityBreakdown credibility={credibility} isLoading={isLoading} />
    </div>
  );
};

export default CredibilitySettings;
