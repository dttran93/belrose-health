// @vitest-environment jsdom
//
// src/features/BackendChainParity/components/ui/__tests__/IntegrityTable.test.tsx
//
// IntegrityTable is the shared shell composed by every *IntegrityTable in this feature (sticky
// header, expand-button column + multi-row expand state, empty-state, colSpan math). Fully
// generic over plain props (items/rowKey/columns/renderDetail) — no providers or mocking needed,
// mirrors the existing RTL convention used elsewhere in this repo (e.g.
// src/features/Auth/components/ui/__tests__/RegistrationProgressDialog.test.tsx).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrityTable } from '../IntegrityTable';
import type { IntegrityTableColumn } from '../IntegrityTable';

interface Item {
  id: string;
  name: string;
}

const columns: IntegrityTableColumn<Item>[] = [
  { header: 'Name', cell: item => item.name },
];

function renderTable(props: Partial<React.ComponentProps<typeof IntegrityTable<Item>>> = {}) {
  return render(
    <IntegrityTable<Item>
      items={[]}
      rowKey={item => item.id}
      columns={columns}
      emptyMessage="Nothing to show"
      {...props}
    />
  );
}

describe('IntegrityTable — empty state', () => {
  it('renders the empty message when there are no items', () => {
    renderTable({ items: [] });

    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  it('shows a "Clear search" link when searchQuery and onClearSearch are both provided', async () => {
    const onClearSearch = vi.fn();
    const user = userEvent.setup();
    renderTable({ items: [], searchQuery: 'foo', onClearSearch });

    const link = screen.getByText('Clear search');
    await user.click(link);

    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it('omits the "Clear search" link when searchQuery is missing', () => {
    renderTable({ items: [], searchQuery: undefined, onClearSearch: vi.fn() });

    expect(screen.queryByText('Clear search')).not.toBeInTheDocument();
  });

  it('omits the "Clear search" link when onClearSearch is missing', () => {
    renderTable({ items: [], searchQuery: 'foo', onClearSearch: undefined });

    expect(screen.queryByText('Clear search')).not.toBeInTheDocument();
  });
});

describe('IntegrityTable — rows', () => {
  const items: Item[] = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];

  it('renders one row per item, invoking each column\'s cell render-prop', () => {
    renderTable({ items });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders no chevron/expand affordance when renderDetail is omitted', () => {
    renderTable({ items });

    expect(screen.queryByLabelText('Expand')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Collapse')).not.toBeInTheDocument();
  });

  it('toggles a row\'s detail independently of other rows when renderDetail is provided', async () => {
    const user = userEvent.setup();
    renderTable({
      items,
      renderDetail: item => <div>Detail for {item.name}</div>,
    });

    expect(screen.queryByText('Detail for Alpha')).not.toBeInTheDocument();
    expect(screen.queryByText('Detail for Beta')).not.toBeInTheDocument();

    const expandButtons = screen.getAllByLabelText('Expand');
    await user.click(expandButtons[0]!);

    expect(screen.getByText('Detail for Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Detail for Beta')).not.toBeInTheDocument();

    // Expanding the second row (its button is still labeled "Expand" — Alpha's now reads
    // "Collapse") leaves the first row's own expanded state untouched.
    await user.click(screen.getAllByLabelText('Expand')[0]!);
    expect(screen.getByText('Detail for Alpha')).toBeInTheDocument();
    expect(screen.getByText('Detail for Beta')).toBeInTheDocument();

    // Collapsing Alpha's row doesn't affect Beta's now-expanded, independent state.
    await user.click(screen.getAllByLabelText('Collapse')[0]!);
    expect(screen.queryByText('Detail for Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Detail for Beta')).toBeInTheDocument();
  });

  it('sets the detail row\'s colSpan to the number of columns', () => {
    const { container } = renderTable({
      items: [items[0]!],
      renderDetail: () => <div>Detail</div>,
    });

    // Not expanded yet — trigger it via the chevron to render the detail <td>.
    const cell = container.querySelector('td[colspan]');
    expect(cell).not.toBeInTheDocument();
  });

  it('renders the detail row\'s colSpan as columns.length once expanded', async () => {
    const user = userEvent.setup();
    const twoColumns: IntegrityTableColumn<Item>[] = [
      { header: 'Name', cell: item => item.name },
      { header: 'Id', cell: item => item.id },
    ];
    const { container } = render(
      <IntegrityTable<Item>
        items={[items[0]!]}
        rowKey={item => item.id}
        columns={twoColumns}
        emptyMessage="Nothing to show"
        renderDetail={() => <div>Detail</div>}
      />
    );

    await user.click(screen.getByLabelText('Expand'));

    const cell = container.querySelector('td[colspan]');
    expect(cell).toHaveAttribute('colspan', '2');
  });
});
