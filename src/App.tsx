import React from 'react';
import { Toaster as Sonner } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import NotFound from './pages/NotFound';
import Auth from './pages/Auth';
import Layout from './components/app/Layout';
import AllRecords from './pages/AllRecords';
import ProtectedRoute from './features/Auth/ProtectedRoute';
import AddRecord from './pages/AddRecord';
import './App.css';
import { AuthProvider } from './features/Auth/AuthContext';
import { LayoutProvider } from './components/app/LayoutProvider';
import SettingsPage from './pages/Settings';
import { EncryptionGate } from './features/Encryption/components/EncryptionGate';
import VerificationHub from './pages/VerificationHub';
import EmailVerifiedPage from './pages/EmailVerified';
import BlockchainAdminDashboard from './pages/BlockchainAdminDashboard';
import HashTester from './pages/HashTester';
import Index from './pages';
import { CitationProvider } from './components/site/Citations/CitationContext';
import { AIChatProvider } from './features/Ai/components/AIChatContext';
import ChatHistoryPage from './features/Ai/components/ChatHistoryPage';
import HealthProfile from './pages/HealthProfile';
import RecordDetail from './pages/RecordDetail';
import GuestInvitePage from './pages/GuestInvitePage';
import Messaging from './pages/Messaging';
import PrivacyPolicy from './pages/PrivacyPolicy';
import { RequiresPlatformAdmin } from './features/Users/components/RequirePlatformAdmin';
import FulfillRequestPage from './pages/FulfillRequestPage';
import RecordRequestsPage from './pages/RecordRequestsPage';
import ForProviders from './pages/ForProviders';
import ActivityHub from './pages/ActivityHub';
import { OnChainActivityTrayProvider } from './features/OnChainActivityTray/OnChainActivityTrayContext';
import OnChainActivityTray from './features/OnChainActivityTray/components/OnChainActivityTray';
import AIPortal from './pages/AIPortal';
import HomeDashboard from './pages/HomeDashboard';
import CreateDependentPage from './features/Dependents/components/CreateDependentPage';
import ClaimAccountPage from './features/Dependents/components/ClaimAccountPage';
import AccountSetupPage from './features/Dependents/components/AccountSetupPage';
import RouteErrorBoundary from './components/app/RouteErrorBoundary';

const queryClient = new QueryClient();

// ── Root wrapper — provides all global context, renders matched route via Outlet ──
// Replaces the provider nesting that previously wrapped <BrowserRouter>.
// Every route in the tree is a descendant of this component.
const RootLayout: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <OnChainActivityTrayProvider>
        <TooltipProvider>
          <Sonner />
          <CitationProvider>
            <Outlet />
          </CitationProvider>
        </TooltipProvider>
      </OnChainActivityTrayProvider>
    </AuthProvider>
  </QueryClientProvider>
);

// ── Protected app shell — auth gate + encryption gate + layout providers ──
// Replaces the inline nesting inside the old /app/* Route element.
// <Layout /> now renders <Outlet /> instead of {children}.
const ProtectedLayout: React.FC = () => (
  <ProtectedRoute>
    <EncryptionGate>
      <AIChatProvider>
        <LayoutProvider>
          <Layout />
          <OnChainActivityTray />
        </LayoutProvider>
      </AIChatProvider>
    </EncryptionGate>
  </ProtectedRoute>
);

// ── Router ────────────────────────────────────────────────────────────────────
const router = createBrowserRouter([
  {
    // RootLayout wraps every route — all providers live here
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary fullScreen />,
    children: [
      // ── Public site shell ──
      { path: '/', element: <Index /> },
      { path: '/privacy', element: <PrivacyPolicy /> },
      { path: '/for-providers', element: <ForProviders /> },

      // ── Dependent account handoff (auth-gated, no sidebar/encryption gate) ──
      { path: '/claim-account', element: <ProtectedRoute><ClaimAccountPage /></ProtectedRoute> },
      { path: '/account-setup', element: <ProtectedRoute><AccountSetupPage /></ProtectedRoute> },

      // ── Auth & verification ──
      { path: '/auth', element: <Auth /> },
      { path: '/auth/register', element: <Auth /> },
      { path: '/auth/recover', element: <Auth /> },
      { path: '/waitlist', element: <Auth /> },
      { path: '/verification', element: <VerificationHub /> },
      { path: '/verify-email', element: <EmailVerifiedPage /> },

      // ── Guest flows ──
      { path: '/invite', element: <GuestInvitePage /> },
      { path: '/fulfill-request', element: <FulfillRequestPage /> },

      // ── Protected app ──
      {
        path: '/app',
        element: <ProtectedLayout />,
        errorElement: <RouteErrorBoundary fullScreen />,
        children: [
          { index: true, element: <HomeDashboard />, errorElement: <RouteErrorBoundary /> },
          { path: 'hash-tester', element: <HashTester />, errorElement: <RouteErrorBoundary /> },
          {
            path: 'blockchain-admin',
            element: (
              <RequiresPlatformAdmin>
                <BlockchainAdminDashboard />
              </RequiresPlatformAdmin>
            ),
            errorElement: <RouteErrorBoundary />,
          },
          {
            path: 'health-profile/:subjectId',
            element: <HealthProfile />,
            errorElement: <RouteErrorBoundary />,
          },
          { path: 'ai', element: <AIPortal />, errorElement: <RouteErrorBoundary /> },
          { path: 'ai/chat/:chatId', element: <AIPortal />, errorElement: <RouteErrorBoundary /> },
          { path: 'ai/history', element: <ChatHistoryPage />, errorElement: <RouteErrorBoundary /> },
          { path: 'all-records', element: <AllRecords />, errorElement: <RouteErrorBoundary /> },
          {
            path: 'record-requests',
            element: <RecordRequestsPage />,
            errorElement: <RouteErrorBoundary />,
          },
          { path: 'records/:recordId', element: <RecordDetail />, errorElement: <RouteErrorBoundary /> },
          { path: 'add-record', element: <AddRecord />, errorElement: <RouteErrorBoundary /> },
          { path: 'settings/*', element: <SettingsPage />, errorElement: <RouteErrorBoundary /> },
          { path: 'activity', element: <ActivityHub />, errorElement: <RouteErrorBoundary /> },
          { path: 'messages', element: <Messaging />, errorElement: <RouteErrorBoundary /> },
          {
            path: 'messages/:recipientId',
            element: <Messaging />,
            errorElement: <RouteErrorBoundary />,
          },
          {
            path: 'dependents/create',
            element: <CreateDependentPage />,
            errorElement: <RouteErrorBoundary />,
          },
        ],
      },

      { path: '*', element: <NotFound /> },
    ],
  },
]);

// ── App ───────────────────────────────────────────────────────────────────────
const App: React.FC = (): React.JSX.Element => <RouterProvider router={router} />;

export default App;
