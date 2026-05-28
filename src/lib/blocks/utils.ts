import type { Block } from "./types"
import { BLOCK_DEFINITIONS } from "./definitions"

/** Tiny ID — no dependency needed, unique enough for block arrays */
export function blockId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/**
 * Build a new block with default props merged with any overrides.
 */
export function makeBlock(type: Block["type"], overrides: Record<string, unknown> = {}): Block {
  return {
    id:    blockId(),
    type,
    props: { ...BLOCK_DEFINITIONS[type].defaultProps, ...overrides },
  }
}

/**
 * When a paywall has no blocks yet (legacy paywall), auto-generate a minimal
 * [hero, plans] sequence from the existing headline/subheadline fields.
 * This ensures existing paywalls keep rendering correctly.
 */
export function legacyToBlocks(paywall: {
  headline?:    string | null
  subheadline?: string | null
  cta_copy?:    string | null
  guarantee_text?: string | null
  urgency_text?:  string | null
}): Block[] {
  const blocks: Block[] = []

  blocks.push(makeBlock("hero", {
    headline:    paywall.headline    ?? "Unlock full access",
    subheadline: paywall.subheadline ?? null,
    alignment:   "center",
  }))

  if (paywall.urgency_text) {
    blocks.push(makeBlock("urgency", { text: paywall.urgency_text }))
  }

  blocks.push(makeBlock("plans", {
    ctaCopy: paywall.cta_copy ?? "Get started",
  }))

  if (paywall.guarantee_text) {
    blocks.push(makeBlock("guarantee", { text: paywall.guarantee_text }))
  }

  blocks.push(makeBlock("footer", {}))

  return blocks
}
