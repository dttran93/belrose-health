import { Button } from '../ui/Button';

// Both trigger the claim modal via onOpenClaim rather than owning it — the modal used to be
// rendered here, nested inside {isGuest && <GuestBanner />} in Layout.tsx. That meant the
// instant a claim succeeded and isGuest flipped to false, GuestBanner (and the modal inside it)
// unmounted immediately, cutting the user off before GuestClaimAccountModal's own "Welcome to
// Belrose!" success step ever got to render. Lifting the modal up to Layout.tsx — outside the
// isGuest-gated block — keeps it mounted through its own isOpen/onClose lifecycle regardless of
// what isGuest does mid-flow.

interface GuestBannerProps {
  onOpenClaim: () => void;
}

export const GuestBanner: React.FC<GuestBannerProps> = ({ onOpenClaim }) => {
  return (
    <div className="bg-amber-100 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-amber-900 text-sm font-medium">
          You're viewing as a temporary guest. Create a free account in moments to manage health
          records.
        </span>
      </div>
      <Button onClick={onOpenClaim}>Create Account</Button>
    </div>
  );
};

export const GuestFooter: React.FC<GuestBannerProps> = ({ onOpenClaim }) => {
  const features = [
    {
      icon: '🤖',
      title: 'AI Health Assistant',
      description:
        'Chat with your records in context — ask questions, get summaries, spot patterns.',
    },
    {
      icon: '🔐',
      title: 'End-to-End Encrypted',
      description: 'Your records are encrypted on your device. Even we cannot read them.',
    },
    {
      icon: '✅',
      title: 'Credible Records',
      description:
        'Every record gets a cryptographic fingerprint — tamper-proof and independently verifiable.',
    },
    {
      icon: '🔗',
      title: 'Share With Anyone',
      description: 'Share records securely with doctors, family, or other third parties at will.',
    },
    {
      icon: '🗂️',
      title: 'Complete Health History',
      description:
        'Collect records from any provider and standardise them into one comprehensive, verified profile.',
    },
  ];

  return (
    <div className="bg-amber-100 px-6 py-4">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4">
        {/* Left Spacer (Hidden on mobile, takes 1fr on desktop) */}
        <div className="hidden md:block" />

        {/* Center Content */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-3">
            <p className="text-amber-900 font-bold text-sm">
              ⚠️ Guest access is temporary. Own your health data permanently and unlock the
              features below.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2">
            {features.map(feature => (
              <div
                key={feature.title}
                className="group relative flex items-center gap-2 bg-white border border-amber-200
                           rounded-lg px-1 py-0.5 cursor-default hover:border-amber-400
                           hover:shadow-sm transition-all"
              >
                <span className="text-base">{feature.icon}</span>
                <span className="text-xs font-semibold text-amber-900">{feature.title}</span>

                {/* Tooltip */}
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-amber-900 text-amber-50
                              text-xs rounded-lg px-3 py-1 shadow-lg opacity-0 group-hover:opacity-100
                              transition-opacity pointer-events-none z-50 text-center"
                >
                  {feature.description}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-amber-900" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Aligned Button */}
        <div className="flex justify-center md:justify-end">
          <Button onClick={onOpenClaim} className="whitespace-nowrap">
            Get Started Free →
          </Button>
        </div>
      </div>
    </div>
  );
};
