import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import Sidebar from "@/components/layout/Sidebar"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("users")
    .select("onboarding_completed, accounts(app_name)")
    .eq("id", user.id)
    .single()

  if (!profile?.onboarding_completed) redirect("/onboarding")

  const appName = (profile?.accounts as { app_name?: string } | null)?.app_name

  return (
    <div className="flex h-screen bg-[#0A0A0B] overflow-hidden">
      <Sidebar appName={appName} />
      <main className="flex-1 ml-[220px] overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
