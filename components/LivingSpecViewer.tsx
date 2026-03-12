'use client';

import React, { useState, useCallback } from 'react';
import { currentSpec, type SpecSection, type SpecDecision } from '@/lib/specData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SectionId =
  | 'goals'
  | 'tech-stack'
  | 'constraints'
  | 'out-of-scope'
  | 'architecture-decisions'
  | 'file-conventions';

type OpenState = Record<SectionId, boolean>;

const ALL_SECTION_IDS: SectionId[] = [
  'goals',
  'tech-stack',
  'constraints',
  'out-of-scope',
  'architecture-decisions',
  'file-conventions',
];

function buildDefaultOpenState(): OpenState {
  return ALL_SECTION_IDS.reduce<OpenState>((acc, id) => {
    acc[id] = true;
    return acc;
  }, {} as OpenState);
}

// ---------------------------------------------------------------------------
// Chevron SVG
// ---------------------------------------------------------------------------

interface ChevronProps {
  open: boolean;
}

function Chevron({ open }: ChevronProps): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${
        open ? 'rotate-0' : '-rotate-90'
      }`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section Wrapper
// ---------------------------------------------------------------------------

interface CollapsibleSectionProps {
  id: SectionId;
  title: string;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
  isFirst?: boolean;
}

function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  children,
  isFirst = false,
}: CollapsibleSectionProps): React.ReactElement {
  return (
    <div className={isFirst ? '' : 'border-t border-zinc-800'}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between py-4 px-1 hover:bg-zinc-800/50 rounded-lg transition-colors duration-150 group"
        aria-expanded={open}
        aria-controls={`section-content-${id}`}
      >
        <span className="text-zinc-100 font-semibold text-lg">{title}</span>
        <Chevron open={open} />
      </button>

      <div
        id={`section-content-${id}`}
        className={`overflow-hidden transition-all duration-200 ${
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="pb-4 px-1">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple item list renderer
// ---------------------------------------------------------------------------

interface ItemListProps {
  section: SpecSection;
}

function ItemList({ section }: ItemListProps): React.ReactElement {
  return (
    <ul className="space-y-2">
      {section.items.map((item, index) => (
        <li
          key={`${section.id}-item-${index}`}
          className="border-l-2 border-zinc-700 pl-3 text-zinc-400 text-sm leading-relaxed"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Architecture Decisions Timeline
// ---------------------------------------------------------------------------

interface DecisionsListProps {
  decisions: SpecDecision[];
}

function DecisionsList({ decisions }: DecisionsListProps): React.ReactElement {
  return (
    <ol className="space-y-4">
      {decisions.map((d, index) => (
        <li
          key={`decision-${index}`}
          className="border-l-2 border-zinc-700 pl-3"
        >
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="bg-zinc-800 text-zinc-400 text-xs font-mono px-2 py-0.5 rounded">
              {d.date}
            </span>
            <span className="text-zinc-300 text-sm font-medium">{d.decision}</span>
          </div>
          <p className="text-zinc-500 text-xs italic leading-relaxed">{d.rationale}</p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function LivingSpecViewer(): React.ReactElement {
  const [openState, setOpenState] = useState<OpenState>(buildDefaultOpenState);

  const allOpen = ALL_SECTION_IDS.every((id) => openState[id]);

  const handleToggle = useCallback((id: SectionId) => {
    setOpenState((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleToggleAll = useCallback(() => {
    const next = !allOpen;
    setOpenState(
      ALL_SECTION_IDS.reduce<OpenState>((acc, id) => {
        acc[id] = next;
        return acc;
      }, {} as OpenState)
    );
  }, [allOpen]);

  const spec = currentSpec;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-emerald-500 text-xs font-mono uppercase tracking-widest mb-1">
            Living Spec
          </p>
          <h2 className="text-zinc-100 text-2xl font-bold">{spec.projectName}</h2>
        </div>

        <button
          type="button"
          onClick={handleToggleAll}
          className="text-zinc-500 hover:text-zinc-300 text-xs uppercase tracking-wider transition-colors duration-150 mt-1 shrink-0"
        >
          {allOpen ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Vision — always visible */}
      <p className="text-zinc-300 text-base italic leading-relaxed mb-6 border-l-2 border-emerald-700 pl-3">
        {spec.vision}
      </p>

      {/* Collapsible sections */}
      <div>
        <CollapsibleSection
          id="goals"
          title={spec.goals.title}
          open={openState['goals']}
          onToggle={handleToggle}
          isFirst
        >
          <ItemList section={spec.goals} />
        </CollapsibleSection>

        <CollapsibleSection
          id="tech-stack"
          title={spec.techStack.title}
          open={openState['tech-stack']}
          onToggle={handleToggle}
        >
          <ItemList section={spec.techStack} />
        </CollapsibleSection>

        <CollapsibleSection
          id="constraints"
          title={spec.constraints.title}
          open={openState['constraints']}
          onToggle={handleToggle}
        >
          <ItemList section={spec.constraints} />
        </CollapsibleSection>

        <CollapsibleSection
          id="out-of-scope"
          title={spec.outOfScope.title}
          open={openState['out-of-scope']}
          onToggle={handleToggle}
        >
          <ItemList section={spec.outOfScope} />
        </CollapsibleSection>

        <CollapsibleSection
          id="architecture-decisions"
          title="Architecture Decisions"
          open={openState['architecture-decisions']}
          onToggle={handleToggle}
        >
          <DecisionsList decisions={spec.architectureDecisions} />
        </CollapsibleSection>

        <CollapsibleSection
          id="file-conventions"
          title={spec.fileConventions.title}
          open={openState['file-conventions']}
          onToggle={handleToggle}
        >
          <ItemList section={spec.fileConventions} />
        </CollapsibleSection>
      </div>
    </div>
  );
}
