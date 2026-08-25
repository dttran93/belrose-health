// src/features/Settings/components/VouchesSettings.tsx

import { getAuth } from 'firebase/auth';
import { useLocation } from 'react-router';
import {
  VouchManagement,
  VouchManagementInitialTarget,
} from '@/features/CredibilityUser/components/Vouches/VouchManagement';

const VouchesSettings = () => {
  const auth = getAuth();
  const userId = auth.currentUser?.uid;
  const location = useLocation();

  if (!userId) return null;

  // Components navigating to this page with a specific user context can pass
  // { targetUserId, targetDisplayName } in the router state. Example:
  //   navigate('/app/settings/vouches', { state: { targetUserId: '...', targetDisplayName: '...' } })
  const state = location.state as { targetUserId?: string; targetDisplayName?: string } | null;
  // Ignore self — UserMenu always passes the viewed user, but you can't vouch for yourself.
  const initialTarget: VouchManagementInitialTarget | undefined =
    state?.targetUserId && state.targetUserId !== userId
      ? { userId: state.targetUserId, displayName: state.targetDisplayName ?? state.targetUserId }
      : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Vouches</h2>
        <p className="text-sm text-gray-500">
          Vouches are trust statements between members of the Belrose network. They contribute to
          your credibility score.
        </p>
      </div>
      <VouchManagement userId={userId} initialTarget={initialTarget} />
    </div>
  );
};

export default VouchesSettings;
