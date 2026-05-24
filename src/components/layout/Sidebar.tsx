"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard, CreditCard, Layers, Users, BarChart2,
  Settings, Mail, LogOut, Zap, ChevronRight, BookOpen, Brain, TrendingUp
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/integrate", label: "Install", icon: Zap },
  { href: "/paywalls", label: "Paywalls", icon: Layers },
  { href: "/plans", label: "Plans", icon: CreditCard },
  { href: "/pricing", label: "Pricing", icon: TrendingUp },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/recovery", label: "Recovery", icon: Mail, comingSoon: true },
  { href: "/agent", label: "AI Agent", icon: Brain },
] as const

export default function Sidebar({ appName }: { appName?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[220px] bg-[#0D0D0F] border-r border-white/6 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/6 flex items-center gap-2.5">
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-white" />
        </div>
        <div>
          <span className="font-heading font-bold text-sm text-white">Hatch</span>
          {appName && <p className="text-[10px] text-[#52525B] truncate max-w-[120px]">{appName}</p>}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon, ...rest }) => {
          const comingSoon = "comingSoon" in rest && rest.comingSoon
          const active = !comingSoon && (pathname === href || (href !== "/dashboard" && pathname.startsWith(href)))

          if (comingSoon) {
            return (
              <div
                key={href}
                title="Coming soon"
                className="relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-[#3F3F46] cursor-default select-none"
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
                <span className="ml-auto text-[9px] font-semibold tracking-wide px-1.5 py-0.5 bg-white/5 border border-white/8 text-[#52525B] rounded-full uppercase">
                  Soon
                </span>
              </div>
            )
          }

          return (
            <Link key={href} href={href} className={cn(
              "relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all group",
              active ? "text-white" : "text-[#71717A] hover:text-[#A1A1AA] hover:bg-white/4"
            )}>
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-white/6 rounded-lg"
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
              <Icon className={cn("w-4 h-4 relative z-10 flex-shrink-0", active ? "text-indigo-400" : "")} />
              <span className="relative z-10">{label}</span>
              {active && <ChevronRight className="w-3 h-3 ml-auto relative z-10 text-[#52525B]" />}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 space-y-0.5 border-t border-white/6 pt-3">
        <Link href="/settings/project-brief" className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
          pathname === "/settings/project-brief" ? "text-white bg-white/6" : "text-[#71717A] hover:text-[#A1A1AA] hover:bg-white/4"
        )}>
          <BookOpen className="w-4 h-4" />
          Project Brief
        </Link>
        <Link href="/settings" className={cn(
          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
          pathname === "/settings" ? "text-white bg-white/6" : "text-[#71717A] hover:text-[#A1A1AA] hover:bg-white/4"
        )}>
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-[#71717A] hover:text-red-400 hover:bg-red-500/5 transition-all">
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
