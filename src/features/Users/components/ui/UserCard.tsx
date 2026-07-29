// src/features/Users/components/ui/UserCard.tsx

import React from 'react';
import { Mail, Hash, X, Check, CircleCheck } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import UserMenu, { MenuItem } from './UserMenu';
import { BelroseUserProfile } from '@/types/core';
import { copyToClipboard } from '@/utils/browserUtils';
import Avatar from '../Avatar';

export type UserCardVariant = 'compact' | 'default';
export type UserCardColor = 'primary' | 'green' | 'red' | 'blue' | 'purple' | 'yellow';

interface UserCardProps {
  user: BelroseUserProfile | null | undefined;
  userId?: string;
  variant?: UserCardVariant;
  color?: UserCardColor;
  metadata?: { label: string; value: string; icon?: React.ReactNode }[];
  onCardClick?: () => void;
  onViewUser?: () => void;
  onViewDetails?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  onAccept?: () => void;
  onVerifyBlockchain?: () => void;
  menuType?: 'default' | 'cancel' | 'acceptOrCancel' | 'none';
  showEmail?: boolean;
  showUserId?: boolean;
  showAffiliations?: boolean;
  clickable?: boolean;
  className?: string;
  content?: React.ReactNode; // Primary slot for UserBadge or custom status
  additionalItems?: MenuItem[];
}

const colorClasses: Record<
  UserCardColor,
  { bg: string; iconBg: string; icon: string; border: string }
> = {
  primary: {
    bg: 'bg-primary/20',
    iconBg: 'bg-primary/50',
    icon: 'text-primary',
    border: 'border-primary',
  },
  green: {
    bg: 'bg-complement-3/20',
    iconBg: 'bg-complement-3/50',
    icon: 'text-complement-3',
    border: 'border-complement-3',
  },
  red: { bg: 'bg-red-100', iconBg: 'bg-red-200', icon: 'text-red-700', border: 'border-red-200' },
  blue: {
    bg: 'bg-complement-2/20',
    iconBg: 'bg-complement-2/50',
    icon: 'text-complement-2',
    border: 'border-complement-2',
  },
  purple: {
    bg: 'bg-complement-5/20',
    iconBg: 'bg-complement-5/50',
    icon: 'text-complement-5',
    border: 'border-complement-5',
  },
  yellow: {
    bg: 'bg-complement-4/20',
    iconBg: 'bg-complement-4/50',
    icon: 'text-complement-4',
    border: 'border-complement-4',
  },
};

