// src/features/CredibilityRecord/components/ui/RecordCredibilityBreakdown.tsx
//
// Renders a record's computed credibility score: the tier + score header, an evidence meter
// showing where the score sits across all five tiers relative to the neutral BasePrior, and a
// tally of the verifications/disputes currently counting toward it. Companion to
// UserCredibilityBreakdown — same shared tier system (packages/shared/src/credibility.ts,
// src/components/ui/CredibilityTierStyle.tsx), record-flavored contents, same
// loading/empty/populated structure.
//
// Verification/dispute counts and contributions are derived here from the record's own active,
// current-hash verifications/disputes (already fetched by CredibilityView) rather than fetched
// separately. Active + current-hash is exactly what aggregateRecordScore's scoreEvents replay
// nets out to per verification/dispute (see credibilityScoreService.ts's doc comment), since
// normalizedCredibilityAtCreation is frozen and only `level`/`severity` change on modify — so this
// is the real breakdown, not an approximation of it.

import React from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { VerificationDoc, DisputeDoc, ScoreTier } from '@belrose/shared';
import {
  getScoreTier,
  SCORE_TIER_MIN,
  SCORE_BOUNDS,
  INITIAL_SCORE,
  RECORD_SCORE_C,
  RECORD_VERIFICATION_WEIGHTS,
  RECORD_DISPUTE_SEVERITY_WEIGHTS,
} from '@belrose/shared';
import { getTierStyle } from '@/components/ui/CredibilityTierStyle';
import { getVerificationConfig } from '../../services/verificationService';
import { getSeverityConfig } from '../../services/disputeService';

// ==================== TYPES ====================

export interface RecordCredibilityBreakdownProps {
  score: number | null | undefined;
  lastUpdated?: Timestamp | null;
  verifications: VerificationDoc[];
  disputes: DisputeDoc[];
  currentRecordHash: string | null | undefined;
  isLoading?: boolean;
  className?: string;
}

interface LevelTally {
  level: 1 | 2 | 3;
  count: number;
  contribution: number;
}

interface SeverityTally {
  severity: 1 | 2 | 3;
  count: number;
  contribution: number;
}

// ==================== HELPERS ====================

function tallyVerifications(
  verifications: VerificationDoc[],
  currentHash: string | null | undefined
): LevelTally[] {
  const byLevel = new Map<number, LevelTally>();
  for (const v of verifications) {
    if (!v.isActive || v.recordHash !== currentHash) continue;
    const existing = byLevel.get(v.level) ?? { level: v.level, count: 0, contribution: 0 };
    existing.count += 1;
    existing.contribution +=
      RECORD_VERIFICATION_WEIGHTS[v.level] * v.normalizedCredibilityAtCreation;
    byLevel.set(v.level, existing);
  }
  return Array.from(byLevel.values()).sort((a, b) => b.level - a.level); // Full, then Content, then Provenance
}

function tallyDisputes(
  disputes: DisputeDoc[],
  currentHash: string | null | undefined
): SeverityTally[] {
  const bySeverity = new Map<number, SeverityTally>();
  for (const d of disputes) {
    if (!d.isActive || d.recordHash !== currentHash) continue;
    const existing = bySeverity.get(d.severity) ?? {
      severity: d.severity,
      count: 0,
      contribution: 0,
    };
    existing.count += 1;
    existing.contribution +=
      RECORD_DISPUTE_SEVERITY_WEIGHTS[d.severity] * d.normalizedCredibilityAtCreation;
    bySeverity.set(d.severity, existing);
  }
  return Array.from(bySeverity.values()).sort((a, b) => b.severity - a.severity); // Major, then Moderate, then Negligible
}

// Segment widths for the evidence meter, derived from SCORE_TIER_MIN so they can't drift from the
// real tier boundaries if those constants ever change.
const METER_TIERS: ScoreTier[] = ['poor', 'fair', 'good', 'veryGood', 'excellent'];
const METER_UPPER_BOUND: Record<ScoreTier, number> = {
  poor: SCORE_TIER_MIN.fair,
  fair: SCORE_TIER_MIN.good,
  good: SCORE_TIER_MIN.veryGood,
  veryGood: SCORE_TIER_MIN.excellent,
  excellent: SCORE_BOUNDS.MAX,
};

// Flat fill colors for the meter track — deliberately not CredibilityTierStyle's bg/text/border
// (those are translucent Tailwind classes meant for a pill's background, too faint to read as a
// solid meter fill). Kept local; nothing else needs them.
const METER_COLOR: Record<ScoreTier, string> = {
  poor: '#FCA5A5',
  fair: '#FDE68A',
  good: '#93C5FD',
  veryGood: 'hsl(160 70% 55% / 0.55)',
  excellent: 'hsl(160 84% 39%)',
};

