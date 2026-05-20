"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Loader2, Mail, Lock, ArrowRight, Check, Zap, AlertCircle } from "lucide-react"

type Mode = "magic" | "password" | "signup"

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>("magic")

  // Show error from callback redirect
  useEffect(() => {
    const err = searchParams.get("error")
    if (err) toast.error(decodeURIComponent(err))
  }, [])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  // ── Magic link ──────────────────────────────────────────────
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    setLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    setMagicSent(true)
  }

  // ── Email + password login ──────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      if (error.message.toLowerCase().includes("email not confirmed")) {
        toast.error("Please confirm your email first, or use the magic link option.")
      } else if (error.message.toLowerCase().includes("invalid login")) {
        toast.error("Wrong email or password.")
      } else {
        toast.error(error.message)
      }
      return
    }
    router.push("/dashboard")
  }

  // ── Signup ──────────────────────────────────────────────────
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
    setLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    if (data.session) {
      router.push("/onboarding")
      return
    }
    // Email confirmation required — offer magic link as fallback
    if (data.user) {
      toast.success("Account created! Check your email for a confirmation link, or use the magic link below.")
      setMode("magic")
      return
    }
    toast.error("An account with this email may already exist. Try signing in.")
  }

  // ── Google ──────────────────────────────────────────────────
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

  // ── Magic sent state ────────────────────────────────────────
  if (magicSent) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Mail className="w-6 h-6 text-indigo-400" />
          </div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-2">Check your inbox</h1>
          <p className="text-sm text-[#71717A] mb-6">
            We sent a sign-in link to <span className="text-white font-medium">{email}</span>.
            Click it to access your account — no password needed.
          </p>
          <div className="bg-[#111114] border border-white/6 rounded-xl p-4 mb-4 text-left">
            <p className="text-xs text-[#52525B] mb-3">Didn't receive it?</p>
            <ul className="text-xs text-[#71717A] space-y-1.5">
              <li>• Check your spam/junk folder</li>
              <li>• The link expires in 1 hour</li>
              <li>• Make sure you used the right email</li>
            </ul>
          </div>
          <button
            onClick={() => setMagicSent(false)}
            className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            ← Try a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <Link href="/" className="mb-10 flex items-center gap-2">
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="font-heading font-bold text-xl text-white">Hatch</span>
      </Link>

      <div className="w-full max-w-sm">
        <div className="bg-[#111114] border border-white/6 rounded-xl p-8">

          {/* Header */}
          <h1 className="font-heading text-2xl font-semibold text-white mb-1">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm text-[#71717A] mb-6">
            {mode === "signup"
              ? "Add a paywall to your app in minutes"
              : "Sign in to your Hatch account"}
          </p>

          {/* Google */}
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

          {/* Mode tabs */}
          <div className="flex gap-1 bg-white/4 rounded-lg p-1 mb-4">
            <button
              onClick={() => setMode("magic")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "magic"
                  ? "bg-[#111114] text-white shadow-sm border border-white/8"
                  : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Magic link
            </button>
            <button
              onClick={() => setMode("password")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "password"
                  ? "bg-[#111114] text-white shadow-sm border border-white/8"
                  : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              Password
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "signup"
                  ? "bg-[#111114] text-white shadow-sm border border-white/8"
                  : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Sign up
            </button>
          </div>

          {/* Magic link form */}
          {mode === "magic" && (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div className="bg-indigo-500/5 border border-indigo-500/15 rounded-lg px-3 py-2.5 flex items-start gap-2 mb-1">
                <Check className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-[#A1A1AA]">
                  Enter your email — we'll send a one-click link. No password, no confirmation required.
                </p>
              </div>
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="auth-input"
                />
              </div>
              <button type="submit" disabled={loading} className="auth-btn-primary w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Send magic link
              </button>
            </form>
          )}

          {/* Password login form */}
          {mode === "password" && (
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="auth-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="auth-input"
                />
              </div>
              <button type="submit" disabled={loading} className="auth-btn-primary w-full">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign in
              </button>
            </form>
          )}

          {/* Signup form */}
          {mode === "signup" && (
            <form onSubmit={handleSignup} className="space-y-3">
              <div>
                <label className="text-xs text-[#A1A1AA] mb-1.5 block">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Alex Johnson"
                  required
                  autoFocus
                  className="auth-input"
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
                  className="auth-input"
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
                  className="auth-input"
                />
              </div>
              <button type="submit" disabled={loading} className="auth-btn-primary w-full">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Create account
              </button>
              <p className="text-xs text-[#52525B] text-center">
                By signing up you agree to our Terms & Privacy Policy.
              </p>
            </form>
          )}
        </div>
      </div>

      <p className="text-xs text-[#3F3F46] mt-auto pt-8">© 2025 Hatch. All rights reserved.</p>

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
          transition: all 0.15s;
        }
        .auth-input::placeholder { color: #52525B; }
        .auth-input:focus {
          border-color: rgba(99,102,241,0.5);
          box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
        .auth-btn-primary {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          background: #6366F1; color: white; border: none;
          padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.15s; width: 100%;
        }
        .auth-btn-primary:hover:not(:disabled) { background: #5055E8; }
        .auth-btn-primary:disabled { opacity: 0.5; cursor: default; }
      `}</style>
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