export const UserCard: React.FC<UserCardProps> = ({
  user,
  userId,
  variant = 'default',
  color = 'primary',
  metadata,
  onViewUser,
  onViewDetails,
  onShare,
  onDelete,
  onCardClick,
  onCancel,
  onAccept,
  onVerifyBlockchain,
  menuType = 'default',
  showEmail = true,
  showUserId = true,
  showAffiliations = true,
  clickable = false,
  className = '',
  content,
  additionalItems,
}) => {
  const colors = colorClasses[color];
  const displayName = user?.displayName || 'Unknown User';
  const email = user?.email || '';
  const uid = user?.uid || userId || '';
  const isClickable = clickable || !!onCardClick;

  const renderVerifiedBadge = () => {
    if (!user?.emailVerified || !user?.identityVerified) return null;
    return (
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div>
              <CircleCheck className="text-blue-500 w-4 h-4" />
            </div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="bg-gray-900 text-white text-xs rounded px-2 py-1 z-50">
              Verified identity & email
              <Tooltip.Arrow className="fill-gray-900" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  };

  const renderActionButtons = () => {
    if (menuType !== 'cancel' && menuType !== 'acceptOrCancel') return null;
    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          aria-label="Cancel"
          onClick={e => {
            e.stopPropagation();
            onCancel?.();
          }}
          className="p-2 bg-red-200 rounded-full hover:bg-red-300"
        >
          <X className="text-red-700 w-4 h-4" />
        </button>
        {menuType === 'acceptOrCancel' && (
          <button
            aria-label="Accept"
            onClick={e => {
              e.stopPropagation();
              onAccept?.();
            }}
            className="p-2 bg-green-200 rounded-full hover:bg-green-400"
          >
            <Check className="text-green-900 w-4 h-4" />
          </button>
        )}
      </div>
    );
  };

  const menuSlot = (
    <div className="flex items-center gap-1 flex-shrink-0">
      {content && <div onClick={e => e.stopPropagation()}>{content}</div>}
      {menuType === 'default' && (
        <UserMenu
          user={user}
          onViewUser={onViewUser}
          onViewDetails={onViewDetails}
          onShare={onShare}
          onDelete={onDelete}
          onVerifyBlockchain={onVerifyBlockchain}
          additionalItems={additionalItems}
        />
      )}
      {renderActionButtons()}
    </div>
  );

  // ─── Detail rows shared between layouts ───────────────────────────────────
  const detailRows =
    variant === 'default' ? (
      <>
        {showEmail && email && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="whitespace-nowrap">{email}</span>
          </div>
        )}
        {showUserId && uid && (
          <div
            onClick={e => {
              e.stopPropagation();
              copyToClipboard(uid);
            }}
            className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer hover:text-gray-600"
          >
            <Hash className="w-3 h-3 flex-shrink-0" />
            <span className="whitespace-nowrap font-mono">{uid}</span>
          </div>
        )}
        {showAffiliations && user?.affiliations && user.affiliations.length > 0 && (
          <p className="text-xs text-gray-500 whitespace-nowrap">{user.affiliations.join(', ')}</p>
        )}
      </>
    ) : null;

  return (
    <div
      onClick={onCardClick}
      data-testid={uid ? `user-card-${uid}` : undefined}
      className={`p-4 ${colors.bg} rounded-lg border ${colors.border}
      ${isClickable ? 'cursor-pointer hover:opacity-80' : ''} ${className}`}
    >
      {/* ── MOBILE layout (hidden on sm+) ── */}
      <div className="flex flex-col gap-1 sm:hidden">
        {/* Top row: name + menu — always visible, never truncated */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-gray-900 truncate">{displayName}</span>
            {renderVerifiedBadge()}
          </div>
          {menuSlot}
        </div>

        {/* Scrollable detail strip */}
        {detailRows && (
          <div className="flex items-center gap-3 overflow-x-auto pb-0.5 scrollbar-hide">
            {detailRows}
          </div>
        )}
      </div>

      {/* ── DESKTOP layout (hidden on mobile, shown on sm+) ── */}
      <div className="hidden sm:flex sm:items-center sm:justify-between">
        <div className="flex items-center flex-1 min-w-0">
          {variant === 'default' && (
            <Avatar
              profile={user ?? null}
              size="md"
              className="mr-3"
              bgClassName={`${colors.iconBg} ${colors.icon}`}
            />
          )}
          <div className="flex-1 min-w-0 mr-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 truncate">{displayName}</span>
              {renderVerifiedBadge()}
            </div>
            {variant === 'default' && (
              <div className="mt-0.5 space-y-0.5">
                {showEmail && email && (
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Mail className="w-3 h-3" />
                    <span className="truncate">{email}</span>
                  </div>
                )}
                {showUserId && uid && (
                  <div
                    onClick={e => {
                      e.stopPropagation();
                      copyToClipboard(uid);
                    }}
                    className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer hover:text-gray-600"
                  >
                    <Hash className="w-3 h-3" />
                    <span className="truncate font-mono">{uid}</span>
                  </div>
                )}
                {showAffiliations && user?.affiliations && user.affiliations.length > 0 && (
                  <p className="text-xs text-gray-500 truncate">{user.affiliations.join(', ')}</p>
                )}
              </div>
            )}
          </div>
        </div>
        {menuSlot}
      </div>
    </div>
  );
};

export default UserCard;
