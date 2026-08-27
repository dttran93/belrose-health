// @vitest-environment jsdom
//
// src/features/CredibilityUser/components/Vouches/__tests__/VouchActionDialog.test.tsx
//
// Tests what actually renders given a phase/operationType combination — complementary to
// useVouchFlow.test.tsx, which tests the state transitions that *produce* these props. Fully
// presentational — no services, nothing to vi.mock.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VouchActionDialog } from '../VouchActionDialog';

type Props = React.ComponentProps<typeof VouchActionDialog>;

function renderDialog(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onConfirmVouch = vi.fn();
  const onConfirmRetract = vi.fn();

  const defaults: Props = {
    isOpen: true,
    phase: 'confirming',
    operationType: 'vouch',
    targetDisplayName: 'Target User',
    onClose,
    onConfirmVouch,
    onConfirmRetract,
  };

  const { rerender } = render(<VouchActionDialog {...defaults} {...overrides} />);
  return { onClose, onConfirmVouch, onConfirmRetract, rerender };
}

describe('VouchActionDialog phase dispatch', () => {
  it('renders nothing when isOpen is false', () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows ErrorContent on phase "error", and Close calls onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog({ phase: 'error', error: 'Network unavailable' });

    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows preparing content', () => {
    renderDialog({ phase: 'preparing' });
    expect(screen.getByText('Preparing Secure Network')).toBeInTheDocument();
  });

  it('labels the submitted content by operationType — "Submitting vouch" vs "Retracting vouch"', () => {
    const { rerender } = renderDialog({ phase: 'submitted', operationType: 'vouch' });
    expect(screen.getByText('Submitting vouch')).toBeInTheDocument();

    rerender(
      <VouchActionDialog
        isOpen
        phase="submitted"
        operationType="retract"
        targetDisplayName="Target User"
        onClose={vi.fn()}
        onConfirmVouch={vi.fn()}
        onConfirmRetract={vi.fn()}
      />
    );
    expect(screen.getByText('Retracting vouch')).toBeInTheDocument();
  });
});

describe('ConfirmVouchContent', () => {
  it('shows the target display name, confirms via onConfirmVouch, cancels via onClose', async () => {
    const user = userEvent.setup();
    const { onConfirmVouch, onClose } = renderDialog({
      phase: 'confirming',
      operationType: 'vouch',
      targetDisplayName: 'Jane Doe',
    });

    expect(screen.getByText('Vouch for Jane Doe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm Vouch' }));
    expect(onConfirmVouch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmRetractContent', () => {
  it('shows the target display name and confirms via onConfirmRetract', async () => {
    const user = userEvent.setup();
    const { onConfirmRetract } = renderDialog({
      phase: 'confirming',
      operationType: 'retract',
      targetDisplayName: 'Jane Doe',
    });

    expect(screen.getByText('Retract Vouch for Jane Doe')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retract Vouch' }));
    expect(onConfirmRetract).toHaveBeenCalledTimes(1);
  });
});
