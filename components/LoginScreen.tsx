'use client';

import React, { useState, FormEvent } from 'react';

interface LoginScreenProps {
  onSuccess: () => void;
}

export default function LoginScreen({ onSuccess }: LoginScreenProps): React.JSX.Element {
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        onSuccess();
      } else if (response.status === 401) {
        setError('Wrong password');
      } else {
        setError('Something went wrong. Try again.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="bg-[#1e1e2e] p-8 rounded-lg border border-gray-800 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white mb-1">Forge AI</h1>
        <p className="text-sm text-gray-400 mb-6">Enter password to continue</p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isSubmitting}
            className="w-full bg-[#0a0a0f] border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 transition-colors"
          />

          {error !== null && (
            <p className="text-red-400 text-sm mt-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2 rounded font-medium transition-colors"
          >
            {isSubmitting ? 'Checking...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
