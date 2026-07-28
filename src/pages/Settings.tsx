import { useEffect, useState } from 'react';
import GeneralSettings from '@/features/Settings/components/GeneralSettings';
import { getAuth } from 'firebase/auth';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { UserService } from '@/features/Auth/services/userService';
import { BelroseUserProfile } from '@/types/core';
import { useUserSettings } from '@/features/Settings/hooks/useUserSettings';
import ChangeNameModal from '@/features/Settings/components/ChangeNameModal';
import ChangeEmailModal from '@/features/Settings/components/ChangeEmailModal';
import ChangePhotoModal from '@/features/Settings/components/ChangePhotoModal';
import TrusteePage from '@/features/Trustee/components/TrusteePage';
import DependentsSettingsPage from '@/features/Dependents/components/DependentsSettingsPage';
import SearchDiscoverabilityToggle from '@/features/Settings/components/SearchDiscoveryabilityToggle';
import SettingsNav from '@/features/Settings/components/SettingsNav';
import AccountSettings from '@/features/Settings/components/AccountSettings';
import ChangePasswordModal from '@/features/Settings/components/ChangePasswordModal';
import NotificationSettings from '@/features/Settings/components/NotificationSettings';
import GuestInvitesSettings from '@/features/Settings/components/GuestInvitesSettings';
import VouchesSettings from '@/features/Settings/components/VouchesSettings';
import { GuestFeatureGate } from '@/features/GuestAccess/components/GuestFeatureGate';

