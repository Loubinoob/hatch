import { createClient } from "@/lib/supabase/server"
import PaywallsClient from "./PaywallsClient"

export default async function PaywallsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .single()
  if (!profile) return null

  const accountId = profile.account_id

  const { data: paywalls } = await supabase
    .from("paywalls")
    .select("*")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })

  const paywallList = paywalls ?? []

  // COUNT per paywall using exact counts — avoids the 1000-row PostgREST default limit
  // and eliminates any client-side RLS ambiguity.
  const viewCounts = await Promise.all(
    paywallList.map(async (pw) => {
      const { count } = await supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("event_type", "paywall_shown")
        .eq("paywall_id", pw.id)
      return { id: pw.id, views: count ?? 0 }
    })
  )

  const paywallsWithViews = paywallList.map((pw) => ({
    ...pw,
    views: viewCounts.find((v) => v.id === pw.id)?.views ?? 0,
  }))

  return <PaywallsClient paywalls={paywallsWithViews} accountId={accountId} />
}
