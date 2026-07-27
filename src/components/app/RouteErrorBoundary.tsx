import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string> }) => void;
  }
}

interface RouteErrorBoundaryProps {
  // Full-screen card for root/app-shell tiers vs a contained card that fits inside Layout's content area.
  fullScreen?: boolean;
}

const RouteErrorBoundary: React.FC<RouteErrorBoundaryProps> = ({ fullScreen = false }) => {
  const error = useRouteError();
  const navigate = useNavigate();

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  useEffect(() => {
    console.error('RouteErrorBoundary caught an error:', error);
    window.plausible?.('Error', {
      props: { path: window.location.pathname, message },
    });
    // TODO: wire up a real error-tracking SDK (e.g. Sentry) here if one gets added.
  }, [error, message]);

  return (
    <div
      className={
        fullScreen
          ? 'min-h-screen flex items-center justify-center bg-gray-100'
          : 'flex items-center justify-center py-24'
      }
    >
      <div className="text-center max-w-md px-4">
        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
        <p className="text-gray-600 mb-6">
          This page ran into an unexpected error. You can try reloading it, or head back to the
          dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload page
          </Button>
          <Button onClick={() => navigate(fullScreen ? '/' : '/app')}>
            {fullScreen ? 'Return to Home' : 'Go to Dashboard'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RouteErrorBoundary;
