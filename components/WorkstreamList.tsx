'use client';

import React from 'react';
import WorkstreamCard from './WorkstreamCard';

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

interface WorkstreamListProps {
  workstreams: Workstream[];
}

const PRIORITY_ORDER: Record<Workstream['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function isWorkstreamComplete(ws: Workstream): boolean {
  return (
    ws.status === 'complete' ||
    (ws.tasks.length > 0 && ws.tasks.every((t) => t.done))
  );
}

function sortWorkstreams(workstreams: Workstream[]): Workstream[] {
  return [...workstreams].sort((a, b) => {
    const aComplete = isWorkstreamComplete(a);
    const bComplete = isWorkstreamComplete(b);

    // Complete workstreams go to the bottom
    if (aComplete && !bComplete) return 1;
    if (!aComplete && bComplete) return -1;

    // Within the same completion group, sort by priority
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Within same priority, sort by phase
    return a.phase - b.phase;
  });
}

export default function WorkstreamList({ workstreams }: WorkstreamListProps) {
  const sorted = sortWorkstreams(workstreams);

  const activeWorkstreams = sorted.filter((ws) => !isWorkstreamComplete(ws));
  const completedWorkstreams = sorted.filter((ws) => isWorkstreamComplete(ws));

  if (workstreams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <svg
            className="w-6 h-6 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-500">No workstreams yet</p>
        <p className="text-xs text-gray-400 mt-1">
          Submit a brief to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active workstreams */}
      {activeWorkstreams.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Active
            </h2>
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.5 rounded-full">
              {activeWorkstreams.length}
            </span>
          </div>
          <div className="space-y-3">
            {activeWorkstreams.map((ws) => (
              <WorkstreamCard key={ws.id} workstream={ws} />
            ))}
          </div>
        </section>
      )}

      {/* Completed workstreams */}
      {completedWorkstreams.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Completed
            </h2>
            <span className="text-xs bg-green-100 text-green-700 font-semibold px-1.5 py-0.5 rounded-full">
              {completedWorkstreams.length}
            </span>
          </div>
          <div className="space-y-3">
            {completedWorkstreams.map((ws) => (
              <WorkstreamCard key={ws.id} workstream={ws} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
