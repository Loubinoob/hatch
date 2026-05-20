import { createClient } from "@/lib/supabase/server"
import { formatMoney, formatPercent } from "@/lib/utils"
import DashboardClient from "./DashboardClient"

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("users")
    .select("account_id, accounts(app_name)")
    .eq("id", user.id)
    .single()

  const accountId = profile?.account_id

  // MRR — sum of active subscriptions this month
  const { data: activeSubs } = await supabase
    .from("subscriptions")
    .select("amount_cents, interval")
    .eq("account_id", accountId)
    .eq("status", "active")

  const mrr = (activeSubs ?? []).reduce((sum, s) => {
    return sum + (s.interval === "year" ? Math.round(s.amount_cents / 12) : s.amount_cents)
  }, 0)

  // Conversions this month
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const { count: conversions } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("event_type", "payment_success")
    .gte("created_at", monthStart)

  // Paywall views this month
  const { count: paywallViews } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("event_type", "paywall_shown")
    .gte("created_at", monthStart)

  const conversionRate = paywallViews ? ((conversions ?? 0) / paywallViews) * 100 : 0

  // Active subscribers
  const { count: activeSubscribers } = await supabase
    .from("subscribers")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("subscription_status", "active")

  // Recent events for live feed
  const { data: recentEvents } = await supabase
    .from("events")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(20)

  // Recent customers
  const { data: recentCustomers } = await supabase
    .from("subscribers")
    .select("*, plans(name)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(5)

  // MRR chart data — last 90 days
  const { data: subHistory } = await supabase
    .from("subscriptions")
    .select("created_at, amount_cents, interval")
    .eq("account_id", accountId)
    .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true })

  // Build daily cumulative MRR
  const days: { date: string; mrr: number }[] = []
  let runningMrr = 0
  const subsByDay = new Map<string, number>()
  for (const s of subHistory ?? []) {
    const day = s.created_at.slice(0, 10)
    const monthlyAmt = s.interval === "year" ? Math.round(s.amount_cents / 12) : s.amount_cents
    subsByDay.set(day, (subsByDay.get(day) ?? 0) + monthlyAmt)
  }
  for (let i = 89; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    runningMrr += subsByDay.get(key) ?? 0
    days.push({ date: key, mrr: runningMrr })
  }

  // Top paywall
  const { data: topPaywall } = await supabase
    .from("paywalls")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "live")
    .order("conversions", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Setup checklist data
  const [
    { data: stripeConn },
    { count: planCount },
    { data: brief },
    { data: account },
    { count: paywallCount },
  ] = await Promise.all([
    supabase.from("stripe_connections").select("id").eq("account_id", accountId).maybeSingle(),
    supabase.from("plans").select("*", { count: "exact", head: true }).eq("account_id", accountId),
    supabase.from("project_briefs").select("completed_at").eq("account_id", accountId).maybeSingle(),
    supabase.from("accounts").select("last_heartbeat_at").eq("id", accountId).single(),
    supabase.from("paywalls").select("*", { count: "exact", head: true }).eq("account_id", accountId),
  ])

  const checklist = {
    stripe: !!stripeConn,
    plan: (planCount ?? 0) > 0,
    brief: !!brief?.completed_at,
    sdk: !!account?.last_heartbeat_at,
    paywall: (paywallCount ?? 0) > 0,
  }

  const appName = (profile?.accounts as { app_name?: string } | null)?.app_name ?? "your app"

  return (
    <DashboardClient
      appName={appName}
      mrr={mrr}
      conversions={conversions ?? 0}
      conversionRate={conversionRate}
      activeSubscribers={activeSubscribers ?? 0}
      recentEvents={recentEvents ?? []}
      recentCustomers={recentCustomers ?? []}
      mrrChartData={days}
      topPaywall={topPaywall}
      checklist={checklist}
      lastHeartbeat={account?.last_heartbeat_at ?? null}
    />
  )
}
