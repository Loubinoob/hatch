/**
 * inhouse-pricing-model.ts — Stub for the future in-house pricing model.
 *
 * Currently implements argmax-RPI with Laplace smoothing.
 * The interface is IDENTICAL to the Claude scientist so swapping is zero-cost later.
 * Replace the body of runInhouseModel() with a trained model (logistic regression,
 * neural net, etc.) without changing any caller.
 */

import { ElasticityResult } from "./elasticity"
import { VariableImportanceResult } from "./variable-importance"
import { snapToLadder } from "./price-ladder"

export interface PricingDecision {
  optimalBySegment: Record<string, number>
  topVariables: {
    variable: string
    importance: number
    optimalPriceByValue: Record<string, number>
    rationale: string
  }[]
  candidateActions: {
    action: "add" | "prune"
    price_cents: number
    segment_hash?: string
    reason: string
  }[]
  reasoning: string
  confidence: number
  engine: "claude" | "in_house_model"
}

export async function runInhouseModel(
  elasticityGlobal: ElasticityResult | null,
  elasticityBySegment: Map<string, ElasticityResult>,
  variableImportance: VariableImportanceResult[],
  floorCents: number,
  ceilingCents: number,
): Promise<PricingDecision> {
  const optimalBySegment: Record<string, number> = {}

  if (elasticityGlobal?.optimal_price_cents) {
    optimalBySegment["global"] = elasticityGlobal.optimal_price_cents
  }
  for (const [hash, result] of elasticityBySegment.entries()) {
    optimalBySegment[hash] = result.optimal_price_cents
  }

  const candidateActions: PricingDecision["candidateActions"] = []

  if (elasticityGlobal) {
    const { curve, optimal_price_cents, optimal_rpi_cents } = elasticityGlobal

    // Prune dominated candidates (RPI < 70% of leader, ≥ 30 impressions)
    for (const p of curve) {
      if (
        p.price_cents !== optimal_price_cents &&
        p.impressions >= 30 &&
        optimal_rpi_cents > 0 &&
        p.rpi_cents < optimal_rpi_cents * 0.70
      ) {
        candidateActions.push({
          action: "prune",
          price_cents: p.price_cents,
          reason: `RPI ${Math.round(p.rpi_cents)}¢ < 70% of leader (${Math.round(optimal_rpi_cents)}¢)`,
        })
      }
    }

    // Climb: if winner is at price ceiling, explore higher
    const sortedPrices = curve.map(p => p.price_cents).sort((a, b) => a - b)
    if (
      optimal_price_cents === sortedPrices[sortedPrices.length - 1] &&
      optimal_price_cents < ceilingCents
    ) {
      const proposed = snapToLadder(Math.round(optimal_price_cents * 1.3))
      const snapped = Math.min(proposed, ceilingCents)
      if (snapped > optimal_price_cents && snapped <= ceilingCents) {
        candidateActions.push({
          action: "add",
          price_cents: snapped,
          reason: "Winner is at highest tested price — climbing to explore ceiling",
        })
      }
    }

    // Descend: if winner is at price floor, explore lower
    if (
      optimal_price_cents === sortedPrices[0] &&
      optimal_price_cents > floorCents
    ) {
      const proposed = snapToLadder(Math.round(optimal_price_cents * 0.75))
      const snapped = Math.max(proposed, floorCents)
      if (snapped < optimal_price_cents && snapped >= floorCents) {
        candidateActions.push({
          action: "add",
          price_cents: snapped,
          reason: "Winner is at lowest tested price — exploring below to map demand floor",
        })
      }
    }
  }

  const topVariables = variableImportance.slice(0, 3).map(v => ({
    variable: v.variable_name,
    importance: v.importance_score,
    optimalPriceByValue: v.optimal_price_by_value,
    rationale: `Discriminates revenue by $${(v.revenue_spread_cents / 100).toFixed(2)}/impression across ${v.variable_name} values`,
  }))

  const globalOptimal = optimalBySegment["global"]
  return {
    optimalBySegment,
    topVariables,
    candidateActions: candidateActions.slice(0, 5),
    reasoning: `In-house model (argmax-RPI): analysed ${elasticityGlobal?.curve.length ?? 0} price candidates. Global revenue-maximising price: $${globalOptimal ? Math.round(globalOptimal / 100) : "?"}/mo. Confidence: ${Math.round((elasticityGlobal?.confidence ?? 0) * 100)}%.`,
    confidence: elasticityGlobal?.confidence ?? 0,
    engine: "in_house_model",
  }
}
