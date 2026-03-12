"use client";

import { useState, useCallback } from "react";

const MAX_BRIEF_LENGTH = 5000;

interface BriefInputProps {
  onSubmit: (brief: string) => void;
  isLoading?: boolean;
}

export default function BriefInput({ onSubmit, isLoading = false }: BriefInputProps) {
  const [brief, setBrief] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBrief(value);
    if (value.length > MAX_BRIEF_LENGTH) {
      setError(`Brief must be ${MAX_BRIEF_LENGTH} characters or fewer.`);
    } else {
      setError(null);
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (brief.trim().length === 0) {
        setError("Brief cannot be empty.");
        return;
      }
      if (brief.length > MAX_BRIEF_LENGTH) {
        setError(`Brief must be ${MAX_BRIEF_LENGTH} characters or fewer.`);
        return;
      }
      setError(null);
      onSubmit(brief);
    },
    [brief, onSubmit]
  );

  const charsRemaining = MAX_BRIEF_LENGTH - brief.length;
  const isOverLimit = brief.length > MAX_BRIEF_LENGTH;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full">
      <label
        htmlFor="brief-textarea"
        className="text-sm font-semibold text-gray-200"
      >
        Project Brief
      </label>
      <textarea
        id="brief-textarea"
        value={brief}
        onChange={handleChange}
        maxLength={MAX_BRIEF_LENGTH}
        rows={8}
        placeholder="Describe your project in detail. The more context you provide, the better the output."
        disabled={isLoading}
        className={`w-full rounded-lg border bg-gray-900 p-3 text-sm text-gray-100 placeholder-gray-500 resize-y focus:outline-none focus:ring-2 transition-colors ${
          isOverLimit
            ? "border-red-500 focus:ring-red-500"
            : "border-gray-700 focus:ring-indigo-500"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${
            isOverLimit ? "text-red-400" : charsRemaining < 200 ? "text-yellow-400" : "text-gray-500"
          }`}
        >
          {brief.length}/{MAX_BRIEF_LENGTH}
        </span>
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>
      <button
        type="submit"
        disabled={isLoading || isOverLimit || brief.trim().length === 0}
        className="self-end rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? "Submitting…" : "Submit Brief"}
      </button>
    </form>
  );
}
