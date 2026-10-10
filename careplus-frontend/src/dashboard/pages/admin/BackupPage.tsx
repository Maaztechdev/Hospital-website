import * as React from "react"
import { DatabaseBackup, Download, RefreshCw, RotateCcw, Trash2, AlertTriangle } from "lucide-react"
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

  async function load() {
    setLoading(true)
    try { setBackups(await api.listBackups()) } catch (error) { toast({ title: "Unable to load backups", description: (error as ApiError).message, variant: "error" }) } finally { setLoading(false) }
  }

  React.useEffect(() => { void load() }, [])

  async function create() {
    setBusy(true)
    try { await api.createBackup(); toast({ title: "Backup created", variant: "success" }); await load() }
    catch (error) { toast({ title: "Backup failed", description: (error as ApiError).message, variant: "error" }); await load() }
    finally { setBusy(false) }
  }

  async function download(backup: ApiBackup) {
    try {
      const blob = await api.downloadBackup(backup.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url; anchor.download = backup.filename; anchor.click(); URL.revokeObjectURL(url)
    } catch (error) { toast({ title: "Download failed", description: (error as ApiError).message, variant: "error" }) }
  }

  async function remove(backup: ApiBackup) {
    if (!window.confirm(`Delete ${backup.filename}?`)) return
    try { await api.deleteBackup(backup.id); toast({ title: "Backup deleted", variant: "success" }); await load() }
    catch (error) { toast({ title: "Delete failed", description: (error as ApiError).message, variant: "error" }) }
  }

  async function restore() {
    if (!restoreTarget || !password) return
    setBusy(true)
    try { await api.restoreBackup(restoreTarget.id, password); toast({ title: "Database restored", variant: "success" }); setRestoreTarget(null); setPassword(""); await load() }
    catch (error) { toast({ title: "Restore failed", description: (error as ApiError).message, variant: "error" }) }
    finally { setBusy(false) }
  }

  return (
    <>
      <DashboardPageHeader title="Backup & Restore" action={<Button onClick={create} disabled={busy}><DatabaseBackup className="h-4 w-4" /> {busy ? "Working..." : "Create Backup Now"}</Button>} />
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <p>Backups contain the complete hospital database. Restore temporarily places the system in maintenance mode and overwrites current data.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--cp-border)] px-4 py-3"><h2 className="font-semibold text-[var(--cp-ink)]">Available backups</h2><Button variant="ghost" size="icon" onClick={() => void load()} aria-label="Refresh backups"><RefreshCw className="h-4 w-4" /></Button></div>
        {loading ? <p className="p-6 text-sm text-[var(--cp-ink-soft)]">Loading backups...</p> : backups.length === 0 ? <p className="p-6 text-sm text-[var(--cp-ink-soft)]">No backups have been created.</p> : <div className="divide-y divide-[var(--cp-border)]">
          {backups.map((backup) => <div key={backup.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><p className="break-all text-sm font-medium text-[var(--cp-ink)]">{backup.filename}</p><span className={backup.status === "SUCCESS" ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700" : "rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"}>{backup.status === "SUCCESS" ? "Success" : "Failed"}</span></div><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{formatBytes(backup.sizeBytes)} · {formatDateTime(backup.createdAt)}</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void download(backup)} disabled={backup.status !== "SUCCESS"}><Download className="h-3.5 w-3.5" /> Download</Button><Button variant="outline" size="sm" onClick={() => setRestoreTarget(backup)} disabled={backup.status !== "SUCCESS"}><RotateCcw className="h-3.5 w-3.5" /> Restore</Button><Button variant="ghost" size="icon" onClick={() => void remove(backup)} aria-label={`Delete ${backup.filename}`}><Trash2 className="h-4 w-4 text-[var(--cp-critical)]" /></Button></div>
          </div>)}
        </div>}
      </div>
      <Modal open={restoreTarget !== null} onClose={() => { if (!busy) setRestoreTarget(null) }} title="Confirm database restore" description="This action cannot be undone without a backup.">
        <div className="space-y-4"><div className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">Current data will be overwritten. A safety backup will be created first, and other requests will be blocked during restore.</div><div><Label htmlFor="restore-password">Enter your admin password</Label><Input id="restore-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={busy}>Cancel</Button><Button variant="emergency" onClick={() => void restore()} disabled={busy || !password}><RotateCcw className="h-4 w-4" /> {busy ? "Restoring..." : "Restore database"}</Button></div></div>
      </Modal>
    </>
  )
}