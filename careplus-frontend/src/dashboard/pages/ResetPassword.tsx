import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { AlertCircle, CheckCircle2, Cross, Eye, EyeOff, Lock, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { api, type ApiError } from "@/lib/api"

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") || ""

  const [verifying, setVerifying] = React.useState(true)
  const [tokenValid, setTokenValid] = React.useState(false)
  const [tokenError, setTokenError] = React.useState("")
  const [accountEmail, setAccountEmail] = React.useState("")

  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showNew, setShowNew] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [resetSuccess, setResetSuccess] = React.useState(false)
  const [formError, setFormError] = React.useState("")

  React.useEffect(() => {
    if (!token) {
      setVerifying(false)
      setTokenValid(false)
      setTokenError("No reset token provided. Please request a new password reset link.")
      return
    }

    let active = true
    api
      .verifyResetToken(token)
      .then((res) => {
        if (!active) return
        setTokenValid(true)
        setAccountEmail(res.email || "")
      })
      .catch((err) => {
        if (!active) return
        setTokenValid(false)
        setTokenError(
          (err as ApiError).message ||
            "This password reset link is invalid, has already been used, or has expired."
        )
      })
      .finally(() => {
        if (active) setVerifying(false)
      })

    return () => {
      active = false
    }
  }, [token])

  const hasLength = newPassword.length >= 8
  const hasUpper = /[A-Z]/.test(newPassword)
  const hasLower = /[a-z]/.test(newPassword)
  const hasNumber = /[0-9]/.test(newPassword)
  const hasSpecial = /[^a-zA-Z0-9]/.test(newPassword)
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword
  const isPolicySatisfied = hasLength && hasUpper && hasLower && hasNumber && hasSpecial

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError("")

    if (!isPolicySatisfied) {
      setFormError("Password does not meet all security policy requirements.")
      return
    }
    if (!passwordsMatch) {
      setFormError("New password and confirm password do not match.")
      return
    }

    setSubmitting(true)
    try {
      await api.resetPassword({ token, newPassword })
      setResetSuccess(true)
    } catch (err) {
      setFormError((err as ApiError).message || "Failed to reset password. The link may have expired.")
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
          <p className="text-sm text-[var(--cp-ink-soft)]">Set New Account Password</p>
        </div>

        <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-6 cp-shadow sm:p-8">
          {verifying ? (
            <div className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--cp-primary)] border-t-transparent" />
              Verifying security token...
            </div>
          ) : !tokenValid ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
                <AlertCircle className="h-8 w-8" />
              </div>
              <h2 className="mb-2 text-lg font-bold text-[var(--cp-ink)]">Invalid Reset Link</h2>
              <p className="mb-6 text-sm text-[var(--cp-ink-soft)]">{tokenError}</p>
              <Link to="/dashboard/forgot-password">
                <Button className="w-full">Request New Reset Link</Button>
              </Link>
            </div>
          ) : resetSuccess ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="mb-2 text-lg font-bold text-[var(--cp-ink)]">Password Reset Complete!</h2>
              <p className="mb-6 text-sm text-[var(--cp-ink-soft)]">
                Your account password has been updated securely. You can now sign in using your new credentials.
              </p>
              <Link to="/dashboard/login">
                <Button className="w-full">
                  <LogIn className="h-4 w-4 mr-2" /> Sign In to Portal
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-[var(--cp-ink)]">Create New Password</h2>
                {accountEmail && (
                  <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">
                    Setting new password for account: <strong className="text-[var(--cp-ink)]">{accountEmail}</strong>
                  </p>
                )}
              </div>

              {formError && (
                <div className="mb-4 rounded-lg bg-[var(--cp-critical-light)] p-3 text-xs font-medium text-[var(--cp-critical)] border border-[var(--cp-critical)]">
                  {formError}
                </div>
              )}

              <div className="mb-4">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-10 pr-10"
                    placeholder="Enter new password"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--cp-ink-soft)] hover:text-[var(--cp-ink)]"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="mb-4 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] p-3 text-xs">
                <p className="mb-2 font-semibold text-[var(--cp-ink)]">Password Policy Requirements:</p>
                <ul className="space-y-1">
                  <li className={cn("flex items-center gap-1.5", hasLength ? "font-medium text-emerald-600" : "text-[var(--cp-ink-soft)]")}>
                    {hasLength ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                    At least 8 characters
                  </li>
                  <li className={cn("flex items-center gap-1.5", hasUpper ? "font-medium text-emerald-600" : "text-[var(--cp-ink-soft)]")}>
                    {hasUpper ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                    One uppercase letter (A-Z)
                  </li>
                  <li className={cn("flex items-center gap-1.5", hasLower ? "font-medium text-emerald-600" : "text-[var(--cp-ink-soft)]")}>
                    {hasLower ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                    One lowercase letter (a-z)
                  </li>
                  <li className={cn("flex items-center gap-1.5", hasNumber ? "font-medium text-emerald-600" : "text-[var(--cp-ink-soft)]")}>
                    {hasNumber ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                    One number (0-9)
                  </li>
                  <li className={cn("flex items-center gap-1.5", hasSpecial ? "font-medium text-emerald-600" : "text-[var(--cp-ink-soft)]")}>
                    {hasSpecial ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                    One special character (!@#$%^&*...)
                  </li>
                </ul>
              </div>

              <div className="mb-6">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 pr-10"
                    placeholder="Repeat new password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--cp-ink-soft)] hover:text-[var(--cp-ink)]"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && (
                  <p className={cn("mt-1.5 text-xs font-medium", passwordsMatch ? "text-emerald-600" : "text-[var(--cp-critical)]")}>
                    {passwordsMatch ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={submitting || !isPolicySatisfied || !passwordsMatch}
              >
                {submitting ? "Saving New Password..." : "Save New Password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
