import * as React from "react"
import {
  DatabaseBackup,
  Download,
  RefreshCw,
  RotateCcw,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  FileArchive,
  Layers,
  Users,
  FileText,
  Calendar,
  Pill,
} from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal } from "@/dashboard/components/Primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, type ApiBackup, type ApiError } from "@/lib/api"
import { formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function BackupPage() {
  const { toast } = useToast()
  const [backups, setBackups] = React.useState<ApiBackup[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [restoreTarget, setRestoreTarget] = React.useState<ApiBackup | null>(null)
  const [password, setPassword] = React.useState("")
  const [restoreError, setRestoreError] = React.useState("")

  async function load() {
    setLoading(true)
    try {
      setBackups(await api.listBackups())
    } catch (error) {
      toast({
        title: "Unable to load backups",
        description: (error as ApiError).message,
        variant: "error",
      })
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function create() {
    setBusy(true)
    try {
      await api.createBackup()
      toast({
        title: "Backup created successfully",
        description: "Full snapshot including database, metadata manifest and uploaded files has been archived.",
        variant: "success",
      })
      await load()
    } catch (error) {
      toast({
        title: "Backup failed",
        description: (error as ApiError).message,
        variant: "error",
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function download(backup: ApiBackup) {
    try {
      const blob = await api.downloadBackup(backup.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = backup.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({
        title: "Download failed",
        description: (error as ApiError).message,
        variant: "error",
      })
    }
  }

  async function remove(backup: ApiBackup) {
    if (!window.confirm(`Are you sure you want to delete backup file: ${backup.filename}?`)) return
    try {
      await api.deleteBackup(backup.id)
      toast({ title: "Backup deleted", variant: "success" })
      await load()
    } catch (error) {
      toast({
        title: "Delete failed",
        description: (error as ApiError).message,
        variant: "error",
      })
    }
  }

  async function restore() {
    if (!restoreTarget || !password) return
    setBusy(true)
    setRestoreError("")
    try {
      const res = await api.restoreBackup(restoreTarget.id, password)
      toast({
        title: "Database restored successfully",
        description: (res as any)?.data?.message || "Data integrity verified. System is ready.",
        variant: "success",
      })
      setRestoreTarget(null)
      setPassword("")
      await load()
    } catch (error) {
      const msg = (error as ApiError).message || "Restore failed. Current data was preserved."
      setRestoreError(msg)
      toast({
        title: "Restore failed",
        description: msg,
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DashboardPageHeader
        title="Backup & Restore"
        action={
          <Button onClick={create} disabled={busy}>
            <DatabaseBackup className="h-4 w-4 mr-2" />
            {busy ? "Archiving..." : "Create Backup Now"}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 leading-relaxed">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold text-amber-950 mb-1">Replace vs. Merge Architecture</p>
            <p>
              Restoring a backup performs a <strong>complete atomic replacement</strong> of the database to guarantee relational integrity. It does <em>not</em> merge records, eliminating orphan entries and duplicate IDs.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-900 leading-relaxed">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          <div>
            <p className="font-semibold text-emerald-950 mb-1">Automatic Safety Backup</p>
            <p>
              Prior to executing any restore, the system automatically generates an immutable safety snapshot of current data and uploads. If any validation or database step fails, changes are rolled back automatically.
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] cp-shadow">
        <div className="flex items-center justify-between border-b border-[var(--cp-border)] px-5 py-4">
          <div>
            <h2 className="font-bold text-[var(--cp-ink)]">Available Hospital Backups</h2>
            <p className="text-xs text-[var(--cp-ink-soft)]">
              Full-fidelity bundles containing database SQL dump, schema manifest, and uploaded document attachments.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void load()} aria-label="Refresh backups">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading backups list...</p>
        ) : backups.length === 0 ? (
          <div className="p-12 text-center">
            <FileArchive className="mx-auto mb-3 h-10 w-10 text-[var(--cp-ink-faint)]" />
            <p className="text-sm font-medium text-[var(--cp-ink)]">No backups have been created yet.</p>
            <p className="text-xs text-[var(--cp-ink-soft)] mt-1">
              Click &ldquo;Create Backup Now&rdquo; to generate your first complete hospital archive.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--cp-border)]">
            {backups.map((backup) => {
              const manifest = backup.manifest
              const isSafety = backup.filename.includes("safety-backup")

              return (
                <div
                  key={backup.id}
                  className="flex flex-col gap-4 p-5 transition-colors hover:bg-[var(--cp-bg)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-all font-mono text-sm font-semibold text-[var(--cp-ink)]">
                        {backup.filename}
                      </p>
                      {isSafety && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          Safety Snapshot
                        </span>
                      )}
                      <span
                        className={
                          backup.status === "SUCCESS"
                            ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800"
                            : "rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800"
                        }
                      >
                        {backup.status === "SUCCESS" ? "Verified" : "Failed"}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">
                      {formatBytes(backup.sizeBytes)} &bull; Created {formatDateTime(backup.createdAt)}
                      {manifest?.version && ` &bull; Manifest v${manifest.version}`}
                    </p>

                    {manifest?.tableCounts && (
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--cp-ink-soft)]">
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          <Users className="h-3 w-3" /> {manifest.tableCounts.patients ?? 0} Patients
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          <Calendar className="h-3 w-3" /> {manifest.tableCounts.appointments ?? 0} Appts
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          <FileText className="h-3 w-3" /> {manifest.tableCounts.prescriptions ?? 0} Prescriptions
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          <Pill className="h-3 w-3" /> {manifest.tableCounts.pharmacyMedicines ?? 0} Medicines
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          <Layers className="h-3 w-3" /> {manifest.tableCounts.invoices ?? 0} Invoices
                        </span>
                        {Number(manifest.uploadedFilesCount) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                            {manifest.uploadedFilesCount} Uploaded Files
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void download(backup)}
                      disabled={backup.status !== "SUCCESS" || busy}
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRestoreTarget(backup)
                        setPassword("")
                        setRestoreError("")
                      }}
                      disabled={backup.status !== "SUCCESS" || busy}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5 text-amber-600" /> Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove(backup)}
                      disabled={busy}
                      aria-label={`Delete ${backup.filename}`}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--cp-critical)]" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        open={restoreTarget !== null}
        onClose={() => {
          if (!busy) setRestoreTarget(null)
        }}
        title="Confirm Database & Data Restore"
        description="Verify your administrator credentials before restoring this snapshot."
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold text-red-950 mb-1">
              <ShieldAlert className="h-4 w-4 text-red-600" />
              Destructive Operation Notice:
            </div>
            Current hospital database records will be replaced with the contents of{" "}
            <strong className="font-mono text-red-950">{restoreTarget?.filename}</strong>. An automatic safety backup
            of current data will be captured first. During restore, clinical access is locked.
          </div>

          {restoreError && (
            <div className="rounded-lg border border-red-300 bg-red-100 p-3 text-xs text-red-900">
              {restoreError}
            </div>
          )}

          <div>
            <Label htmlFor="restore-password">Administrator Password Confirmation</Label>
            <Input
              id="restore-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your admin password"
              autoComplete="current-password"
              className="mt-1"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="emergency" onClick={() => void restore()} disabled={busy || !password}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              {busy ? "Restoring Database..." : "Proceed with Restore"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}