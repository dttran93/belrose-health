// src/features/BackendChainParity/components/ui/IntegrityTable.tsx

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface IntegrityTableColumn<T> {
  header: string;
  /** Defaults to left-aligned header styling. */
  headerClassName?: string;
  /** Defaults to `px-4 py-3`. */
  cellClassName?: string;
  cell: (item: T) => React.ReactNode;
}

interface IntegrityTableProps<T> {
  items: T[];
  rowKey: (item: T) => string;
  columns: IntegrityTableColumn<T>[];
  /** Omit to render a plain (non-expandable) table with no chevron column. */
  renderDetail?: (item: T) => React.ReactNode;
  emptyMessage: string;
  searchQuery?: string;
  onClearSearch?: () => void;
}

/**
 * Shared shell for every *IntegrityTable in this feature — sticky-header scroll container,
 * expand-button column + multi-row expand state, empty-state, and colSpan math for the
 * detail row. Each table supplies its own column cells and (optional) expanded-row content;
 * this only owns the structural/behavioral parts that were previously copy-pasted per table.
 */
export function IntegrityTable<T>({
  items,
  rowKey,
  columns,
  renderDetail,
  emptyMessage,
  searchQuery,
  onClearSearch,
}: IntegrityTableProps<T>) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>{emptyMessage}</p>
        {searchQuery && onClearSearch && (
          <button
            onClick={onClearSearch}
            className="mt-2 text-sm text-blue-500 hover:text-blue-700"
          >
            Clear search
          </button>
        )}
      </div>
    );
  }

  const totalCols = columns.length + (renderDetail ? 1 : 0);

  return (
    <div className="overflow-auto rounded-xl border border-gray-200 max-h-[80vh]">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            {renderDetail && <th className="px-2 py-3 w-6" />}
            {columns.map((col, i) => (
              <th
                key={i}
                className={col.headerClassName ?? 'px-4 py-3 text-left font-medium text-gray-600'}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-left">
          {items.map(item => {
            const key = rowKey(item);
            const isExpanded = expandedRows.has(key);
            return (
              <React.Fragment key={key}>
                <tr className="hover:bg-gray-50">
                  {renderDetail && (
                    <td className="px-2 py-3">
                      <button
                        onClick={() => toggleRow(key)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  )}
                  {columns.map((col, i) => (
                    <td key={i} className={col.cellClassName ?? 'px-4 py-3'}>
                      {col.cell(item)}
                    </td>
                  ))}
                </tr>
                {renderDetail && isExpanded && (
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <td />
                    <td colSpan={totalCols - 1} className="px-6 py-4">
                      {renderDetail(item)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