const SettingsPage = () => {
  const auth = getAuth();
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState<BelroseUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-open the delete-account dialog when landing here via ?action=delete-account
  // (used by the guardian "switch into dependent, then delete" flow).
  const [isDeleteAccountDialogOpen, setIsDeleteAccountDialogOpen] = useState(
    searchParams.get('action') === 'delete-account'
  );

  const handleDeleteAccountDialogChange = (open: boolean) => {
    setIsDeleteAccountDialogOpen(open);
    if (!open && searchParams.has('action')) {
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  };

  //Active Section for deriving URL - e.g. /app/settings/trustees --> trustees page
  const activeSection = location.pathname.split('/').pop() || 'general';

  //Modal states
  const [isChangeNameModalOpen, setIsChangeNameModalOpen] = useState(false);
  const [isChangeEmailModalOpen, setIsChangeEmailModalOpen] = useState(false);
  const [isChangePhotoModalOpen, setIsChangePhotoModalOpen] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

  //User settings hook
  const {
    isUpdatingName,
    isUpdatingEmail,
    isUpdatingPhoto,
    isUpdatingPassword,
    updateName,
    updateEmail,
    updatePhoto,
    updatePassword,
    refreshUserProfile,
  } = useUserSettings({
    onSuccess: async () => {
      //Refresh user profile after successful update
      const updated = await refreshUserProfile();
      if (updated) {
        setUserProfile(updated);
      }
    },
  });

  // If no user is logged in, redirect to auth
  useEffect(() => {
    if (!auth.currentUser) {
      navigate('/auth');
    }
  }, [auth.currentUser, navigate]);

  // Fetch user profile and blockchain member data
  useEffect(() => {
    const fetchUserData = async () => {
      if (!auth.currentUser) return;

      setIsLoading(true);
      try {
        // Fetch user profile from Firestore
        const profile = await UserService.getUserProfile(auth.currentUser.uid);
        setUserProfile(profile);
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [auth.currentUser]);

  useEffect(() => {
    if (activeSection === 'settings' || activeSection === '') {
      navigate('/app/settings/general', { replace: true });
    }
  }, [activeSection]);

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        if (isLoading) {
          return (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          );
        }

        if (!userProfile) {
          return (
            <div className="bg-white rounded-lg border p-8 text-center">
              <p className="text-gray-600">Unable to load profile data</p>
            </div>
          );
        }

        return (
          <GeneralSettings
            user={userProfile}
            onChangeName={() => setIsChangeNameModalOpen(true)}
            onChangeEmail={() => setIsChangeEmailModalOpen(true)}
            onChangePhoto={() => setIsChangePhotoModalOpen(true)}
            onStartVerification={() => {
              navigate('/verification');
            }}
          />
        );

      case 'account':
        if (!userProfile) {
          return (
            <div className="bg-white rounded-lg border p-8 text-center">
              <p className="text-gray-600">Unable to load profile data</p>
            </div>
          );
        }
        return (
          <AccountSettings
            user={userProfile}
            onChangeEmail={() => setIsChangeEmailModalOpen(true)}
            onChangePassword={() => setIsChangePasswordModalOpen(true)}
            deleteAccountDialogOpen={isDeleteAccountDialogOpen}
            onDeleteAccountDialogOpenChange={handleDeleteAccountDialogChange}
          />
        );

      case 'trustees':
        return <TrusteePage />;

      case 'dependents':
        return <DependentsSettingsPage />;

      case 'guest-invites':
        return <GuestInvitesSettings />;

      case 'notifications':
        return <NotificationSettings />;

      case 'vouches':
        return <VouchesSettings />;

      case 'privacy':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Privacy & Security</h2>
              <div className="bg-white rounded-lg border p-6 space-y-6">
                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Discoverability</h3>
                  <div className="space-y-3">
                    <label className="flex items-center">
                      <SearchDiscoverabilityToggle
                        currentValue={userProfile?.searchDiscoverable ?? false}
                        onUpdate={val =>
                          setUserProfile(prev =>
                            prev ? { ...prev, searchDiscoverable: val } : prev
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <div className="bg-white rounded-lg border p-8 text-center">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Coming Soon</h3>
            <p className="text-gray-600">This section is under development</p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <header className="flex w-full mx-auto md:h-24 md:items-end">
          <h1 className="flex items-center gap-2 text-center max-md:hidden min-w-0 font-semibold text-xl py-3">
            <span>Settings</span>
          </h1>
        </header>
        <GuestFeatureGate
          featureName="access account settings"
          featureDescription="Settings — name, email, trustees, dependents, vouches, and more — are available once you create a free account."
        >
          <div className="flex flex-col md:flex-row gap-0 items-start">
            <SettingsNav
              activeSection={activeSection}
              onSectionChange={id => navigate(`/app/settings/${id}`)}
            />
            {/* Content */}
            <div className="flex-1 min-w-0 md:pl-6">{renderContent()}</div>
          </div>
        </GuestFeatureGate>
      </div>

      {/* Modals */}
      {userProfile && (
        <>
          <ChangeNameModal
            isOpen={isChangeNameModalOpen}
            onClose={() => setIsChangeNameModalOpen(false)}
            onSubmit={updateName}
            isLoading={isUpdatingName}
            currentFirstName={userProfile.firstName || ''}
            currentLastName={userProfile.lastName || ''}
          />
          <ChangeEmailModal
            isOpen={isChangeEmailModalOpen}
            onClose={() => setIsChangeEmailModalOpen(false)}
            onSubmit={updateEmail}
            isLoading={isUpdatingEmail}
            currentEmail={userProfile.email || ''}
          />
          <ChangePhotoModal
            isOpen={isChangePhotoModalOpen}
            onClose={() => setIsChangePhotoModalOpen(false)}
            onSubmit={updatePhoto}
            isLoading={isUpdatingPhoto}
            currentPhotoURL={userProfile.photoURL || null}
            userInitials={`${userProfile.firstName?.[0] || ''}${userProfile.lastName?.[0] || ''}`.toUpperCase()}
          />
          <ChangePasswordModal
            isOpen={isChangePasswordModalOpen}
            onClose={() => setIsChangePasswordModalOpen(false)}
            onSubmit={updatePassword}
            isLoading={isUpdatingPassword}
          />
        </>
      )}
    </div>
  );
};

export default SettingsPage;
