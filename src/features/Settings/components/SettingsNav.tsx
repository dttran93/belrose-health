// src/features/Settings/components/SettingsNav.tsx

import {
  Bell,
  CircleUserRound,
  CreditCard,
  GlobeLock,
  HeartHandshake,
  Key,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react';

const settingsSections = [
  { id: 'general', name: 'General', icon: CircleUserRound },
  { id: 'account', name: 'Account', icon: Key },
  { id: 'trustees', name: 'Trustees', icon: HeartHandshake },
  { id: 'dependents', name: 'Dependents', icon: Users },
  { id: 'guest-invites', name: 'Guest Invites', icon: UserRound },
  { id: 'vouches', name: 'Vouches', icon: UserCheck },
  { id: 'credibility', name: 'Credibility', icon: ShieldCheck },
  { id: 'notifications', name: 'Notifications', icon: Bell },
  { id: 'privacy', name: 'Privacy & Security', icon: GlobeLock },
  { id: 'billing', name: 'Billing & Plans', icon: CreditCard },
];

interface SettingsNavProps {
  activeSection: string;
  onSectionChange: (id: string) => void;
}

const SettingsNav = ({ activeSection, onSectionChange }: SettingsNavProps) => {
  return (
    <>
      {/* Sidebar — desktop */}
      <div className="hidden md:block w-44 flex-shrink-0 pr-2 sticky top-8 self-start">
        <nav className="flex flex-col gap-0.5">
          {settingsSections.map(section => (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={`w-full flex items-center px-2 py-1 text-sm text-left rounded-lg mb-1 transition-colors ${
                activeSection === section.id
                  ? 'bg-complement-1/10 text-primary'
                  : 'text-foreground hover:bg-complement-1/5'
              }`}
            >
              <section.icon className="mr-3 w-4 h-4" />
              <span>{section.name}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Vertical divider — desktop */}
      <div className="hidden md:block w-px bg-gray-200 mx-1 self-stretch" />

      {/* Horizontal tabs — mobile */}
      <div className="flex md:hidden overflow-x-auto gap-1 pb-4 mb-4 border-b border-gray-200 scrollbar-hide w-full">
        {settingsSections.map(section => (
          <button
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              activeSection === section.id
                ? 'bg-gray-100 text-gray-900 font-medium'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {section.name}
          </button>
        ))}
      </div>
    </>
  );
};

export { settingsSections };
export default SettingsNav;
