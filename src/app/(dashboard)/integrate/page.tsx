import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import IntegrateClient from "./IntegrateClient"

export default async function IntegratePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("users")
    .select("account_id")
    .eq("id", user.id)
    .single()

  const accountId = profile?.account_id
  const service = createServiceClient()

  const [{ data: account }, { data: paywalls }] = await Promise.all([
    service.from("accounts").select("api_key, last_heartbeat_at").eq("id", accountId).single(),
    service.from("paywalls").select("id, name, status").eq("account_id", accountId).order("created_at", { ascending: false }),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (
    typeof window !== "undefined" ? window.location.origin : "https://hatch-five-gamma.vercel.app"
  )

  return (
    <IntegrateClient
      apiKey={account?.api_key ?? "pk_live_..."}
      appUrl={appUrl}
      paywalls={paywalls ?? []}
      lastHeartbeat={account?.last_heartbeat_at ?? null}
    />
  )
}
