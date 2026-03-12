'use client';

import { useState } from 'react';

interface FounderQuestion {
  id: string;
  question: string;
  context: string;
  urgency: 'low' | 'medium' | 'high' | 'blocking';
  answer: string | null;
  answered: boolean;
  answered_at: string | null;
}

interface QuestionsPanelProps {
  questions: FounderQuestion[];
  onAnswer?: (id: string, answer: string) => Promise<void>;
}

const URGENCY_STYLES: Record<FounderQuestion['urgency'], string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  blocking: 'bg-red-100 text-red-700',
};

function CheckIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="inline-block w-4 h-4 text-green-500 mr-1 flex-shrink-0"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function QuestionCard({
  question,
  dimmed,
  onAnswer,
}: {
  question: FounderQuestion;
  dimmed: boolean;
  onAnswer?: (id: string, answer: string) => Promise<void>;
}): JSX.Element {
  const [answerText, setAnswerText] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!onAnswer || answerText.trim() === '') return;
    setSubmitting(true);
    setError(null);
    try {
      await onAnswer(question.id, answerText.trim());
      setAnswerText('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-2 transition-opacity ${
        dimmed ? 'opacity-50 border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1">
          {question.answered && <CheckIcon />}
          <p className="text-sm font-medium text-gray-900 leading-snug">
            {question.question}
          </p>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
            URGENCY_STYLES[question.urgency]
          }`}
        >
          {question.urgency}
        </span>
      </div>

      {question.context && (
        <p className="text-xs text-gray-500 leading-relaxed">{question.context}</p>
      )}

      {question.answered && question.answer && (
        <div className="mt-1 rounded bg-green-50 border border-green-200 px-3 py-2">
          <p className="text-xs text-green-800">
            <span className="font-semibold">Answer: </span>
            {question.answer}
          </p>
          {question.answered_at && (
            <p className="text-xs text-green-600 mt-0.5">
              {new Date(question.answered_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {!question.answered && onAnswer && (
        <form onSubmit={handleSubmit} className="mt-1 flex flex-col gap-1.5">
          <textarea
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            placeholder="Type your answer…"
            rows={2}
            disabled={submitting}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-50"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting || answerText.trim() === ''}
            className="self-end rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Answer'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function QuestionsPanel({
  questions,
  onAnswer,
}: QuestionsPanelProps): JSX.Element {
  const [showAnswered, setShowAnswered] = useState<boolean>(false);

  const unanswered = questions.filter(
    (q) => q.answered === false || q.answer === null
  );
  const answered = questions.filter(
    (q) => q.answered === true && q.answer !== null
  );

  const answeredCount = answered.length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-gray-800">
        Questions
        {unanswered.length > 0 && (
          <span className="ml-2 inline-flex items-center justify-center rounded-full bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5">
            {unanswered.length}
          </span>
        )}
      </h2>

      {unanswered.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">No open questions — all clear ✓</p>
      ) : (
        <div className="flex flex-col gap-2">
          {unanswered.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              dimmed={false}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      )}

      {answeredCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowAnswered((prev) => !prev)}
            className="self-start text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors"
          >
            {showAnswered
              ? 'Hide answered'
              : `Show ${answeredCount} answered`}
          </button>

          {showAnswered && (
            <div className="flex flex-col gap-2">
              {answered.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  dimmed={true}
                  onAnswer={undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
