"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }
    // Session present → auto-confirmed, go straight to onboarding
    if (data.session) {
      router.push("/onboarding")
      return
    }
    // User present but no session → email confirmation required
    if (data.user) {
      toast.success("Check your email to confirm your account!")
      setLoading(false)
      return
    }
    // data.user is null → email already registered (Supabase hides this for security)
    toast.error("An account with this email may already exist. Try signing in.")
    setLoading(false)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      toast.error(error.message)
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4">
      <Link href="/" className="mb-10">
        <span className="font-heading font-bold text-2xl gradient-text">Hatch</span>
      </Link>

      <div className="w-full max-w-sm">
        <div className="bg-[#111114] border border-white/6 rounded-xl p-8">
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">Get started free</h1>
          <p className="text-sm text-[#71717A] mb-6">Add a paywall to your app in minutes</p>

          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 bg-white/5 hover:bg-white/8 border border-white/10 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 mb-4"
          >
            {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </button>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/6" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#111114] px-3 text-[#52525B]">or</span>
            </div>
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            <div>
              <label className="text-xs text-[#A1A1AA] mb-1.5 block">Full name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alex Johnson"
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#52525B] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-[#A1A1AA] mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#52525B] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-[#A1A1AA] mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#52525B] focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500/50 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 mt-1"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create account
            </button>
          </form>

          <p className="text-xs text-[#52525B] text-center mt-4">
            By signing up you agree to our Terms & Privacy Policy.
          </p>
        </div>

        <p className="text-center text-sm text-[#52525B] mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-400 hover:text-indigo-300 transition-colors">
            Sign in
          </Link>
        </p>
      </div>

      <p className="text-xs text-[#3F3F46] mt-auto pt-8">© 2025 Hatch. All rights reserved.</p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
