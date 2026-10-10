import * as React from "react"
import { DatabaseBackup, Save, Upload } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, apiAssetUrl, getAccessToken, type ApiLabSettings, type ApiLabSettingsAssetType, type ApiLabTest } from "@/lib/api"

const EMPTY_SETTINGS: ApiLabSettings = {
  labName: "",
  address: "",
  phone: "",
  logoUrl: "",
  accreditationLine: "",
  headerText: "",
  footerText: "",
  pathologistName: "",
  pathologistSignatureUrl: "",
  technicianName: "",
  technicianSignatureUrl: "",
  reportsRetentionNote: "",
  allowSameUserEnterVerify: false,
  requirePaymentBeforeCollection: false,
  defaultTurnaroundHours: 24,
  maxDiscountPercent: 10,
  criticalThresholdDefaults: {},
  lastBackupAt: null,
}

type AssetField = "logoUrl" | "pathologistSignatureUrl" | "technicianSignatureUrl"
type AssetPreviews = { logo: string | null; pathologistSignature: string | null; technicianSignature: string | null }

function numberValue(value?: number | null) {
  return value == null ? "" : String(value)
}

export default function LabSettingsPage() {
  const { toast } = useToast()
  const [settings, setSettings] = React.useState<ApiLabSettings>(EMPTY_SETTINGS)
  const [tests, setTests] = React.useState<ApiLabTest[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState<ApiLabSettingsAssetType | null>(null)
  const [previews, setPreviews] = React.useState<AssetPreviews>({ logo: null, pathologistSignature: null, technicianSignature: null })

  React.useEffect(() => {
    let active = true
    Promise.all([api.getLabSettings(), api.listLabTests(true)])
      .then(([loadedSettings, loadedTests]) => {
        if (!active) return
        setSettings({ ...EMPTY_SETTINGS, ...loadedSettings })
        setTests(loadedTests)
      })
      .catch((error: unknown) => {
        if (active) toast({ title: "Unable to load Lab settings", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [toast])

  React.useEffect(() => {
    let active = true
    const urls: string[] = []
    const loadPreview = async (path?: string) => {
      if (!path) return null
      const target = new URL(apiAssetUrl(path), window.location.origin)
      const apiOrigin = new URL(import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1", window.location.origin).origin
      const token = getAccessToken()
      const response = await fetch(target, {
        headers: token && target.origin === apiOrigin ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!response.ok) throw new Error(`Unable to load a Lab settings image (${response.status}).`)
      const objectUrl = URL.createObjectURL(await response.blob())
      urls.push(objectUrl)
      return objectUrl
    }
    Promise.all([
      loadPreview(settings.logoUrl),
      loadPreview(settings.pathologistSignatureUrl),
      loadPreview(settings.technicianSignatureUrl),
    ]).then(([logo, pathologistSignature, technicianSignature]) => {
      if (active) setPreviews({ logo, pathologistSignature, technicianSignature })
      else urls.forEach(URL.revokeObjectURL)
    }).catch((error: unknown) => {
      urls.forEach(URL.revokeObjectURL)
      if (active) {
        setPreviews({ logo: null, pathologistSignature: null, technicianSignature: null })
        toast({ title: "Unable to load a Lab settings image", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
      }
    })
    return () => {
      active = false
      urls.forEach(URL.revokeObjectURL)
    }
  }, [settings.logoUrl, settings.pathologistSignatureUrl, settings.technicianSignatureUrl, toast])

  const setText = (key: keyof ApiLabSettings, value: string) => setSettings((current) => ({ ...current, [key]: value }))
  const setBoolean = (key: "allowSameUserEnterVerify" | "requirePaymentBeforeCollection", value: boolean) => setSettings((current) => ({ ...current, [key]: value }))

  async function saveSettings() {
    if (!settings.labName.trim()) {
      toast({ title: "Lab name is required", variant: "error" })
      return
    }
    setSaving(true)
    try {
      const saved = await api.updateLabSettings({
        ...settings,
        labName: settings.labName.trim(),
        address: settings.address?.trim() ?? "",
        phone: settings.phone?.trim() ?? "",
        accreditationLine: settings.accreditationLine?.trim() ?? "",
        headerText: settings.headerText?.trim() ?? "",
        footerText: settings.footerText?.trim() ?? "",
        pathologistName: settings.pathologistName?.trim() ?? "",
        technicianName: settings.technicianName?.trim() ?? "",
        reportsRetentionNote: settings.reportsRetentionNote?.trim() ?? "",
      })
      setSettings({ ...EMPTY_SETTINGS, ...saved })
      toast({ title: "Lab settings saved", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to save Lab settings", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  async function uploadAsset(assetType: ApiLabSettingsAssetType, field: AssetField, file?: File) {
    if (!file) return
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast({ title: "Unsupported image", description: "Upload a PNG or JPEG image no larger than 2 MB.", variant: "error" })
      return
    }
    setUploading(assetType)
    try {
      const uploaded = await api.uploadLabSettingsAsset(assetType, file)
      setSettings((current) => ({ ...current, [field]: uploaded.url }))
      toast({ title: "Image uploaded", description: "Save Lab settings to apply it to reports.", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to upload image", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setUploading(null)
    }
  }

  function updateCriticalDefault(parameterId: string, edge: "criticalLow" | "criticalHigh", value: string) {
    setSettings((current) => {
      const existing = current.criticalThresholdDefaults[parameterId] ?? {}
      const next = { ...existing, [edge]: value === "" ? null : Number(value) }
      if (next.criticalLow == null && next.criticalHigh == null) {
        const { [parameterId]: _removed, ...remaining } = current.criticalThresholdDefaults
        return { ...current, criticalThresholdDefaults: remaining }
      }
      return { ...current, criticalThresholdDefaults: { ...current.criticalThresholdDefaults, [parameterId]: next } }
    })
  }

  const parameters = tests.flatMap((test) => (test.parameters ?? []).filter((parameter) => parameter.resultType === "NUMERIC").map((parameter) => ({
    testName: test.testName,
    parameter,
  })))
  const criticalDefaultsInvalid = parameters.some(({ parameter }) => {
    const value = settings.criticalThresholdDefaults[parameter.id]
    return value?.criticalLow != null && value.criticalHigh != null && value.criticalLow > value.criticalHigh
  })

  if (loading) return <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-6 text-sm text-[var(--cp-ink-soft)]">Loading Lab settings…</div>

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Lab Settings" action={<Button onClick={() => void saveSettings()} disabled={saving || criticalDefaultsInvalid || !settings.labName.trim()}><Save className="h-4 w-4" />{saving ? "Saving…" : "Save settings"}</Button>} />

      <Card>
        <CardHeader><CardTitle>Lab details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="lab-settings-name">Lab name *</Label><Input id="lab-settings-name" maxLength={200} value={settings.labName} onChange={(event) => setText("labName", event.target.value)} /></div>
          <div><Label htmlFor="lab-settings-phone">Phone</Label><Input id="lab-settings-phone" maxLength={40} value={settings.phone ?? ""} onChange={(event) => setText("phone", event.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="lab-settings-address">Address</Label><Input id="lab-settings-address" maxLength={500} value={settings.address ?? ""} onChange={(event) => setText("address", event.target.value)} /></div>
          <div>
            <Label htmlFor="lab-settings-logo">Logo upload (PNG/JPEG, up to 2 MB)</Label>
            <label className="mt-1 flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--cp-border-strong)] p-3 text-sm text-[var(--cp-ink-soft)]">
              <input id="lab-settings-logo" className="sr-only" type="file" accept="image/png,image/jpeg" onChange={(event) => void uploadAsset("logo", "logoUrl", event.target.files?.[0])} />
              {previews.logo && <img src={previews.logo} alt="Configured lab logo" className="max-h-14 max-w-36 object-contain" />}
              <span><Upload className="mr-2 inline h-4 w-4" />{uploading === "logo" ? "Uploading…" : "Choose logo"}</span>
            </label>
          </div>
          <div><Label htmlFor="lab-settings-accreditation">Optional accreditation text</Label><Input id="lab-settings-accreditation" maxLength={200} value={settings.accreditationLine ?? ""} onChange={(event) => setText("accreditationLine", event.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Report appearance and signers</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="lab-report-header-text">Report header text</Label><Textarea id="lab-report-header-text" maxLength={1000} rows={2} value={settings.headerText ?? ""} onChange={(event) => setText("headerText", event.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="lab-report-footer-text">Report footer text</Label><Textarea id="lab-report-footer-text" maxLength={1000} rows={2} value={settings.footerText ?? ""} onChange={(event) => setText("footerText", event.target.value)} /></div>
          <div><Label htmlFor="lab-pathologist-name">Pathologist display name</Label><Input id="lab-pathologist-name" maxLength={200} value={settings.pathologistName ?? ""} onChange={(event) => setText("pathologistName", event.target.value)} /></div>
          <div>
            <Label htmlFor="lab-pathologist-signature">Pathologist signature (PNG/JPEG, up to 2 MB)</Label>
            <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--cp-border-strong)] px-3 py-2 text-sm text-[var(--cp-ink-soft)]">
              <input id="lab-pathologist-signature" className="sr-only" type="file" accept="image/png,image/jpeg" onChange={(event) => void uploadAsset("pathologist-signature", "pathologistSignatureUrl", event.target.files?.[0])} />
              {previews.pathologistSignature && <img src={previews.pathologistSignature} alt="Configured pathologist signature" className="max-h-10 max-w-28 object-contain" />}
              <span><Upload className="mr-1 inline h-4 w-4" />{uploading === "pathologist-signature" ? "Uploading…" : "Choose image"}</span>
            </label>
          </div>
          <div><Label htmlFor="lab-technician-name">Technician display name (fallback)</Label><Input id="lab-technician-name" maxLength={200} value={settings.technicianName ?? ""} onChange={(event) => setText("technicianName", event.target.value)} /></div>
          <div>
            <Label htmlFor="lab-technician-signature">Technician signature (PNG/JPEG, up to 2 MB)</Label>
            <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--cp-border-strong)] px-3 py-2 text-sm text-[var(--cp-ink-soft)]">
              <input id="lab-technician-signature" className="sr-only" type="file" accept="image/png,image/jpeg" onChange={(event) => void uploadAsset("technician-signature", "technicianSignatureUrl", event.target.files?.[0])} />
              {previews.technicianSignature && <img src={previews.technicianSignature} alt="Configured technician signature" className="max-h-10 max-w-28 object-contain" />}
              <span><Upload className="mr-1 inline h-4 w-4" />{uploading === "technician-signature" ? "Uploading…" : "Choose image"}</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Workflow and billing rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="lab-default-turnaround">Default turnaround time (hours)</Label><Input id="lab-default-turnaround" type="number" min="0" max="8760" step="1" value={settings.defaultTurnaroundHours} onChange={(event) => setSettings((current) => ({ ...current, defaultTurnaroundHours: Number(event.target.value) }))} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Applied to new catalog tests when no test-specific turnaround is entered.</p></div>
            <div><Label htmlFor="lab-max-discount">Maximum Lab discount (%)</Label><Input id="lab-max-discount" type="number" min="0" max="100" step="0.1" value={settings.maxDiscountPercent} onChange={(event) => setSettings((current) => ({ ...current, maxDiscountPercent: Number(event.target.value) }))} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Discounts above this limit require Admin approval and a reason.</p></div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--cp-border)] p-3 text-sm">
            <input className="mt-1" type="checkbox" checked={settings.allowSameUserEnterVerify} onChange={(event) => setBoolean("allowSameUserEnterVerify", event.target.checked)} />
            <span><strong className="block">Allow the same user to enter and verify results</strong><span className="text-xs text-[var(--cp-ink-soft)]">When off, the API prevents a result author from verifying their own result.</span></span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--cp-border)] p-3 text-sm">
            <input className="mt-1" type="checkbox" checked={settings.requirePaymentBeforeCollection} onChange={(event) => setBoolean("requirePaymentBeforeCollection", event.target.checked)} />
            <span><strong className="block">Require payment before sample collection</strong><span className="text-xs text-[var(--cp-ink-soft)]">When on, collection and recollection require a fully paid linked invoice.</span></span>
          </label>
          <div>
            <h3 className="text-sm font-semibold">Critical threshold defaults by parameter</h3>
            <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Defaults are used only when the selected age/gender reference range leaves that critical bound blank. Medical thresholds must be reviewed by a pathologist.</p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--cp-border)]">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-[var(--cp-bg)] text-xs text-[var(--cp-ink-soft)]"><tr><th className="px-3 py-2">Test / parameter</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">Critical low default</th><th className="px-3 py-2">Critical high default</th></tr></thead>
                <tbody className="divide-y divide-[var(--cp-border)]">
                  {parameters.map(({ testName, parameter }) => {
                    const threshold = settings.criticalThresholdDefaults[parameter.id]
                    const invalid = threshold?.criticalLow != null && threshold.criticalHigh != null && threshold.criticalLow > threshold.criticalHigh
                    return <tr key={parameter.id}>
                      <td className="px-3 py-2"><strong>{parameter.name}</strong><span className="ml-2 text-xs text-[var(--cp-ink-soft)]">{testName}</span></td>
                      <td className="px-3 py-2">{parameter.unit || "—"}</td>
                      <td className="px-3 py-2"><Input aria-label={`${parameter.name} critical low default`} type="number" step="any" value={numberValue(threshold?.criticalLow)} aria-invalid={invalid} onChange={(event) => updateCriticalDefault(parameter.id, "criticalLow", event.target.value)} /></td>
                      <td className="px-3 py-2"><Input aria-label={`${parameter.name} critical high default`} type="number" step="any" value={numberValue(threshold?.criticalHigh)} aria-invalid={invalid} onChange={(event) => updateCriticalDefault(parameter.id, "criticalHigh", event.target.value)} /></td>
                    </tr>
                  })}
                  {!parameters.length && <tr><td colSpan={4} className="px-3 py-5 text-center text-sm text-[var(--cp-ink-soft)]">No active test parameters are configured.</td></tr>}
                </tbody>
              </table>
            </div>
            {criticalDefaultsInvalid && <p role="alert" className="mt-2 text-xs font-medium text-[var(--cp-critical)]">Critical low defaults cannot exceed critical high defaults.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Report retention and backup / restore</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label htmlFor="lab-retention-note">Reports retention note</Label><Textarea id="lab-retention-note" rows={2} maxLength={1000} value={settings.reportsRetentionNote ?? ""} onChange={(event) => setText("reportsRetentionNote", event.target.value)} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Changing Lab settings does not delete prior results, amended versions, or order history.</p></div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-bg)] p-4">
            <div><h3 className="text-sm font-semibold">Database backup</h3><p className="mt-1 text-sm text-[var(--cp-ink-soft)]">Last successful backup: {settings.lastBackupAt ? formatDateTime(settings.lastBackupAt) : "Never"}.</p></div>
            <Link to="/dashboard/admin/backup" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--cp-border)] bg-white px-4 text-sm font-semibold text-[var(--cp-ink)] hover:bg-[var(--cp-bg)]"><DatabaseBackup className="h-4 w-4" />Open Backup / Restore</Link>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end"><Button onClick={() => void saveSettings()} disabled={saving || criticalDefaultsInvalid || !settings.labName.trim()}><Save className="h-4 w-4" />{saving ? "Saving…" : "Save settings"}</Button></div>
    </div>
  )
}
