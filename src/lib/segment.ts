/**
 * Segment hashing — the foundation of the contextual bandit.
 * All values are bucketed into discrete categories to avoid
 * the curse of dimensionality (no unique per-user segments).
 */

export interface SegmentInput {
  quiz_answers?: Record<string, string>   // { q1_role: "developer", q2_intent: "high" }
  utm_source?: string | null
  utm_campaign?: string | null
  device?: "mobile" | "desktop" | "tablet"
  returning?: boolean
  country?: string | null
  hour_bucket?: "morning" | "afternoon" | "evening" | "night"
}

const UTM_BUCKETS: Record<string, string> = {
  twitter: "social",   x: "social",       linkedin: "social",
  facebook: "social",  instagram: "social", tiktok: "social",
  google: "paid",      bing: "paid",       facebook_ads: "paid",
  newsletter: "email", substack: "email",  mailchimp: "email",
  referral: "referral", partner: "referral",
  organic: "organic",  direct: "direct",
}

export function bucketUtm(source?: string | null): string {
  if (!source) return "direct"
  return UTM_BUCKETS[source.toLowerCase()] ?? "other"
}

export function bucketHour(date = new Date()): SegmentInput["hour_bucket"] {
  const h = date.getHours()
  if (h < 6)  return "night"
  if (h < 12) return "morning"
  if (h < 18) return "afternoon"
  return "evening"
}

/**
 * Pricing-specific segment hash — only hashes the variables the scientist has
 * validated as price-discriminating. Returns "global" when activeKeys is empty
 * so all traffic is pooled into a single posterior row.
 *
 * Variable name mapping (matches pricing_variable_importance.variable_name):
 *   "utm_source"   → bucketUtm(input.utm_source)
 *   "device_type"  → input.device ?? "desktop"
 *   "is_returning" → String(input.returning ?? false)
 *   "country"      → input.country ?? "unknown"
 *   "q_<key>"      → input.quiz_answers[key]  (e.g. "q_role")
 */
export function computePricingSegmentHash(
  input: SegmentInput,
  activeKeys: string[],
): string {
  if (!activeKeys.length) return "global"

  const parts: string[] = []

  for (const key of activeKeys.sort()) {
    let value: string | undefined

    if (key === "utm_source") {
      value = bucketUtm(input.utm_source)
    } else if (key === "device_type") {
      value = input.device ?? "desktop"
    } else if (key === "is_returning") {
      value = String(input.returning ?? false)
    } else if (key === "country") {
      value = input.country ?? "unknown"
    } else if (key.startsWith("q_")) {
      const qKey = key.slice(2)  // strip "q_" prefix
      value = input.quiz_answers?.[qKey] ?? "unknown"
    }

    if (value !== undefined) {
      parts.push(`${key}=${value}`)
    }
  }

  return parts.length ? parts.join("|") : "global"
}

export function computeSegmentHash(input: SegmentInput): {
  hash: string
  features: Record<string, string | boolean>
} {
  const features: Record<string, string | boolean> = {}

  // Quiz answers carry the highest signal — they're user-declared intent
  if (input.quiz_answers) {
    for (const [k, v] of Object.entries(input.quiz_answers)) {
      features[`q_${k}`] = v
    }
  }

  features.utm      = bucketUtm(input.utm_source)
  features.device   = input.device ?? "desktop"
  features.returning = input.returning ?? false
  features.hour     = input.hour_bucket ?? "afternoon"
  // Country is high-cardinality — skip for MVP unless explicitly needed

  // Stable hash: sort keys, concatenate, use as lookup key
  const sorted = Object.keys(features)
    .sort()
    .map(k => `${k}=${features[k]}`)
    .join("|")

  return { hash: sorted, features }
}
