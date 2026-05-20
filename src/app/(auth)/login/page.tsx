"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Loader2, Zap } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [isSignup, setIsSignup] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    if (isSignup) {
      // Create account via server route (auto-confirms email, no email sent)
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create account")
        setLoading(false)
        return
      }
    }

    // Sign in (works for both new signup and existing login)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      toast.error(error.message)
      return
    }

    // Check onboarding status
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from("users")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle()
      if (!profile?.onboarding_completed) {
        router.push("/onboarding")
        return
      }
    }
    router.push("/dashboard")
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="font-heading font-bold text-xl text-white">Hatch</span>
      </div>

      <div className="w-full max-w-sm">
        <div className="bg-[#111114] border border-white/6 rounded-xl p-8">
          <h1 className="font-heading text-xl font-semibold text-white mb-1">
            {isSignup ? "Créer un compte" : "Se connecter"}
          </h1>
          <p className="text-sm text-[#71717A] mb-6">
            {isSignup ? "Accédez à Hatch en quelques secondes" : "Bon retour sur Hatch"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            {isSignup && (
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Nom</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Alex Johnson"
                  className="auth-input"
                  autoFocus
                />
              </div>
            )}
            <div>
              <label className="text-xs text-[#A1A1AA] mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus={!isSignup}
                className="auth-input"
              />
            </div>
            <div>
              <label className="text-xs text-[#A1A1AA] mb-1.5 block">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="auth-input"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors mt-1"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignup ? "Créer mon compte" : "Se connecter"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-[#52525B] mt-4">
          {isSignup ? "Déjà un compte ?" : "Pas encore de compte ?"}{" "}
          <button
            onClick={() => setIsSignup(v => !v)}
            className="text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {isSignup ? "Se connecter" : "Créer un compte"}
          </button>
        </p>
      </div>

      <style jsx global>{`
        .auth-input {
          width: 100%;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 14px;
          color: white;
          outline: none;
          transition: border-color 0.15s;
        }
        .auth-input::placeholder { color: #52525B; }
        .auth-input:focus {
          border-color: rgba(99,102,241,0.6);
          box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
      `}</style>
    </div>
  )
}
