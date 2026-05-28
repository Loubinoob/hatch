/**
 * Resilient paywall save + safe defaults.
 *
 * Production databases may be missing columns from recent migrations (V2, V3
 * cosmetic fields). These helpers ensure that a missing column never blocks
 * publish/save — optional fields are dropped and retried, critical fields
 * still surface a real error.
 */

/** Fields that are REQUIRED for a paywall to function. Never dropped on retry. */
export const CRITICAL_FIELDS = [
  "name",
  "status",
  "headline",
  "cta_copy",
  "plan_ids",
  "account_id",
] as const

/** Safe fallback values for optional/cosmetic paywall fields.
 *  Used when a column is absent from the DB row (null or missing key). */
export const PAYWALL_DEFAULTS: Record<string, unknown> = {
  // Block system (migration 018)
  blocks:       [],
  display_mode: "modal",
  template_id:  null,
  // Design
  animation_style:        "slide",
  button_shape:           "rounded",
  font_family:            "system",
  overlay_opacity:        65,
  // Chameleon
  theme_mode:             "auto",
  adapt_font:             true,
  adapt_colors:           true,
  adapt_radius:           true,
  // Content
  body_copy:              null,
  footer_text:            "Cancel anytime · No hidden fees",
  guarantee_text:         null,
  urgency_text:           null,
  urgency_end_date:       null,
  show_countdown:         false,
  trust_badges:           [],
  social_proof_type:      "text",
  // Pricing
  show_yearly_toggle:     true,
  yearly_discount_percent: 20,
  currency:               "USD",
  show_trial_in_cta:      false,
  // Locale
  locale:                 "en",
  localizations:          {},
  auto_detect_locale:     true,
  // Advanced
  custom_css:             null,
  success_redirect_url:   null,
  hide_powered_by:        false,
}

/**
 * Merges safe defaults into a paywall object for any null/undefined optional
 * fields. Call this whenever reading a paywall row so the UI never crashes on
 * a schema that is behind on migrations.
 */
export function withDefaults<T extends Record<string, unknown>>(paywall: T): T {
  const result = { ...paywall }
  for (const [key, fallback] of Object.entries(PAYWALL_DEFAULTS)) {
    if (result[key] === null || result[key] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = fallback
    }
  }
  return result
}

type SaveOk<T>  = { data: T; droppedFields: string[]; error?: never }
type SaveErr    = { data?: never; droppedFields?: never; error: { message: string } }
type SaveResult<T> = SaveOk<T> | SaveErr

/**
 * Resilient paywall UPDATE.
 *
 * Tries `supabase.from("paywalls").update(payload).eq("id", paywallId)`.
 * If PostgREST replies with a missing-column error (PGRST204 / "Could not find
 * the 'X' column"), the field is dropped from the payload and the request is
 * retried automatically — as long as 'X' is not in CRITICAL_FIELDS.
 *
 * Returns `droppedFields` so the caller can show an informative (non-blocking)
 * toast to the user.
 */
export async function savePaywallResilient<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  paywallId: string,
  payload: Record<string, unknown>,
): Promise<SaveResult<T>> {
  const body = { ...payload }
  const dropped: string[] = []
  const MAX_ATTEMPTS = 25 // enough for all optional columns

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("paywalls")
      .update(body)
      .eq("id", paywallId)
      .select()
      .single()

    if (!error) return { data: data as T, droppedFields: dropped }

    // Match "Could not find the 'animation_style' column of 'paywalls' in the schema cache"
    const colMatch =
      error.message?.match(/Could not find the '([a-z_]+)' column/i) ??
      error.message?.match(/'([a-z_]+)' column of '(?:paywalls)'/i)
    const missingCol = colMatch?.[1]

    if (missingCol && missingCol in body) {
      if ((CRITICAL_FIELDS as readonly string[]).includes(missingCol)) {
        return {
          error: {
            message: `Required field '${missingCol}' is missing from the database. Please run migrations.`,
          },
        }
      }
      console.warn(`[Hatch] Column '${missingCol}' not found in DB schema — dropping it and retrying`)
      dropped.push(missingCol)
      delete body[missingCol]
      continue
    }

    // Non-recoverable error (permissions, network, critical field, etc.)
    return { error: { message: error.message ?? "Save failed" } }
  }

  return { error: { message: "Too many missing columns — please update your database schema." } }
}
