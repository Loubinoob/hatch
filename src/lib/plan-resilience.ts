/**
 * Resilient plan save + safe defaults.
 *
 * Production databases may be missing columns from recent migrations (009, 011,
 * 012, 013 — dynamic pricing, segmentation). A missing optional column must
 * never prevent a founder from creating or editing a plan.
 *
 * Pattern mirrors src/lib/paywall-resilience.ts.
 */

/** Fields required for a plan to function. Never dropped on retry. */
export const PLAN_CRITICAL_FIELDS = [
  "name",
  "account_id",
  "price_monthly",
  "price_yearly",
] as const

/** Optional fields — dropped silently if the column doesn't exist in the DB yet. */
export const PLAN_OPTIONAL_FIELDS = [
  "dynamic_pricing_enabled",
  "price_floor_cents",
  "price_ceiling_cents",
  "pricing_segment_keys",
  "pricing_aggressiveness",
  "is_popular",
  "is_active",
  "trial_days",
  "stripe_product_id",
  "stripe_price_id_monthly",
  "stripe_price_id_yearly",
  "features",
  "description",
  "badge_color",
  "sort_order",
] as const

/**
 * Safe fallback values for optional plan fields.
 * Applied on load so the UI never crashes when columns are missing.
 */
export const PLAN_DEFAULTS: Record<string, unknown> = {
  dynamic_pricing_enabled:  false,
  price_floor_cents:        null,
  price_ceiling_cents:      null,
  pricing_segment_keys:     [],
  pricing_aggressiveness:   "balanced",
  is_popular:               false,
  is_active:                true,
  trial_days:               0,
  stripe_product_id:        null,
  stripe_price_id_monthly:  null,
  stripe_price_id_yearly:   null,
  features:                 [],
  description:              null,
  badge_color:              "#6366F1",
  sort_order:               0,
}

/**
 * Merges safe defaults into a plan object for any null/undefined optional fields.
 * Call when reading plan rows so the UI never crashes on a schema behind on migrations.
 */
export function withPlanDefaults<T extends Record<string, unknown>>(plan: T): T {
  const result = { ...plan }
  for (const [key, fallback] of Object.entries(PLAN_DEFAULTS)) {
    if (result[key] === null || result[key] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = fallback
    }
  }
  return result
}

// ─── Shared internals ────────────────────────────────────────────────────────

type SaveOk<T>  = { data: T; droppedFields: string[]; error?: never }
type SaveErr    = { data?: never; droppedFields?: never; error: { message: string } }
export type PlanSaveResult<T> = SaveOk<T> | SaveErr

const MAX_ATTEMPTS = 30   // enough for all optional columns
const COL_RE = /Could not find the '([a-zA-Z_]+)' column/i

function extractMissingColumn(message?: string | null): string | null {
  return message?.match(COL_RE)?.[1] ?? null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCritical(col: string): boolean {
  return (PLAN_CRITICAL_FIELDS as readonly string[]).includes(col)
}

// ─── INSERT ──────────────────────────────────────────────────────────────────

/**
 * Resilient plan INSERT.
 *
 * Tries to insert the full payload; on PGRST204 / "Could not find the 'X' column"
 * the missing field is dropped and the insert is retried automatically — as long
 * as 'X' is not a critical field.
 */
export async function insertPlanResilient<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  payload: Record<string, unknown>,
): Promise<PlanSaveResult<T>> {
  const body = { ...payload }
  const dropped: string[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("plans")
      .insert(body)
      .select()
      .single()

    if (!error) return { data: data as T, droppedFields: dropped }

    const missingCol = extractMissingColumn(error.message)

    if (missingCol && missingCol in body) {
      if (isCritical(missingCol)) {
        return {
          error: {
            message: `Required field '${missingCol}' is missing from the database. Please run migrations.`,
          },
        }
      }
      console.warn(`[Hatch] Column '${missingCol}' not in DB — dropping from insert and retrying`)
      dropped.push(missingCol)
      delete body[missingCol]
      continue
    }

    // Non-recoverable error
    return { error: { message: error.message ?? "Insert failed" } }
  }

  return { error: { message: "Too many missing columns — please run pending migrations (supabase db push)." } }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

/**
 * Resilient plan UPDATE.
 *
 * Same retry pattern as insertPlanResilient but issues an UPDATE by plan id.
 */
export async function updatePlanResilient<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  planId: string,
  payload: Record<string, unknown>,
): Promise<PlanSaveResult<T>> {
  const body = { ...payload }
  const dropped: string[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("plans")
      .update(body)
      .eq("id", planId)
      .select()
      .single()

    if (!error) return { data: data as T, droppedFields: dropped }

    const missingCol = extractMissingColumn(error.message)

    if (missingCol && missingCol in body) {
      if (isCritical(missingCol)) {
        return {
          error: {
            message: `Required field '${missingCol}' is missing from the database. Please run migrations.`,
          },
        }
      }
      console.warn(`[Hatch] Column '${missingCol}' not in DB — dropping from update and retrying`)
      dropped.push(missingCol)
      delete body[missingCol]
      continue
    }

    return { error: { message: error.message ?? "Update failed" } }
  }

  return { error: { message: "Too many missing columns — please run pending migrations (supabase db push)." } }
}
