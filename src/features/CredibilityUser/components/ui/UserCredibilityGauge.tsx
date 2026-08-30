// src/features/CredibilityUser/components/ui/UserCredibilityGauge.tsx
//
// Hero display for a user's UserCredibilityScore: a semicircular gauge (dark card, needle at the
// current score) split into the same five tiers as RecordCredibilityBreakdown's linear meter —
// deliberately the opposite visual language (dark + circular vs. white + linear) so User and
// Record credibility are never mistaken for each other, while the tier boundaries themselves
// still come from the same shared system (packages/shared/src/credibility.ts's SCORE_TIER_MIN),
// just rendered through DARK_TIER_COLOR (src/components/ui/CredibilityTierStyle.tsx) instead of
// CREDIBILITY_TIER_STYLE's pill classes.
//
// Companion to UserCredibilityBreakdown, which renders the score's actual component breakdown —
// this is the summary/hero, that one is the detail. Compose them together (gauge above,
// breakdown below); this component intentionally doesn't try to also render the breakdown rows.

import React from 'react';
import type { UserCredibilityScore, ScoreTier } from '@belrose/shared';
import { getScoreTier, SCORE_TIER_MIN, SCORE_BOUNDS, SCORE_TIER_LABELS } from '@belrose/shared';
import { DARK_TIER_COLOR } from '@/components/ui/CredibilityTierStyle';
import { ShieldQuestion } from 'lucide-react';

// ==================== TYPES ====================

export interface UserCredibilityGaugeProps {
  credibility: UserCredibilityScore | null | undefined;
  isLoading?: boolean;
  /** e.g. "Dennis's Credibility" when shown on someone else's profile. Defaults to "User Credibility". */
  heading?: string;
  className?: string;
}

// ==================== GEOMETRY ====================
// A 180° arc, left (score 0) -> top (score 500) -> right (score 1000), centered at (CX, CY).
// Segment boundaries and the needle both derive from the same angleForScore mapping, so they can
// never drift apart from each other or from SCORE_TIER_MIN.

const CX = 110;
const CY = 110;
const ARC_RADIUS = 90;
const NEEDLE_RADIUS = 88;
const METER_TIERS: ScoreTier[] = ['poor', 'fair', 'good', 'veryGood', 'excellent'];
const TIER_UPPER_BOUND: Record<ScoreTier, number> = {
  poor: SCORE_TIER_MIN.fair,
  fair: SCORE_TIER_MIN.good,
  good: SCORE_TIER_MIN.veryGood,
  veryGood: SCORE_TIER_MIN.excellent,
  excellent: SCORE_BOUNDS.MAX,
};

function angleForScore(score: number): number {
  return 180 - (score / SCORE_BOUNDS.MAX) * 180;
}

function pointOnArc(score: number, radius: number): { x: number; y: number } {
  const rad = (angleForScore(score) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

function arcPath(fromScore: number, toScore: number): string {
  const start = pointOnArc(fromScore, ARC_RADIUS);
  const end = pointOnArc(toScore, ARC_RADIUS);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

// ==================== COMPONENT ====================

export const UserCredibilityGauge: React.FC<UserCredibilityGaugeProps> = ({
  credibility,
  isLoading = false,
  heading = 'User Credibility',
  className = '',
}) => {
  const cardStyle: React.CSSProperties = {
    borderRadius: 16,
    padding: '22px 24px 18px 24px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  };

  if (isLoading) {
    return (
      <div style={cardStyle} className={`animate-pulse ${className}`}>
        <div className="h-3 w-32 bg-slate-700 rounded mb-4" />
        <div className="h-24 w-full bg-slate-800 rounded-t-full mx-auto" style={{ maxWidth: 200 }} />
        <div className="h-8 w-24 bg-slate-700 rounded mx-auto mt-4" />
      </div>
    );
  }

  if (credibility === null || credibility === undefined) {
    return (
      <div style={cardStyle} className={className}>
        <div className="flex items-center gap-2 text-slate-400">
          <ShieldQuestion className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">
            Not yet scored — credibility is calculated periodically and will appear here once
            computed.
          </span>
        </div>
      </div>
    );
  }

  const score = credibility.score;
  const tier = getScoreTier(score);
  // getScoreTier only returns null for a null/undefined score — credibility.score is always a
  // number once the doc exists, so this is unreachable in practice; narrows the type for below.
  const resolvedTier: ScoreTier = tier ?? 'poor';
  const tierColor = DARK_TIER_COLOR[resolvedTier];
  const needle = pointOnArc(score, NEEDLE_RADIUS);

  return (
    <div style={cardStyle} className={className}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">
        {heading}
      </div>

      <svg width={200} height={118} viewBox="0 0 220 128" className="block mx-auto">
        {METER_TIERS.map(t => (
          <path
            key={t}
            d={arcPath(SCORE_TIER_MIN[t], TIER_UPPER_BOUND[t])}
            fill="none"
            stroke={DARK_TIER_COLOR[t]}
            strokeWidth={16}
            strokeLinecap="round"
          />
        ))}
        <line
          x1={CX}
          y1={CY}
          x2={needle.x}
          y2={needle.y}
          stroke="#f8fafc"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r={7} fill="#f8fafc" />
        <circle cx={CX} cy={CY} r={3} fill="#0f172a" />
      </svg>

      <div className="text-center -mt-1">
        <div
          className="text-[34px] font-extrabold text-slate-50 leading-none"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
          {Math.round(score)}
          <span className="text-[13px] font-medium text-slate-500">/{SCORE_BOUNDS.MAX}</span>
        </div>
        <div className="text-[13px] font-semibold mt-1" style={{ color: tierColor }}>
          {SCORE_TIER_LABELS[resolvedTier]}
        </div>
      </div>

      <div className="flex gap-2.5 mt-5 pt-3.5 border-t border-white/10">
        <div className="flex-1 text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
            Earned trust
          </div>
          <div
            className="text-base font-bold text-slate-200"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          >
            {Math.round(credibility.earnedTrust)}
          </div>
        </div>
        <div className="w-px bg-white/10" />
        <div className="flex-1 text-center">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
            From vouches
          </div>
          <div
            className="text-base font-bold text-slate-200"
            style={{ fontFamily: 'ui-monospace, monospace' }}
          >
            {`${credibility.vouchPropagated >= 0 ? '+' : ''}${Math.round(credibility.vouchPropagated)}`}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserCredibilityGauge;
