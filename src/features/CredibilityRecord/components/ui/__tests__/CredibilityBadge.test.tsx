// @vitest-environment jsdom
//
// src/features/CredibilityRecord/components/ui/__tests__/CredibilityBadge.test.tsx

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CredibilityBadge } from '../CredibilityBadge';

describe('CredibilityBadge', () => {
  it('shows just the tier label, with no fabricated score, when score is undefined', () => {
    render(<CredibilityBadge score={undefined} />);
    expect(screen.getByText('Not yet scored')).toBeInTheDocument();
  });

  it('shows just the tier label when score is null', () => {
    render(<CredibilityBadge score={null} />);
    expect(screen.getByText('Not yet scored')).toBeInTheDocument();
  });

  it('renders a neutral gray badge for "not yet scored", not the red used for Poor', () => {
    // Regression check: the badge used to treat "no score" as its worst-looking (red) state,
    // conflating "no data" with "bad score." It should be visually distinct from Poor.
    const { container: noScore } = render(<CredibilityBadge score={undefined} />);
    const { container: poor } = render(<CredibilityBadge score={50} />);
    const noScoreBadge = noScore.querySelector('span');
    const poorBadge = poor.querySelector('span');
    expect(noScoreBadge?.className).toContain('bg-gray-100');
    expect(noScoreBadge?.className).not.toContain('bg-red-100');
    expect(poorBadge?.className).toContain('bg-red-100');
  });

  it('renders the rounded score alongside the tier label for a scored record', () => {
    render(<CredibilityBadge score={742.4} />);
    expect(screen.getByText('742 · Very Good')).toBeInTheDocument();
  });

  it('labels a score in the Good band', () => {
    render(<CredibilityBadge score={650} />);
    expect(screen.getByText('650 · Good')).toBeInTheDocument();
  });

  it('labels a score in the Excellent band', () => {
    render(<CredibilityBadge score={900} />);
    expect(screen.getByText('900 · Excellent')).toBeInTheDocument();
  });
});
