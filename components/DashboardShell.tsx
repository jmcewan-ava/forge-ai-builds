'use client';

import { useState, useEffect, useCallback } from 'react';
import BriefModal from './BriefModal';

interface WorkstreamTask {
  text: string;
  done: boolean;
}

interface Workstream {
  name: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  phase: number;
  tasks: WorkstreamTask[];
}

const PRIORITY_STYLES: Record<Workstream['priority'], string> = {
  P0: 'bg-red-900 text-red-300 border border-red-700',
  P1: 'bg-orange-900 text-orange-300 border border-orange-700',
  P2: 'bg-yellow-900 text-yellow-300 border border-yellow-700',
  P3: 'bg-green-900 text-green-300 border border-green-700',
};

export default function DashboardShell() {
  const [showBriefModal, setShowBriefModal] = useState<boolean>(false);
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const fetchWorkstreams = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/workstreams');
      if (!response.ok) {
        setWorkstreams([]);
        return;
      }
      const data: { workstreams: Workstream[] } = await response.json();
      setWorkstreams(Array.isArray(data.workstreams) ? data.workstreams : []);
    } catch (err) {
      setWorkstreams([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkstreams();
  }, [refreshKey, fetchWorkstreams]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: '#0a0a0f' }}>
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-gray-800">
        <span className="text-xl font-bold">Forge AI</span>
        <button
          type="button"
          onClick={() => setShowBriefModal(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
        >
          + Brief
        </button>
      </header>

      {/* Main content */}
      <main className="p-6">
        {isLoading ? (
          <p className="text-gray-400">Loading workstreams...</p>
        ) : workstreams.length === 0 ? (
          <div className="flex items-center justify-center min-h-[40vh]">
            <p className="text-gray-400 text-center">
              No active workstreams. Submit a brief to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workstreams.map((ws, index) => {
              const doneTasks = ws.tasks.filter((t) => t.done).length;
              const totalTasks = ws.tasks.length;

              return (
                <div
                  key={`${ws.name}-${index}`}
                  className="rounded-lg p-4 border border-gray-800"
                  style={{ backgroundColor: '#1e1e2e' }}
                >
                  {/* Card header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-white text-sm truncate mr-2">
                      {ws.name}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                        PRIORITY_STYLES[ws.priority] ?? 'bg-gray-800 text-gray-300'
                      }`}
                    >
                      {ws.priority}
                    </span>
                  </div>

                  {/* Card body */}
                  <p className="text-sm text-gray-400 mb-3 line-clamp-3">
                    {ws.description}
                  </p>

                  {/* Card footer */}
                  <p className="text-xs text-gray-500">
                    {doneTasks}/{totalTasks} tasks done
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Brief Modal */}
      <BriefModal
        isOpen={showBriefModal}
        onClose={() => setShowBriefModal(false)}
        onSuccess={handleRefresh}
      />
    </div>
  );
}
