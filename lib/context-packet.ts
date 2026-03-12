/**
 * FORGE AI — Context Packet Assembler v3
 * 
 * Assembles the context packet injected into each Builder Agent prompt.
 * v3: Semantic keyword matching for failure pattern selection.
 * Target: ~1500 tokens max to leave room for the brief and code output.
 */

import type { Workstream, LivingSpec, FailurePattern } from './types'

// ─── SEMANTIC KEYWORD MATCHING ────────────────────────────────────────────────

/**
 * Matches failure patterns to a workstream brief using keyword overlap.
 * No LLM required — pure string matching. Fast and cheap.
 * 
 * Scoring: each keyword match in trigger_context that appears in brief = +1 point
 * Returns top N patterns by score, falling back to highest severity if no matches.
 */
function selectRelevantPatterns(
  brief: string,
  patterns: FailurePattern[],
  maxPatterns: number = 5
): FailurePattern[] {
  if (!patterns.length) return []

  const briefLower = brief.toLowerCase()

  // Extract content words from brief (skip common words)
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'do', 'does', 'will', 'would', 'should', 'could', 'may',
    'might', 'this', 'that', 'these', 'those', 'it', 'its', 'all', 'any',
    'each', 'use', 'using', 'must', 'need', 'create', 'build', 'add', 'make'
  ])

  const briefWords = new Set(
    briefLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
  )

  // Score each pattern
  const scored = patterns.map(pattern => {
    const triggerLower = (pattern.trigger_context || pattern.description || '').toLowerCase()
    const triggerWords = triggerLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))

    // Count keyword overlaps
    let score = 0
    for (const word of triggerWords) {
      if (briefWords.has(word)) score++
    }

    // Severity bonus: high=3, medium=1, low=0
    const severityBonus = pattern.severity === 'high' ? 3 : pattern.severity === 'medium' ? 1 : 0

    // Frequency bonus: more occurrences = more important to prevent
    const frequencyBonus = Math.min(pattern.occurrence_count, 5)

    return {
      pattern,
      score: score + severityBonus + frequencyBonus
    }
  })

  // Sort by score DESC, take top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPatterns)
    .filter(s => s.score > 0 || patterns.length <= maxPatterns) // include all if few patterns
    .map(s => s.pattern)
}

// ─── CONTEXT PACKET ASSEMBLY ──────────────────────────────────────────────────

export async function assembleContextPacket(
  workstream: Workstream,
  livingSpec: LivingSpec,
  allFailurePatterns: FailurePattern[]
): Promise<string> {
  const lines: string[] = []

  // ── Project context (brief, ~100 tokens) ──────────────────────────────────
  lines.push(`PROJECT: ${livingSpec.content.vision}`)
  lines.push('')

  // ── Tech stack (one line each) ────────────────────────────────────────────
  lines.push('TECH STACK:')
  for (const tech of livingSpec.content.tech_stack) {
    lines.push(`  ${tech.layer}: ${tech.choice}`)
  }
  lines.push('')

  // ── File conventions ──────────────────────────────────────────────────────
  const conv = livingSpec.content.file_conventions
  if (conv) {
    lines.push('FILE CONVENTIONS:')
    lines.push(`  Components: ${conv.components_dir} (${conv.naming_pattern})`)
    lines.push(`  Lib/utils:  ${conv.lib_dir}`)
    lines.push(`  API routes: ${conv.api_dir}`)
    if (conv.test_dir) lines.push(`  Tests:      ${conv.test_dir}`)
    lines.push('')
  }

  // ── Architecture nodes relevant to this workstream ────────────────────────
  if (livingSpec.content.architecture?.length > 0) {
    const briefLower = workstream.brief.toLowerCase()
    const relevantArch = livingSpec.content.architecture.filter(node =>
      briefLower.includes(node.component.toLowerCase()) ||
      node.file_paths?.some(fp => workstream.estimated_files?.includes(fp))
    )

    if (relevantArch.length > 0) {
      lines.push('RELEVANT ARCHITECTURE:')
      for (const node of relevantArch.slice(0, 3)) {
        lines.push(`  ${node.component}: ${node.description}`)
        if (node.file_paths?.length) {
          lines.push(`    Files: ${node.file_paths.join(', ')}`)
        }
      }
      lines.push('')
    }
  }

  // ── Existing files (to prevent collision) ────────────────────────────────
  const allExistingFiles = livingSpec.content.architecture
    ?.flatMap(n => n.file_paths || []) || []
  
  if (allExistingFiles.length > 0) {
    lines.push('EXISTING FILES (do not overwrite unless your brief specifically says to):')
    for (const file of allExistingFiles.slice(0, 15)) {
      lines.push(`  ${file}`)
    }
    lines.push('')
  }

  // ── Relevant failure patterns ─────────────────────────────────────────────
  const relevantPatterns = selectRelevantPatterns(workstream.brief, allFailurePatterns)

  if (relevantPatterns.length > 0) {
    lines.push('PATTERNS TO AVOID (learned from previous builds):')
    for (const pattern of relevantPatterns) {
      lines.push(`  ⚠ ${pattern.pattern_type} (seen ${pattern.occurrence_count}x):`)
      lines.push(`    Prevention: ${pattern.prevention}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ─── TOKEN ESTIMATOR ─────────────────────────────────────────────────────────

/**
 * Rough token estimate (1 token ≈ 4 chars for English text)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
