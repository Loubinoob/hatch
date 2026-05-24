/**
 * variable-importance.ts — Pure computation, no LLM.
 * Identifies which contextual variable best discriminates willingness-to-pay.
 * Uses paywall_impressions as the source of truth (has all context + converted flag).
 * Called by the Pricing Scientist; results stored in pricing_variable_importance.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any

export interface VariableImportanceResult {
  variable_name: string
  importance_score: number  // 0-1
  optimal_price_by_value: Record<string, number>  // { "organic": 4900, "social": 1900 }
  revenue_spread_cents: number  // max_rpi - min_rpi across values
  evidence: Record<string, unknown>
}

// Contextual variables to analyse (from paywall_impressions columns)
const CONTEXTUAL_COLUMNS = [
  "utm_source", "utm_medium", "device_type", "country", "is_returning",
] as const

const MIN_IMPRESSIONS_PER_VALUE = 10  // minimum per bucket for reliable signal
const MIN_TOTAL_IMPRESSIONS = 30      // minimum total before running at all

// ── Main function ─────────────────────────────────────────────────────────────
export async function computeVariableImportance(
  supabase: Supa,
  planId: string,
  accountId: string,
  anchorCents: number
): Promise<VariableImportanceResult[]> {
  // Load raw impressions for this account
  // paywall_impressions has: utm_source, device_type, country, is_returning,
  // quiz_answers (jsonb), converted, price_shown_cents
  let impressions: Record<string, unknown>[] = []
  try {
    const { data } = await supabase
      .from("paywall_impressions")
      .select("utm_source, utm_medium, device_type, country, is_returning, quiz_answers, converted, price_shown_cents")
      .eq("account_id", accountId)
    impressions = data ?? []
  } catch {
    return []  // table may not exist yet
  }

  if (impressions.length < MIN_TOTAL_IMPRESSIONS) return []

  const results: VariableImportanceResult[] = []

  // ── Standard contextual variables ────────────────────────────────────────
  for (const col of CONTEXTUAL_COLUMNS) {
    const grouped = groupAndScore(impressions, col, anchorCents)
    const result = computeImportance(col, grouped, MIN_IMPRESSIONS_PER_VALUE)
    if (result) results.push(result)
  }

  // ── Quiz answer variables (q_<question_id>) ───────────────────────────────
  const quizVarMap = new Map<string, { value: string; imp: Record<string, unknown> }[]>()
  for (const imp of impressions) {
    const answers = imp.quiz_answers
    if (!answers || typeof answers !== "object") continue
    for (const [qKey, qVal] of Object.entries(answers as Record<string, unknown>)) {
      const varName = `q_${qKey}`
      if (!quizVarMap.has(varName)) quizVarMap.set(varName, [])
      quizVarMap.get(varName)!.push({ value: String(qVal), imp })
    }
  }

  for (const [varName, rows] of quizVarMap.entries()) {
    const grouped = groupRowsByValue(rows.map(r => ({ ...r.imp, _val: r.value })), "_val", anchorCents)
    const result = computeImportance(varName, grouped, 5)  // lower threshold for quiz
    if (result) results.push(result)
  }

  return results.sort((a, b) => b.importance_score - a.importance_score)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Bucket {
  impressions: number
  conversions: number
  priceCentsSum: number
}

function groupAndScore(
  rows: Record<string, unknown>[],
  column: string,
  anchorCents: number
): Map<string, Bucket> {
  return groupRowsByValue(rows, column, anchorCents)
}

function groupRowsByValue(
  rows: Record<string, unknown>[],
  column: string,
  anchorCents: number
): Map<string, Bucket> {
  const map = new Map<string, Bucket>()
  for (const row of rows) {
    const rawVal = row[column]
    if (rawVal === null || rawVal === undefined) continue
    const val = String(rawVal)
    if (val === "null" || val === "undefined" || val === "") continue
    const ex = map.get(val) ?? { impressions: 0, conversions: 0, priceCentsSum: 0 }
    map.set(val, {
      impressions: ex.impressions + 1,
      conversions: ex.conversions + ((row.converted as boolean) ? 1 : 0),
      priceCentsSum: ex.priceCentsSum + ((row.price_shown_cents as number) ?? anchorCents),
    })
  }
  return map
}

function computeImportance(
  varName: string,
  grouped: Map<string, Bucket>,
  minImpressionsPerValue: number
): VariableImportanceResult | null {
  const byValue = Array.from(grouped.entries())
    .filter(([, v]) => v.impressions >= minImpressionsPerValue)
    .map(([val, v]) => {
      const convRate = v.conversions / v.impressions
      const avgPrice = v.priceCentsSum / v.impressions
      const rpi = convRate * avgPrice
      return { val, rpi, impressions: v.impressions, avgPrice }
    })

  if (byValue.length < 2) return null

  const rpis = byValue.map(v => v.rpi)
  const maxRpi = Math.max(...rpis)
  const minRpi = Math.min(...rpis)
  const totalVolume = byValue.reduce((s, v) => s + v.impressions, 0)

  const relativeSpread = maxRpi > 0 ? (maxRpi - minRpi) / maxRpi : 0
  const volumeWeight = Math.min(1, totalVolume / 200)
  const importanceScore = Math.round(relativeSpread * volumeWeight * 100) / 100

  if (importanceScore < 0.05) return null  // negligible

  const optimalByValue: Record<string, number> = {}
  for (const v of byValue) {
    optimalByValue[v.val] = Math.round(v.avgPrice)
  }

  const maxByValue = byValue.reduce((a, b) => a.rpi >= b.rpi ? a : b)

  return {
    variable_name: varName,
    importance_score: importanceScore,
    optimal_price_by_value: optimalByValue,
    revenue_spread_cents: Math.round(maxRpi - minRpi),
    evidence: {
      values_tested: byValue.length,
      total_impressions: totalVolume,
      top_value: maxByValue.val,
      top_value_rpi: Math.round(maxByValue.rpi),
    },
  }
}

// ── Persist to DB ─────────────────────────────────────────────────────────────
export async function persistVariableImportance(
  supabase: Supa,
  accountId: string,
  planId: string,
  results: VariableImportanceResult[]
): Promise<void> {
  if (!results.length) return
  // Replace old results for this plan
  await supabase.from("pricing_variable_importance")
    .delete()
    .eq("account_id", accountId)
    .eq("plan_id", planId)

  await supabase.from("pricing_variable_importance").insert(
    results.map(r => ({
      account_id: accountId,
      plan_id: planId,
      variable_name: r.variable_name,
      importance_score: r.importance_score,
      optimal_price_by_value: r.optimal_price_by_value,
      revenue_spread_cents: r.revenue_spread_cents,
      evidence: r.evidence,
      computed_at: new Date().toISOString(),
    }))
  )
}
