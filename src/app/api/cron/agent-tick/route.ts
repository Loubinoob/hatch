import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

// Nightly cron — runs at 03:00 UTC via Vercel cron
// Protected by CRON_SECRET header
export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Find all live paywalls that had ≥ 50 events in the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: activePaywalls } = await service
    .from("events")
    .select("paywall_id")
    .gte("created_at", since)
    .not("paywall_id", "is", null)

  if (!activePaywalls?.length) {
    return NextResponse.json({ ok: true, message: "No active paywalls in last 24h" })
  }

  // Count events per paywall
  const counts: Record<string, number> = {}
  for (const e of activePaywalls) {
    if (e.paywall_id) counts[e.paywall_id] = (counts[e.paywall_id] ?? 0) + 1
  }

  const qualifiedPaywallIds = Object.entries(counts)
    .filter(([, c]) => c >= 50)
    .map(([id]) => id)

  if (!qualifiedPaywallIds.length) {
    return NextResponse.json({ ok: true, message: "No paywalls with ≥ 50 events in last 24h" })
  }

  // Idempotency — skip paywalls already reflected since midnight
  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  const { data: alreadyRun } = await service
    .from("agent_runs")
    .select("paywall_id")
    .eq("run_type", "reflection")
    .in("paywall_id", qualifiedPaywallIds)
    .gte("created_at", midnight.toISOString())

  const alreadyRunIds = new Set((alreadyRun ?? []).map(r => r.paywall_id))
  const toProcess = qualifiedPaywallIds.filter(id => !alreadyRunIds.has(id))

  const results: { paywall_id: string; status: string; error?: string }[] = []
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? ""

  for (const paywallId of toProcess) {
    try {
      // Get an auth cookie isn't available in cron — use service role directly
      // Call the reflect logic inline instead of via HTTP
      const res = await fetch(`${origin}/api/agent/reflect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({ paywall_id: paywallId, _cron: true }),
      })
      const data = await res.json()
      results.push({
        paywall_id: paywallId,
        status: res.ok ? "ok" : "failed",
        error: res.ok ? undefined : data.error,
      })
    } catch (err) {
      results.push({
        paywall_id: paywallId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    skipped: alreadyRunIds.size,
    results,
  })
}
