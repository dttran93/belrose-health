// src/features/CredibilityUser/hooks/useUserCredibility.ts

import { useQuery } from '@tanstack/react-query';
import { getUserCredibility } from '../services/userCredibilityService';

/**
 * Fetch a user's current computed UserCredibilityScore. Enabled only once a userId is known
 * (e.g. waiting on auth to resolve) — pass undefined/null to skip the query.
 */
export function useUserCredibility(userId: string | undefined | null) {
  return useQuery({
    queryKey: ['credibility-user', 'user-credibility', userId],
    queryFn: () => getUserCredibility(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}
