import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

// Runs every 6h via Vercel cron — reflects on paywalls with ≥ 30 new events
export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Find paywalls with ≥ 30 events in the last 6h
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: recentEvents } = await service
    .from("events")
    .select("paywall_id, account_id")
    .gte("created_at", since)
    .not("paywall_id", "is", null)

  if (!recentEvents?.length) {
    return NextResponse.json({ ok: true, message: "No events in last 6h" })
  }

  // Count events per paywall + map to account_id
  const counts: Record<string, { count: number; account_id: string }> = {}
  for (const e of recentEvents) {
    if (e.paywall_id) {
      if (!counts[e.paywall_id]) counts[e.paywall_id] = { count: 0, account_id: e.account_id ?? "" }
      counts[e.paywall_id].count++
    }
  }

  const qualifiedPaywallIds = Object.entries(counts)
    .filter(([, v]) => v.count >= 30)
    .map(([id]) => id)

  if (!qualifiedPaywallIds.length) {
    return NextResponse.json({ ok: true, message: "No paywalls with ≥ 30 events in last 6h" })
  }

  // Idempotency — skip paywalls already reflected in last 6h
  const { data: alreadyRun } = await service
    .from("agent_runs")
    .select("paywall_id")
    .eq("run_type", "reflection")
    .in("paywall_id", qualifiedPaywallIds)
    .gte("created_at", since)

  const alreadyRunIds = new Set((alreadyRun ?? []).map(r => r.paywall_id))
  const toProcess = qualifiedPaywallIds.filter(id => !alreadyRunIds.has(id))

  const results: { paywall_id: string; status: string; error?: string }[] = []
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? ""

  for (const paywallId of toProcess) {
    try {
      const accountId = counts[paywallId]?.account_id
      const res = await fetch(`${origin}/api/agent/reflect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({ paywall_id: paywallId, account_id: accountId, _cron: true }),
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