const VERIFICATION_DOT_COLOR = 'hsl(160 84% 39%)'; // complement-3 — same "supports the score" green verifications add
const DISPUTE_DOT_COLOR: Record<1 | 2 | 3, string> = { 1: '#EAB308', 2: '#EAB308', 3: '#B91C1C' };

// ==================== COMPONENT ====================

export const RecordCredibilityBreakdown: React.FC<RecordCredibilityBreakdownProps> = ({
  score,
  lastUpdated,
  verifications,
  disputes,
  currentRecordHash,
  isLoading = false,
  className = '',
}) => {
  if (isLoading) {
    return (
      <div className={`rounded-lg border border-gray-200 p-4 animate-pulse ${className}`}>
        <div className="h-6 w-32 bg-gray-200 rounded mb-3" />
        <div className="h-4 w-full bg-gray-100 rounded mb-2" />
        <div className="h-4 w-full bg-gray-100 rounded" />
      </div>
    );
  }

  const tier = getScoreTier(score);

  if (tier === null) {
    const style = getTierStyle(null);
    return (
      <div className={`rounded-lg border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-500">
          <style.Icon className="w-5 h-5" />
          <span className="text-sm">
            Not yet scored — this record starts from a neutral baseline and moves once someone
            verifies or disputes it.
          </span>
        </div>
      </div>
    );
  }

  const style = getTierStyle(tier);
  const resolvedScore = score as number;
  const pct = Math.max(1, Math.min(99, (resolvedScore / SCORE_BOUNDS.MAX) * 100));

  const verificationTallies = tallyVerifications(verifications, currentRecordHash);
  const disputeTallies = tallyDisputes(disputes, currentRecordHash);
  const verificationCount = verificationTallies.reduce((sum, t) => sum + t.count, 0);
  const disputeCount = disputeTallies.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className={`rounded-lg border ${style.border} p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${style.bg} ${style.text}`}
        >
          <style.Icon className="w-5 h-5" />
          <span className="font-semibold">{style.label}</span>
        </div>
        <div className="text-2xl font-bold text-gray-900 tabular-nums">
          {Math.round(resolvedScore)}
          <span className="text-sm font-normal text-gray-400">/{SCORE_BOUNDS.MAX}</span>
        </div>
      </div>

      {/* Evidence meter — where this score sits across all five tiers */}
      <div className="relative mb-1">
        <div className="flex w-full h-2 rounded-full overflow-hidden">
          {METER_TIERS.map(t => (
            <div
              key={t}
              style={{
                flexBasis: `${((METER_UPPER_BOUND[t] - SCORE_TIER_MIN[t]) / SCORE_BOUNDS.MAX) * 100}%`,
                background: METER_COLOR[t],
              }}
            />
          ))}
        </div>
        <div
          className="absolute -top-1.5 w-0.5 h-5 bg-gray-900 rounded"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-300 mb-1">
        <span>0</span>
        <span>{INITIAL_SCORE} (neutral baseline)</span>
        <span>{SCORE_BOUNDS.MAX}</span>
      </div>

      {verificationCount === 0 && disputeCount === 0 ? (
        <p className="text-xs text-gray-400">
          No verifications or disputes on the current version of this record yet. Record credibility
          starts at a neutral baseline and moves as verifications and disputes accumulate.
        </p>
      ) : (
        <div className="flex gap-8">
          <div className="flex-1">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Verifications · {verificationCount}
            </div>
            {verificationTallies.length === 0 && (
              <div className="text-xs text-gray-300 py-1.5">None</div>
            )}
            {verificationTallies.map(t => (
              <div
                key={t.level}
                className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ background: VERIFICATION_DOT_COLOR }}
                  />
                  <span className="text-sm text-gray-700">
                    {getVerificationConfig(t.level).name} ×{t.count}
                  </span>
                </div>
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: 'hsl(160 84% 29%)' }}
                >
                  +{Math.round(t.contribution)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex-1">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Disputes · {disputeCount}
            </div>
            {disputeTallies.length === 0 && (
              <div className="text-xs text-gray-300 py-1.5">None</div>
            )}
            {disputeTallies.map(t => (
              <div
                key={t.severity}
                className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ background: DISPUTE_DOT_COLOR[t.severity] }}
                  />
                  <span className="text-sm text-gray-700">
                    {getSeverityConfig(t.severity).name} ×{t.count}
                  </span>
                </div>
                <span className="text-sm font-semibold tabular-nums text-red-700">
                  −{Math.round(t.contribution)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastUpdated && (
        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
          Last updated {lastUpdated.toDate().toLocaleDateString()}
        </div>
      )}
    </div>
  );
};

export default RecordCredibilityBreakdown;
