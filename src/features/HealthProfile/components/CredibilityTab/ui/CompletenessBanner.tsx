// src/features/HealthProfile/components/CredibilityTab/ui/CompletenessBanner.tsx

/**
 * CompletenessBanner at the top of the Credibility section of the Health Profile
 *
 * Purely an access-completeness signal — does the viewer have access to all
 * the records the subject has anchored on-chain? No credibility judgment here;
 * that's shown per-record via CredibilityBadge in RecordRow.
 */

interface CompletenessBannerProps {
  /** Total records the subject has anchored on-chain (accessible + private) */
  anchoredCount: number;
  /** Of those anchored records, how many the viewer can access */
  accessibleCount: number;
  /** Anchored records the viewer cannot access */
  privateCount: number;
  subjectName: string;
}

export function CompletenessBanner({
  anchoredCount,
  accessibleCount,
  privateCount,
  subjectName,
}: CompletenessBannerProps) {
  const hasFullAccess = privateCount === 0;

  const barSegments = [
    { count: accessibleCount, color: '#10b77f', label: 'accessible' },
    { count: privateCount, color: '#475569', label: 'private' },
  ].filter(s => s.count > 0);

  return (
    <div
      className="rounded-2xl p-5 flex flex-col items-center text-center gap-2"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
    >
      <p className="text-base font-bold text-white">Record Access</p>

      {anchoredCount === 0 ? (
        <p className="text-xs text-slate-400">No records anchored yet</p>
      ) : hasFullAccess ? (
        <p className="text-xs text-slate-400">
          All {anchoredCount} of {subjectName}'s anchored {anchoredCount === 1 ? 'record is' : 'records are'}{' '}
          accessible
        </p>
      ) : (
        <p className="text-xs text-slate-400">
          {accessibleCount} of {anchoredCount} anchored records accessible
          <span className="text-slate-500"> · {privateCount} private</span>
        </p>
      )}

      {anchoredCount > 0 && (
        <div className="flex h-1.5 w-full rounded-full overflow-hidden mt-1 gap-px">
          {barSegments.map(({ count, color }, i) => (
            <div key={i} style={{ flex: count, background: color, borderRadius: 2 }} />
          ))}
        </div>
      )}
    </div>
  );
}

export default CompletenessBanner;
