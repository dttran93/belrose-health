// @vitest-environment jsdom
//
// src/features/CredibilityRecord/components/ui/__tests__/RecordCredibilityBreakdown.test.tsx

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordCredibilityBreakdown } from '../RecordCredibilityBreakdown';
import type { VerificationDoc, DisputeDoc } from '@belrose/shared';

const CURRENT_HASH = 'hash-current';
const STALE_HASH = 'hash-stale';

function makeVerification(overrides: Partial<VerificationDoc> = {}): VerificationDoc {
  return {
    id: 'v1',
    recordIdHash: 'record-id-hash',
    recordHash: CURRENT_HASH,
    recordId: 'record-1',
    verifierId: 'verifier-1',
    verifierIdHash: 'verifier-id-hash',
    level: 3,
    isActive: true,
    createdAt: { toDate: () => new Date('2026-01-01'), toMillis: () => 0 } as VerificationDoc['createdAt'],
    chainStatus: 'confirmed',
    onChainHistory: [],
    encryptedRecordTitleIv: 'iv',
    normalizedCredibilityAtCreation: 1.0,
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeDoc> = {}): DisputeDoc {
  return {
    id: 'd1',
    recordHash: CURRENT_HASH,
    recordId: 'record-1',
    recordIdHash: 'record-id-hash',
    disputerId: 'disputer-1',
    disputerIdHash: 'disputer-id-hash',
    severity: 2,
    culpability: 0,
    notesHash: 'notes-hash',
    isActive: true,
    createdAt: { toDate: () => new Date('2026-01-01'), toMillis: () => 0 } as DisputeDoc['createdAt'],
    chainStatus: 'confirmed',
    onChainHistory: [],
    recordScoreAtCreation: 500,
    validationWeight: 0,
    normalizedCredibilityAtCreation: 1.0,
    ...overrides,
  };
}

const baseProps = {
  verifications: [] as VerificationDoc[],
  disputes: [] as DisputeDoc[],
  currentRecordHash: CURRENT_HASH,
};

describe('RecordCredibilityBreakdown', () => {
  it('shows a loading skeleton when isLoading is true', () => {
    const { container } = render(
      <RecordCredibilityBreakdown {...baseProps} score={undefined} isLoading />
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows a not-yet-scored message when score is null, without a fabricated number', () => {
    render(<RecordCredibilityBreakdown {...baseProps} score={null} />);
    expect(screen.getByText(/not yet scored/i)).toBeInTheDocument();
    expect(screen.queryByText('500')).not.toBeInTheDocument();
  });

  it('renders the score and its tier label', () => {
    render(<RecordCredibilityBreakdown {...baseProps} score={650} />);
    expect(screen.getByText('650')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('says nothing is counting toward the score when there is no current-hash evidence', () => {
    render(<RecordCredibilityBreakdown {...baseProps} score={500} />);
    expect(screen.getByText(/no verifications or disputes/i)).toBeInTheDocument();
  });

  it('tallies active, current-hash verifications by level with their weighted contribution', () => {
    render(
      <RecordCredibilityBreakdown
        {...baseProps}
        score={700}
        verifications={[
          makeVerification({ id: 'v-full', level: 3, normalizedCredibilityAtCreation: 1.0 }),
          makeVerification({ id: 'v-content', level: 2, normalizedCredibilityAtCreation: 1.0 }),
          // Excluded: retracted
          makeVerification({ id: 'v-inactive', level: 3, isActive: false }),
          // Excluded: verified a since-superseded version of the record
          makeVerification({ id: 'v-stale', level: 3, recordHash: STALE_HASH }),
        ]}
      />
    );

    expect(screen.getByText('Verifications · 2')).toBeInTheDocument();
    expect(screen.getByText('Full ×1')).toBeInTheDocument();
    expect(screen.getByText('+950')).toBeInTheDocument();
    expect(screen.getByText('Content ×1')).toBeInTheDocument();
    expect(screen.getByText('+800')).toBeInTheDocument();
  });

  it('tallies active, current-hash disputes by severity with their weighted deduction', () => {
    render(
      <RecordCredibilityBreakdown
        {...baseProps}
        score={400}
        disputes={[
          makeDispute({ id: 'd-moderate', severity: 2, normalizedCredibilityAtCreation: 1.0 }),
          // Excluded: retracted
          makeDispute({ id: 'd-inactive', severity: 3, isActive: false }),
          // Excluded: filed against a since-superseded version of the record
          makeDispute({ id: 'd-stale', severity: 3, recordHash: STALE_HASH }),
        ]}
      />
    );

    expect(screen.getByText('Disputes · 1')).toBeInTheDocument();
    expect(screen.getByText('Moderate ×1')).toBeInTheDocument();
    expect(screen.getByText('−300')).toBeInTheDocument();
  });

  it('scales a verification contribution by the verifier NormalizedCredibility frozen at creation', () => {
    render(
      <RecordCredibilityBreakdown
        {...baseProps}
        score={700}
        verifications={[
          makeVerification({ level: 3, normalizedCredibilityAtCreation: 1.5 }), // 950 * 1.5 = 1425
        ]}
      />
    );
    expect(screen.getByText('+1425')).toBeInTheDocument();
  });

  it('sums multiple active verifications at the same level into one row', () => {
    render(
      <RecordCredibilityBreakdown
        {...baseProps}
        score={700}
        verifications={[
          makeVerification({ id: 'v1', level: 3, normalizedCredibilityAtCreation: 1.0 }),
          makeVerification({ id: 'v2', level: 3, normalizedCredibilityAtCreation: 1.0 }),
        ]}
      />
    );
    expect(screen.getByText('Full ×2')).toBeInTheDocument();
    expect(screen.getByText('+1900')).toBeInTheDocument();
  });
});
