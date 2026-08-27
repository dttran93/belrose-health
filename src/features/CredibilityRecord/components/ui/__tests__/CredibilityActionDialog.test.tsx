// @vitest-environment jsdom
//
// src/features/CredibilityRecord/components/ui/__tests__/CredibilityActionDialog.test.tsx
//
// Tests what actually renders given a phase/operationType/pending* combination — complementary
// to useCredibilityFlow.test.tsx, which tests the state transitions that *produce* these props
// in the first place. Fully presentational (getVerificationConfig/getSeverityConfig/
// getCulpabilityConfig are the real, pure lookup functions — no Firestore/blockchain call is
// ever reachable just by rendering this component) — so nothing needs vi.mock, matching
// Permissions/components/ui/__tests__/PermissionActionDialog.test.tsx's approach.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredibilityActionDialog } from '../CredibilityActionDialog';

type Props = React.ComponentProps<typeof CredibilityActionDialog>;

function renderDialog(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onConfirmVerification = vi.fn();
  const onConfirmModifyVerification = vi.fn();
  const onConfirmRetract = vi.fn();
  const onConfirmDispute = vi.fn();
  const onConfirmModifyDispute = vi.fn();

  const defaults: Props = {
    isOpen: true,
    phase: 'confirming',
    operationType: 'verify',
    onClose,
    onConfirmVerification,
    onConfirmModifyVerification,
    onConfirmRetract,
    onConfirmDispute,
    onConfirmModifyDispute,
    submittedLabel: '',
  };

  render(<CredibilityActionDialog {...defaults} {...overrides} />);
  return {
    onClose,
    onConfirmVerification,
    onConfirmModifyVerification,
    onConfirmRetract,
    onConfirmDispute,
    onConfirmModifyDispute,
  };
}

describe('CredibilityActionDialog phase dispatch', () => {
  it('renders nothing when isOpen is false', () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows ErrorContent on phase "error", and Close calls onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ phase: 'error', error: 'Chain reverted' });

    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    expect(screen.getByText('Chain reverted')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the submitted content with the given label', () => {
    renderDialog({ phase: 'submitted', submittedLabel: 'Submitting verification' });
    expect(screen.getByText('Submitting verification')).toBeInTheDocument();
  });

  it('shows preparing content with the credibility-specific 5th step', () => {
    renderDialog({ phase: 'preparing' });
    expect(screen.getByText('Preparing Secure Network')).toBeInTheDocument();
    // 'ensuring_hash' is the step unique to Credibility (Permissions/Subject only use 4 steps).
    expect(screen.getByText('Verifying record fingerprint')).toBeInTheDocument();
  });
});

describe('ConfirmVerificationContent', () => {
  it('shows the level and confirms with it for a new verification', async () => {
    const user = userEvent.setup();
    const { onConfirmVerification } = renderDialog({
      phase: 'confirming',
      operationType: 'verify',
      pendingLevel: 3,
    });

    expect(screen.getByText('Confirm Verification')).toBeInTheDocument();
    expect(screen.getByText('Full Level')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit Verification' }));
    expect(onConfirmVerification).toHaveBeenCalledWith(3);
  });

  it('shows "Modify Verification" and confirms via onConfirmModifyVerification for modifyVerification', async () => {
    const user = userEvent.setup();
    const { onConfirmModifyVerification } = renderDialog({
      phase: 'confirming',
      operationType: 'modifyVerification',
      pendingLevel: 2,
    });

    expect(screen.getByText('Modify Verification')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm Modification' }));
    expect(onConfirmModifyVerification).toHaveBeenCalledWith(2);
  });

  it('disables the confirm button when no level is pending', () => {
    renderDialog({ phase: 'confirming', operationType: 'verify', pendingLevel: undefined });
    expect(screen.getByRole('button', { name: 'Submit Verification' })).toBeDisabled();
  });
});

describe('ConfirmRetractContent — reused for both verification and dispute', () => {
  it('shows the verification-specific copy for retractVerification and confirms', async () => {
    const user = userEvent.setup();
    const { onConfirmRetract } = renderDialog({
      phase: 'confirming',
      operationType: 'retractVerification',
    });

    // Title and confirm button share the same text — disambiguate by role.
    expect(screen.getByRole('heading', { name: 'Retract Verification' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retract Verification' }));
    expect(onConfirmRetract).toHaveBeenCalledTimes(1);
  });

  it('shows the dispute-specific copy for retractDispute', () => {
    renderDialog({ phase: 'confirming', operationType: 'retractDispute' });
    expect(screen.getByRole('heading', { name: 'Retract Dispute' })).toBeInTheDocument();
  });
});

describe('ConfirmDisputeContent', () => {
  it('shows severity/culpability/notes and confirms via onConfirmDispute for a new dispute', async () => {
    const user = userEvent.setup();
    const { onConfirmDispute } = renderDialog({
      phase: 'confirming',
      operationType: 'dispute',
      pendingSeverity: 3,
      pendingCulpability: 5,
      pendingNotes: 'The dosage is wrong.',
    });

    expect(screen.getByText('Confirm Dispute')).toBeInTheDocument();
    expect(screen.getByText('Major')).toBeInTheDocument();
    expect(screen.getByText('Intentional')).toBeInTheDocument();
    expect(screen.getByText('The dosage is wrong.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'File Dispute' }));
    expect(onConfirmDispute).toHaveBeenCalledTimes(1);
  });

  it('shows "Confirm Dispute Modification" and confirms via onConfirmModifyDispute for modifyDispute', async () => {
    const user = userEvent.setup();
    const { onConfirmModifyDispute } = renderDialog({
      phase: 'confirming',
      operationType: 'modifyDispute',
      pendingSeverity: 1,
      pendingCulpability: 0,
    });

    expect(screen.getByText('Confirm Dispute Modification')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Modify Dispute' }));
    expect(onConfirmModifyDispute).toHaveBeenCalledTimes(1);
  });

  it('does not render at all when pendingSeverity/pendingCulpability are undefined', () => {
    renderDialog({ phase: 'confirming', operationType: 'dispute' });
    expect(screen.queryByText('Confirm Dispute')).not.toBeInTheDocument();
  });
});
