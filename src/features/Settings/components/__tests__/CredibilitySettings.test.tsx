// @vitest-environment jsdom
//
// src/features/Settings/components/__tests__/CredibilitySettings.test.tsx
//
// Mocks the two data sources at the service layer (getUserCredibility, getActiveVouchesReceived)
// and lets the real useUserCredibility react-query hook run against a real QueryClient — the
// hook is a thin, one-call wrapper, so mocking the service is more representative than mocking
// the hook itself, and this is a straightforward place to establish that pattern for the first
// react-query-backed component test in this codebase.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserCredibilityScore, VouchDoc } from '@belrose/shared';

const { getUserCredibilityMock, getActiveVouchesReceivedMock, navigateMock, currentUserRef } =
  vi.hoisted(() => ({
    getUserCredibilityMock: vi.fn(),
    getActiveVouchesReceivedMock: vi.fn(),
    navigateMock: vi.fn(),
    currentUserRef: { current: { uid: 'user-1' } as { uid: string } | null },
  }));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ get currentUser() { return currentUserRef.current; } })),
}));

vi.mock('@/features/CredibilityUser/services/userCredibilityService', () => ({
  getUserCredibility: getUserCredibilityMock,
}));

vi.mock('@/features/CredibilityUser/services/vouchService', () => ({
  getActiveVouchesReceived: getActiveVouchesReceivedMock,
}));

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

import CredibilitySettings from '../CredibilitySettings';

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

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CredibilitySettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserRef.current = { uid: 'user-1' };
});

describe('CredibilitySettings', () => {
  it('renders nothing when no user is authenticated', () => {
    currentUserRef.current = null;
    const { container } = renderWithProviders();
    expect(container.firstChild).toBeNull();
  });

  it('renders the gauge score and a vouch count once both queries resolve', async () => {
    getUserCredibilityMock.mockResolvedValue(makeCredibility());
    getActiveVouchesReceivedMock.mockResolvedValue(
      Array.from({ length: 3 }) as unknown as VouchDoc[]
    );

    renderWithProviders();

    // Both the gauge (hero) and the breakdown (detail) show the score — expect it twice, not once.
    expect(await screen.findAllByText('712')).toHaveLength(2);
    expect(await screen.findByText('3 people vouch for you')).toBeInTheDocument();
  });

  it('says "person vouches" (singular) for exactly one vouch', async () => {
    getUserCredibilityMock.mockResolvedValue(makeCredibility());
    getActiveVouchesReceivedMock.mockResolvedValue([{}] as unknown as VouchDoc[]);

    renderWithProviders();

    expect(await screen.findByText('1 person vouches for you')).toBeInTheDocument();
  });

  it('shows a distinct empty-state message when no one has vouched yet', async () => {
    getUserCredibilityMock.mockResolvedValue(makeCredibility());
    getActiveVouchesReceivedMock.mockResolvedValue([]);

    renderWithProviders();

    expect(await screen.findByText('No one has vouched for you yet')).toBeInTheDocument();
  });

  it('navigates to Vouches settings when "Manage vouches" is clicked', async () => {
    getUserCredibilityMock.mockResolvedValue(makeCredibility());
    getActiveVouchesReceivedMock.mockResolvedValue([]);

    renderWithProviders();

    const manageButton = await screen.findByText('Manage vouches');
    await userEvent.click(manageButton);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/app/settings/vouches'));
  });

  it('renders the breakdown detail rows once credibility resolves', async () => {
    getUserCredibilityMock.mockResolvedValue(makeCredibility());
    getActiveVouchesReceivedMock.mockResolvedValue([]);

    renderWithProviders();

    expect(await screen.findByText('Average record credibility')).toBeInTheDocument();
  });
});
