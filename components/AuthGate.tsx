'use client';

import React, { useState, useEffect } from 'react';
import LoginScreen from '@/components/LoginScreen';

interface AuthGateProps {
  children: React.ReactNode;
}

interface AuthCheckResponse {
  authenticated: boolean;
}

export default function AuthGate({ children }: AuthGateProps): React.JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    const checkAuth = async (): Promise<void> => {
      try {
        const response = await fetch('/api/auth/check', {
          method: 'GET',
          credentials: 'same-origin',
        });

        if (response.ok) {
          const body: AuthCheckResponse = await response.json();
          setIsAuthenticated(body.authenticated === true);
        } else {
          setIsAuthenticated(false);
        }
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkAuth();
  }, []);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <span className="text-gray-500">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onSuccess={() => setIsAuthenticated(true)} />;
  }

  return <>{children}</>;
}
