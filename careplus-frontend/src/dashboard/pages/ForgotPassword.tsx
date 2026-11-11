import * as React from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, CheckCircle2, Cross, Mail, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, type ApiError } from "@/lib/api"

export default function ForgotPassword() {
  const [email, setEmail] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const [error, setError] = React.useState("")
  const [devToken, setDevToken] = React.useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Please enter a valid email address.")
      return
    }

    setSubmitting(true)
    try {
      const res = await api.forgotPassword(email.trim())
      setSubmitted(true)
      if (res.devResetToken) {
        setDevToken(res.devResetToken)
      }
    } catch (err) {
      setError((err as ApiError).message || "Unable to request password reset. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cp-bg)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--cp-primary)] text-white shadow-md">
            <Cross className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-bold text-[var(--cp-ink)]">Khalida Medicare Hospital</h1>
          <p className="text-sm text-[var(--cp-ink-soft)]">Account Security &amp; Password Recovery</p>
        </div>

        <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-6 cp-shadow sm:p-8">
          {submitted ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="mb-2 text-lg font-bold text-[var(--cp-ink)]">Check Your Email</h2>
              <p className="mb-6 text-sm text-[var(--cp-ink-soft)] leading-relaxed">
                If an active staff or doctor account is registered with <strong className="text-[var(--cp-ink)]">{email}</strong>, a secure, time-limited reset link has been dispatched.
              </p>

              {devToken && (
                <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-left text-xs text-blue-900">
                  <p className="font-semibold text-blue-950 mb-1">Development Mode Reset Link:</p>
                  <p className="mb-2 text-blue-800">
                    SMTP is not required for testing. You can proceed with the generated reset token directly:
                  </p>
                  <Link
                    to={`/dashboard/reset-password?token=${devToken}`}
                    className="inline-block font-semibold text-[var(--cp-primary)] underline hover:text-[var(--cp-primary-dark)] break-all"
                  >
                    Open Reset Password Form &rarr;
                  </Link>
                </div>
              )}

              <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-bg)] p-4 text-xs text-[var(--cp-ink-soft)] text-left mb-6">
                <p className="font-semibold text-[var(--cp-ink)] mb-1">Didn't receive an email?</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Check your spam or junk folder.</li>
                  <li>Ensure the email address was entered correctly.</li>
                  <li>Reset links expire after 30 minutes for security.</li>
                </ul>
              </div>

              <Link to="/dashboard/login">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-[var(--cp-ink)]">Forgot Password</h2>
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">
                  Enter your hospital account email address. We'll send you a single-use verification link to reset your password.
                </p>
              </div>

              {error && (
                <div className="mb-4 rounded-lg bg-[var(--cp-critical-light)] p-3 text-xs font-medium text-[var(--cp-critical)] border border-[var(--cp-critical)]">
                  {error}
                </div>
              )}

              <div className="mb-6">
                <Label htmlFor="reset-email">Registered Email Address</Label>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
                  <Input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    placeholder="doctor@khalida.pk"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                <Send className="h-4 w-4 mr-2" />
                {submitting ? "Sending Reset Link..." : "Send Reset Link"}
              </Button>

              <div className="mt-6 text-center">
                <Link
                  to="/dashboard/login"
                  className="inline-flex items-center text-xs font-medium text-[var(--cp-ink-soft)] hover:text-[var(--cp-primary)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
