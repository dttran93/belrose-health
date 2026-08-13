// @vitest-environment jsdom
//
// src/features/CredibilityUser/components/ui/__tests__/UserCredibilityBreakdown.test.tsx

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserCredibilityBreakdown } from '../UserCredibilityBreakdown';
import type { UserCredibilityScore } from '@belrose/shared';

function makeCredibility(overrides: Partial<UserCredibilityScore> = {}): UserCredibilityScore {
  return {
    score: 720,
    lastUpdated: { toDate: () => new Date('2026-01-15') } as UserCredibilityScore['lastUpdated'],
    earnedTrust: 650,
    components: {
      avgRecordCredibility: 700,
      disputeAccuracy: null,
      culpabilityPenalty: 0,
      credentialFloor: 0,
    },
    vouchPropagated: 70,
    w: 0.2,
    ...overrides,
  };
}

describe('UserCredibilityBreakdown', () => {
  it('shows a loading skeleton when isLoading is true', () => {
    const { container } = render(<UserCredibilityBreakdown credibility={undefined} isLoading />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows a not-yet-scored message when credibility is null', () => {
    render(<UserCredibilityBreakdown credibility={null} />);
    expect(screen.getByText(/not yet scored/i)).toBeInTheDocument();
  });

  it('renders the score and Very Good tier label for a 720 score', () => {
    render(<UserCredibilityBreakdown credibility={makeCredibility({ score: 720 })} />);
    expect(screen.getByText('720')).toBeInTheDocument();
    expect(screen.getByText('Very Good')).toBeInTheDocument();
  });

  it('renders null components as an em dash, not 0', () => {
    render(
      <UserCredibilityBreakdown
        credibility={makeCredibility({
          components: {
            avgRecordCredibility: null,
            disputeAccuracy: null,
            culpabilityPenalty: 0,
            credentialFloor: 0,
          },
        })}
      />
    );
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2); // avgRecordCredibility + disputeAccuracy
  });

  it('renders the culpability penalty as a negative deduction', () => {
    render(
      <UserCredibilityBreakdown
        credibility={makeCredibility({
          components: {
            avgRecordCredibility: 600,
            disputeAccuracy: null,
            culpabilityPenalty: 150,
            credentialFloor: 0,
          },
        })}
      />
    );
    expect(screen.getByText('-150')).toBeInTheDocument();
  });

  it('labels a low score as Poor', () => {
    render(<UserCredibilityBreakdown credibility={makeCredibility({ score: 120 })} />);
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });
});
