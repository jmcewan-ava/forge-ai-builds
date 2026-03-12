'use client';

import { CostSummary } from '@/lib/costTracker';

interface CostDisplayProps {
  costSummary: CostSummary;
}

function formatUsd(amount: number): string {
  return amount.toFixed(2);
}

function clampPct(value: number, limit: number): number {
  return Math.min(100, (value / limit) * 100);
}

interface BarConfig {
  fillClass: string;
  labelClass: string;
}

function getBarConfig(isExceeded: boolean, isWarning: boolean): BarConfig {
  if (isExceeded) {
    return { fillClass: 'bg-red-500', labelClass: 'text-red-700 font-bold' };
  }
  if (isWarning) {
    return { fillClass: 'bg-yellow-500', labelClass: 'text-yellow-700' };
  }
  return { fillClass: 'bg-blue-500', labelClass: 'text-gray-800' };
}

export default function CostDisplay({ costSummary }: CostDisplayProps) {
  const {
    session_cost_usd,
    total_project_cost_usd,
    session_limit_usd,
    total_limit_usd,
    call_count,
    is_session_warning,
    is_total_warning,
    is_session_exceeded,
    is_total_exceeded,
  } = costSummary;

  const sessionConfig = getBarConfig(is_session_exceeded, is_session_warning);
  const totalConfig = getBarConfig(is_total_exceeded, is_total_warning);

  const sessionPct = clampPct(session_cost_usd, session_limit_usd);
  const totalPct = clampPct(total_project_cost_usd, total_limit_usd);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        API Cost
      </h3>

      {/* Session cost */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className={`text-sm font-medium ${sessionConfig.labelClass}`}>
            Session
          </span>
          <span className={`text-sm ${sessionConfig.labelClass}`}>
            ${formatUsd(session_cost_usd)}&nbsp;/&nbsp;${formatUsd(
              session_limit_usd
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-300 ${sessionConfig.fillClass}`}
            style={{ width: `${sessionPct}%` }}
            role="progressbar"
            aria-valuenow={session_cost_usd}
            aria-valuemin={0}
            aria-valuemax={session_limit_usd}
            aria-label="Session cost progress"
          />
        </div>
      </div>

      {/* Project total cost */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className={`text-sm font-medium ${totalConfig.labelClass}`}>
            Project
          </span>
          <span className={`text-sm ${totalConfig.labelClass}`}>
            ${formatUsd(total_project_cost_usd)}&nbsp;/&nbsp;${formatUsd(
              total_limit_usd
            )}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-300 ${totalConfig.fillClass}`}
            style={{ width: `${totalPct}%` }}
            role="progressbar"
            aria-valuenow={total_project_cost_usd}
            aria-valuemin={0}
            aria-valuemax={total_limit_usd}
            aria-label="Project cost progress"
          />
        </div>
      </div>

      {/* Call count */}
      <p className="text-xs text-gray-400">
        {call_count} API {call_count === 1 ? 'call' : 'calls'} this session
      </p>
    </div>
  );
}
