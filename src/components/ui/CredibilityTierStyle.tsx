// src/components/ui/CredibilityTierStyle.tsx
//
// Presentation layer for the shared ScoreTier system (packages/shared/src/credibility.ts,
// getScoreTier/SCORE_TIER_LABELS) — the one place Tailwind classes and icons are mapped to a
// tier, so CredibilityBadge (Record) and UserCredibilityBreakdown (User) render identically
// instead of each keeping its own copy that can drift.
//
// Cross-feature (not under CredibilityRecord/ or CredibilityUser/) for the same reason Button and
// RecordSectionPanel live here — neither feature should reach into the other's folder for it.

import type { LucideIcon } from 'lucide-react';
import { ShieldCheck, ShieldAlert, ShieldX, ShieldPlus, ShieldQuestion } from 'lucide-react';
import { SCORE_TIER_LABELS, type ScoreTier } from '@belrose/shared';

export interface TierStyle {
  label: string;
  bg: string;
  text: string;
  border: string;
  Icon: LucideIcon;
}

export const CREDIBILITY_TIER_STYLE: Record<ScoreTier, TierStyle> = {
  excellent: {
    label: SCORE_TIER_LABELS.excellent,
    bg: 'bg-complement-3/20',
    text: 'text-complement-3',
    border: 'border-complement-3',
    Icon: ShieldCheck,
  },
  veryGood: {
    label: SCORE_TIER_LABELS.veryGood,
    bg: 'bg-complement-3/10',
    text: 'text-complement-3',
    border: 'border-complement-3',
    Icon: ShieldPlus,
  },
  good: {
    label: SCORE_TIER_LABELS.good,
    bg: 'bg-blue-100',
    text: 'text-blue-600',
    border: 'border-blue-500',
    Icon: ShieldCheck,
  },
  fair: {
    label: SCORE_TIER_LABELS.fair,
    bg: 'bg-yellow-100',
    text: 'text-yellow-600',
    border: 'border-yellow-500',
    Icon: ShieldAlert,
  },
  poor: {
    label: SCORE_TIER_LABELS.poor,
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-700',
    Icon: ShieldX,
  },
};

// getScoreTier(score) returns null for "no score yet" — not a ScoreTier itself, so this is kept
// separate rather than smuggled into the Record<ScoreTier, ...> map above. Neutral gray, not red:
// the absence of a score is not the same signal as a Poor one.
export const NO_SCORE_STYLE: TierStyle = {
  label: 'Not yet scored',
  bg: 'bg-gray-100',
  text: 'text-gray-500',
  border: 'border-gray-300',
  Icon: ShieldQuestion,
};

/** Looks up the display style for a score, folding the null ("no score yet") case in. */
export function getTierStyle(tier: ScoreTier | null): TierStyle {
  return tier === null ? NO_SCORE_STYLE : CREDIBILITY_TIER_STYLE[tier];
}

// ── Dark-card palette (UserCredibilityGauge) ────────────────────────────────────────────────
// CREDIBILITY_TIER_STYLE's bg/text/border above are translucent Tailwind classes meant for a
// pill sitting on a WHITE card — too faint to read as a solid arc/fill on a dark gradient card.
// Brighter flat hex per tier, same hue family (red/amber/blue/emerald), for UserCredibilityGauge's
// dark treatment — deliberately the visual opposite of RecordCredibilityBreakdown's white card so
// the two are never confused, while still tracing back to the same five tiers. Matches the
// dark-gradient-card convention already used elsewhere for stat widgets in this app
// (HealthProfile/CredibilityTab's CompletenessBanner, RecordAccessWidget).
export const DARK_TIER_COLOR: Record<ScoreTier, string> = {
  poor: '#f87171',
  fair: '#fbbf24',
  good: '#60a5fa',
  veryGood: '#34d399',
  excellent: '#10b981',
};
