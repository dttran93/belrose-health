// @vitest-environment jsdom
//
// src/features/CredibilityUser/components/ui/__tests__/UserCredibilityGauge.test.tsx

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserCredibilityGauge } from '../UserCredibilityGauge';
import type { UserCredibilityScore } from '@belrose/shared';

function makeCredibility(overrides: Partial<UserCredibilityScore> = {}): UserCredibilityScore {
  return {
    score: 712,
    lastUpdated: { toDate: () => new Date('2026-01-15') } as UserCredibilityScore['lastUpdated'],
    earnedTrust: 700,
    components: {
      avgRecordCredibility: 700,
      disputeAccuracy: null,
      culpabilityPenalty: 0,
      unacceptedRecordsPenalty: 0,
      credentialFloor: 0,
    },
    vouchPropagated: 152,
    w: 0.2,
    ...overrides,
  };
}

/** score=0/500/1000 land exactly on the arc's left/top/right endpoints — a clean, hand-checkable
 *  regression target for the angleForScore/pointOnArc geometry (a copy-paste mismatch here is
 *  exactly the class of bug the record-credibility mockup review caught). */
function needleEndpoint(container: HTMLElement): { x: number; y: number } {
  const line = container.querySelector('line');
  expect(line).not.toBeNull();
  return {
    x: parseFloat(line!.getAttribute('x2')!),
    y: parseFloat(line!.getAttribute('y2')!),
  };
}

describe('UserCredibilityGauge', () => {
  it('shows a loading skeleton when isLoading is true', () => {
    const { container } = render(<UserCredibilityGauge credibility={undefined} isLoading />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows a not-yet-scored message when credibility is null', () => {
    render(<UserCredibilityGauge credibility={null} />);
    expect(screen.getByText(/not yet scored/i)).toBeInTheDocument();
  });

  it('renders the score, tier label, and earned-trust/vouch stats', () => {
    render(<UserCredibilityGauge credibility={makeCredibility()} />);
    expect(screen.getByText('712')).toBeInTheDocument();
    expect(screen.getByText('Very Good')).toBeInTheDocument();
    expect(screen.getByText('700')).toBeInTheDocument(); // earned trust
    expect(screen.getByText('+152')).toBeInTheDocument(); // from vouches, signed
  });

  it('signs a negative vouch-propagated contribution with a minus, not a bare number', () => {
    render(<UserCredibilityGauge credibility={makeCredibility({ vouchPropagated: -30 })} />);
    expect(screen.getByText('-30')).toBeInTheDocument();
    expect(screen.queryByText('+-30')).not.toBeInTheDocument();
  });

  it('uses a custom heading when provided', () => {
    render(<UserCredibilityGauge credibility={makeCredibility()} heading="Dennis's Credibility" />);
    expect(screen.getByText("Dennis's Credibility")).toBeInTheDocument();
    expect(screen.queryByText('User Credibility')).not.toBeInTheDocument();
  });

  it('defaults the heading to "User Credibility"', () => {
    render(<UserCredibilityGauge credibility={makeCredibility()} />);
    expect(screen.getByText('User Credibility')).toBeInTheDocument();
  });

  it('labels a low score as Poor', () => {
    render(<UserCredibilityGauge credibility={makeCredibility({ score: 120 })} />);
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  it('labels a top score as Excellent', () => {
    render(<UserCredibilityGauge credibility={makeCredibility({ score: 900 })} />);
    expect(screen.getByText('Excellent')).toBeInTheDocument();
  });

  it('points the needle at the top of the arc for a score of 500', () => {
    const { container } = render(<UserCredibilityGauge credibility={makeCredibility({ score: 500 })} />);
    const { x, y } = needleEndpoint(container);
    expect(x).toBeCloseTo(110, 0);
    expect(y).toBeCloseTo(22, 0);
  });

  it('points the needle at the left end of the arc for a score of 0', () => {
    const { container } = render(<UserCredibilityGauge credibility={makeCredibility({ score: 0 })} />);
    const { x, y } = needleEndpoint(container);
    expect(x).toBeCloseTo(22, 0);
    expect(y).toBeCloseTo(110, 0);
  });

  it('points the needle at the right end of the arc for a score of 1000', () => {
    const { container } = render(<UserCredibilityGauge credibility={makeCredibility({ score: 1000 })} />);
    const { x, y } = needleEndpoint(container);
    expect(x).toBeCloseTo(198, 0);
    expect(y).toBeCloseTo(110, 0);
  });
});
