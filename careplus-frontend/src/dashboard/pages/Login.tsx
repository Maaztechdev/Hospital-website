import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Cross, Mail, Lock, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDashboard } from "@/dashboard/store/useDashboard"
import { ROLE_ROUTES } from "@/dashboard/nav"
import type { Role } from "@/dashboard/types"
import { api, setSession, type ApiError } from "@/lib/api"

const ROLE_MAP = {
  ADMIN: "admin",
  RECEPTIONIST: "receptionist",
  DOCTOR: "doctor",
  LAB_TECHNICIAN: "lab_technician",
  PATHOLOGIST: "pathologist",
  ULTRASOUND_TECH: "ultrasound_tech",
  ULTRASOUND_TECHNICIAN: "ultrasound_technician",
  RADIOLOGIST: "radiologist",
  PHARMACIST: "pharmacist",
  NURSE: "nurse",
} as const

export default function Login() {
  const { dispatch } = useDashboard()
  const navigate = useNavigate()
  const location = useLocation()
  const loginState = location.state as { sessionExpired?: boolean; returnTo?: string } | null
  const returnTo = loginState?.returnTo?.startsWith("/dashboard/")
    && loginState.returnTo !== "/dashboard/login"
    ? loginState.returnTo
    : null
  const [email, setEmail] = React.useState("admin@careplus.local")
  const [password, setPassword] = React.useState("")
  const [errors, setErrors] = React.useState<{ email?: string; password?: string; form?: string }>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email address"
    if (password.length < 8) next.password = "Password must be at least 8 characters"
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      const result = await api.login(email, password)
      setSession(result)
      const role = ROLE_MAP[result.user.role] as Role
      dispatch({ type: "LOGIN", user: { id: result.user.id, name: result.user.name, email: result.user.email, role } })
      navigate(returnTo ?? ROLE_ROUTES[role], { replace: true })
    } catch (error) {
      setErrors({ form: (error as ApiError).message || "Sign in failed" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cp-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--cp-primary)] text-white">
            <Cross className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-bold text-[var(--cp-ink)]">Khalida Medicare Hospital</h1>
          <p className="text-sm text-[var(--cp-ink-soft)]">Staff &amp; Admin Portal</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-6 cp-shadow">
          {loginState?.sessionExpired && <p role="alert" className="mb-4 rounded-lg bg-[var(--cp-warning-light)] px-3 py-2 text-sm font-medium text-[var(--cp-warning)]">Session expired, please sign in again</p>}
          <div className="mb-4">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={!!errors.email} className="pl-10" placeholder="you@khalida.pk" />
            </div>
            {errors.email && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.email}</p>}
          </div>

          <div className="mb-5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={!!errors.password} className="pl-10" placeholder="••••••••" />
            </div>
            {errors.password && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.password}</p>}
          </div>

          {errors.form && <p className="mb-4 rounded-lg bg-[var(--cp-critical-light)] px-3 py-2 text-xs font-medium text-[var(--cp-critical)]">{errors.form}</p>}

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            <LogIn className="h-4 w-4" /> Sign in to dashboard
          </Button>
        </form>
      </div>
    </div>
  )
}
