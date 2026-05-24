import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * GET /api/debug/schema-check?secret=<SCHEMA_CHECK_SECRET>
 *
 * Verifies that all tables and columns required by the dynamic pricing +
 * segmentation features exist in the production database. Run this after
 * deploying to diagnose "Could not find column X" errors in 2 seconds.
 *
 * Protected by SCHEMA_CHECK_SECRET env var (or CRON_SECRET as fallback).
 * Safe to call from Vercel or the browser — never mutates anything.
 *
 * Response:
 *   { ok: true,  all_present: true,  checks: [...] }
 *   { ok: false, all_present: false, missing: [...], checks: [...] }
 */

export const dynamic = "force-dynamic"

interface Check {
  name: string
  type: "table" | "column"
  present: boolean
  detail?: string
}

async function tableExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  table: string,
): Promise<boolean> {
  try {
    const { error } = await service.from(table).select("*", { count: "exact", head: true }).limit(0)
    // No error → table exists; PGRST error with "relation" → missing
    if (!error) return true
    if (error.message?.includes("relation") || error.message?.includes("does not exist")) return false
    // Any other error (RLS, etc.) still means the table exists
    return true
  } catch {
    return false
  }
}

async function columnExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  table: string,
  column: string,
): Promise<boolean> {
  try {
    // Select just that column; if it doesn't exist PostgREST returns PGRST204
    const { error } = await service.from(table).select(column, { count: "exact", head: true }).limit(0)
    if (!error) return true
    if (
      error.message?.includes(`Could not find the '${column}'`) ||
      error.message?.includes("column") ||
      error.code === "PGRST204"
    ) return false
    return true
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  // Auth guard
  const secret = request.nextUrl.searchParams.get("secret")
  const expected = process.env.SCHEMA_CHECK_SECRET ?? process.env.CRON_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const checks: Check[] = []

  // ── Required tables ────────────────────────────────────────────────────────
  const requiredTables = [
    // Core
    "accounts", "users", "paywalls", "plans", "events", "subscriptions",
    // A/B + quiz
    "paywall_variants", "paywall_quizzes", "quiz_responses",
    "variant_assignments", "variant_segment_posteriors",
    // Dynamic pricing (migration 009)
    "plan_price_candidates", "price_point_posteriors",
    // Behavioural tracking (migration 010)
    "paywall_impressions",
    // Pricing intelligence (migration 011)
    "price_elasticity_snapshots", "pricing_variable_importance",
    "pricing_scientist_runs", "pricing_data_maturity",
    // Agent memory
    "agent_insights", "agent_runs",
  ]

  await Promise.all(
    requiredTables.map(async (table) => {
      const present = await tableExists(service, table)
      checks.push({ name: table, type: "table", present })
    })
  )

  // ── Required columns ───────────────────────────────────────────────────────
  const requiredColumns: { table: string; column: string }[] = [
    // Migration 006 — paywall V2
    { table: "paywalls", column: "animation_style" },
    { table: "paywalls", column: "body_copy" },
    { table: "paywalls", column: "social_proof_type" },
    // Migration 008 — chameleon
    { table: "paywalls", column: "theme_mode" },
    { table: "paywalls", column: "adapt_colors" },
    // Migration 009 — dynamic pricing
    { table: "plans", column: "dynamic_pricing_enabled" },
    { table: "plans", column: "price_floor_cents" },
    { table: "plans", column: "price_ceiling_cents" },
    { table: "variant_assignments", column: "price_candidate_id" },
    { table: "variant_assignments", column: "price_shown_cents" },
    // Migration 010 — tracking
    { table: "paywall_impressions", column: "scroll_depth_max" },
    // Migration 012 — simulation
    { table: "paywall_impressions", column: "is_synthetic" },
    // Migration 013 — active segmentation
    { table: "plans", column: "pricing_segment_keys" },
    { table: "variant_assignments", column: "pricing_segment_hash" },
    // Migration 007 — contextual bandit
    { table: "variant_assignments", column: "segment_hash" },
    { table: "paywall_quizzes", column: "trigger_mode" },
  ]

  await Promise.all(
    requiredColumns.map(async ({ table, column }) => {
      const present = await columnExists(service, table, column)
      checks.push({
        name: `${table}.${column}`,
        type: "column",
        present,
      })
    })
  )

  const missing = checks.filter(c => !c.present)
  const allPresent = missing.length === 0

  console.log(
    `[schema-check] ${checks.length} checks — ${allPresent ? "✅ all present" : `❌ ${missing.length} missing: ${missing.map(m => m.name).join(", ")}`}`
  )

  return NextResponse.json(
    {
      ok: allPresent,
      all_present: allPresent,
      checked_at: new Date().toISOString(),
      summary: allPresent
        ? `All ${checks.length} tables/columns present ✅`
        : `${missing.length} missing out of ${checks.length} — run: supabase db push`,
      missing: allPresent ? [] : missing.map(m => m.name),
      checks: checks.sort((a, b) => (a.present === b.present ? 0 : a.present ? 1 : -1)),
    },
    { status: allPresent ? 200 : 503 }
  )
}
