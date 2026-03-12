'use client';

import { useState, useEffect, useCallback } from 'react';

interface BriefModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BriefModal({ isOpen, onClose, onSuccess }: BriefModalProps) {
  const [brief, setBrief] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (brief.trim() === '') {
      setError('Brief cannot be empty');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/brief', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brief: brief }),
      });

      if (response.ok) {
        setBrief('');
        onSuccess();
        onClose();
      } else {
        setError('Failed to submit brief. Please try again.');
      }
    } catch (err) {
      setError('Failed to submit brief. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="brief-modal-title"
    >
      <div
        className="w-full max-w-lg mx-4 rounded-lg border border-gray-800 p-6"
        style={{ backgroundColor: '#1e1e2e' }}
      >
        <h2
          id="brief-modal-title"
          className="text-xl font-bold text-white mb-4"
        >
          Submit Brief
        </h2>

        <textarea
          className="w-full rounded border border-gray-700 p-3 text-white text-sm resize-y focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#1e1e2e', minHeight: '120px' }}
          rows={4}
          placeholder="Describe what you want built..."
          value={brief}
          onChange={(e) => {
            setBrief(e.target.value);
            if (error) setError(null);
          }}
          disabled={isSubmitting}
          aria-label="Brief description"
        />

        {error && (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed px-2 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
