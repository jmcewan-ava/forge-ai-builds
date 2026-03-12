'use client';

import React from 'react';

interface Task {
  text: string;
  done: boolean;
}

interface Workstream {
  id: string;
  name: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  phase: number;
  status: 'pending' | 'in_progress' | 'complete' | 'blocked';
  tasks: Task[];
}

interface WorkstreamCardProps {
  workstream: Workstream;
}

const PRIORITY_COLORS: Record<Workstream['priority'], string> = {
  P0: 'bg-red-100 text-red-800',
  P1: 'bg-orange-100 text-orange-800',
  P2: 'bg-yellow-100 text-yellow-800',
  P3: 'bg-gray-100 text-gray-700',
};

const STATUS_COLORS: Record<Workstream['status'], string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-800',
  complete: 'bg-green-100 text-green-800',
  blocked: 'bg-red-100 text-red-800',
};

const STATUS_LABELS: Record<Workstream['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  complete: 'Complete',
  blocked: 'Blocked',
};

export default function WorkstreamCard({ workstream }: WorkstreamCardProps) {
  const { name, description, priority, phase, status, tasks } = workstream;

  const isComplete =
    status === 'complete' ||
    (tasks.length > 0 && tasks.every((t) => t.done));

  const completedCount = tasks.filter((t) => t.done).length;
  const totalCount = tasks.length;

  const cardBg = isComplete ? 'bg-green-50/50' : 'bg-white';
  const leftBorder = isComplete
    ? 'border-l-4 border-green-500'
    : status === 'blocked'
    ? 'border-l-4 border-red-400'
    : status === 'in_progress'
    ? 'border-l-4 border-blue-400'
    : 'border-l-4 border-gray-200';

  return (
    <div
      className={`relative rounded-lg shadow-sm border border-gray-200 ${
        leftBorder
      } ${
        cardBg
      } p-4 transition-all duration-200`}
    >
      {/* Top row: name + badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 leading-tight">
            {name}
          </h3>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              PRIORITY_COLORS[priority]
            }`}
          >
            {priority}
          </span>
          <span className="text-xs text-gray-400 font-medium">Phase {phase}</span>
        </div>

        {/* Status badge — always show Complete badge when complete */}
        {isComplete ? (
          <span className="bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
            Complete
          </span>
        ) : (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${
              STATUS_COLORS[status]
            }`}
          >
            {STATUS_LABELS[status]}
          </span>
        )}
      </div>

      {/* Description */}
      {description && (
        <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
          {description}
        </p>
      )}

      {/* Task list */}
      {tasks.length > 0 && (
        <div className={`mt-3 space-y-1 ${isComplete ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-500">
              Tasks
            </span>
            <span className="text-xs text-gray-400">
              {completedCount}/{totalCount}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-1 mb-2">
            <div
              className={`h-1 rounded-full transition-all duration-300 ${
                isComplete ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{
                width:
                  totalCount > 0
                    ? `${Math.round((completedCount / totalCount) * 100)}%`
                    : '0%',
              }}
            />
          </div>

          <ul className="space-y-1">
            {tasks.map((task, idx) => (
              <li key={idx} className="flex items-start gap-2">
                {/* Checkbox indicator (read-only) */}
                <span
                  className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                    task.done
                      ? 'bg-green-500 border-green-500'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {task.done && (
                    <svg
                      className="w-2.5 h-2.5 text-white"
                      viewBox="0 0 10 10"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M1.5 5L4 7.5L8.5 2.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className={`text-xs leading-relaxed ${
                    task.done
                      ? 'line-through text-gray-400'
                      : 'text-gray-700'
                  }`}
                >
                  {task.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
