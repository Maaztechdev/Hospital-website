import * as React from "react"
import { DatabaseBackup, ImagePlus, Save, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiPharmacySettings, type ApiPharmacySettingsInput } from "@/lib/api"
import { apiAssetUrl } from "@/lib/hospitalProfile"

const initialSettings: ApiPharmacySettingsInput = {
  name: "Pharmacy",
  address: "",
  phone: "",
  currency: "PKR",
  defaultReceiptFormat: "a4",
  cashierMaxDiscountPercent: 10,
  lossAlertThreshold: 0,
  defaultLowStockLevel: 10,
}

export default function PharmacySettingsPage() {
  const { toast } = useToast()
  const [settings, setSettings] = React.useState<ApiPharmacySettingsInput>(initialSettings)
  const [savedSettings, setSavedSettings] = React.useState<ApiPharmacySettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [pinSaving, setPinSaving] = React.useState(false)
  const [backupSaving, setBackupSaving] = React.useState(false)
  const [currentPin, setCurrentPin] = React.useState("")
  const [newPin, setNewPin] = React.useState("")
  const [confirmPin, setConfirmPin] = React.useState("")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.getPharmacySettings()
      setSavedSettings(result)
      setSettings({
        name: result.name,
        address: result.address,
        phone: result.phone,
        currency: "PKR",
        defaultReceiptFormat: result.defaultReceiptFormat,
        cashierMaxDiscountPercent: Number(result.cashierMaxDiscountPercent),
        lossAlertThreshold: Number(result.lossAlertThreshold),
        defaultLowStockLevel: Number(result.defaultLowStockLevel),
      })
    } catch (error) {
      toast({ title: "Unable to load pharmacy settings", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void load() }, [load])

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const updated = await api.updatePharmacySettings(settings)
      setSettings({
        name: updated.name,
        address: updated.address,
        phone: updated.phone,
        currency: "PKR",
        defaultReceiptFormat: updated.defaultReceiptFormat,
        cashierMaxDiscountPercent: Number(updated.cashierMaxDiscountPercent),
        lossAlertThreshold: Number(updated.lossAlertThreshold),
        defaultLowStockLevel: Number(updated.defaultLowStockLevel),
      })
      setSavedSettings((previous) => previous ? { ...previous, ...updated } : previous)
      toast({ title: "Pharmacy settings saved", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to save settings", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  async function uploadLogo(file?: File) {
    if (!file) return
    try {
      const result = await api.uploadPharmacyLogo(file)
      setSavedSettings((previous) => previous ? { ...previous, logoUrl: result.logoUrl } : previous)
      toast({ title: "Pharmacy logo updated", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to upload logo", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    }
  }

  async function updatePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPin !== confirmPin) {
      toast({ title: "PINs do not match", description: "Enter the same PIN in both new-PIN fields.", variant: "error" })
      return
    }
    setPinSaving(true)
    try {
      await api.updatePharmacyAdminPin({ ...(savedSettings?.adminPinConfigured ? { currentPin } : {}), newPin })
      setSavedSettings((previous) => previous ? { ...previous, adminPinConfigured: true } : previous)
      setCurrentPin("")
      setNewPin("")
      setConfirmPin("")
      toast({ title: savedSettings?.adminPinConfigured ? "Admin PIN changed" : "Admin PIN configured", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to update Admin PIN", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setPinSaving(false)
    }
  }

  async function createBackup() {
    setBackupSaving(true)
    try {
      await api.createBackup()
      const refreshed = await api.getPharmacySettings()
      setSavedSettings((previous) => previous ? { ...previous, lastBackupAt: refreshed.lastBackupAt } : refreshed)
      toast({ title: "Backup created", description: "The existing CarePlus backup system completed the request.", variant: "success" })
    } catch (error) {
      toast({ title: "Backup failed", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
      await load()
    } finally {
      setBackupSaving(false)
    }
  }

  const setNumber = (key: "cashierMaxDiscountPercent" | "lossAlertThreshold" | "defaultLowStockLevel", value: string) => {
    setSettings((current) => ({ ...current, [key]: value === "" ? 0 : Number(value) }))
  }

  return (
    <>
      <DashboardPageHeader title="Pharmacy Settings" />
      {loading ? <div className="rounded-xl border border-[var(--cp-border)] bg-white p-6 text-sm text-[var(--cp-ink-soft)]">Loading pharmacy settings…</div> : <>
        <form onSubmit={(event) => void saveSettings(event)} className="space-y-5">
          <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">Invoice profile</h2>
            <p className="mt-1 text-sm text-[var(--cp-ink-soft)]">This information and logo appear on pharmacy invoices and receipts.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="pharmacy-name">Pharmacy name</Label><Input id="pharmacy-name" required maxLength={200} value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} /></div>
              <div><Label htmlFor="pharmacy-phone">Phone</Label><Input id="pharmacy-phone" maxLength={40} value={settings.phone} onChange={(event) => setSettings({ ...settings, phone: event.target.value })} /></div>
              <div className="sm:col-span-2"><Label htmlFor="pharmacy-address">Address</Label><Input id="pharmacy-address" maxLength={500} value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} /></div>
              <div><Label htmlFor="pharmacy-currency">Currency</Label><Input id="pharmacy-currency" value="PKR" readOnly /></div>
              <div><Label htmlFor="pharmacy-receipt-format">Default receipt format</Label><select id="pharmacy-receipt-format" value={settings.defaultReceiptFormat} onChange={(event) => setSettings({ ...settings, defaultReceiptFormat: event.target.value as ApiPharmacySettingsInput["defaultReceiptFormat"] })} className="mt-1 h-10 w-full rounded-md border border-[var(--cp-border)] bg-white px-3 text-sm"><option value="receipt">80mm thermal</option><option value="a4">A4</option></select></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {savedSettings?.logoUrl && <img src={apiAssetUrl(savedSettings.logoUrl)} alt="Current pharmacy logo" className="h-14 max-w-40 object-contain" />}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--cp-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--cp-bg)]"><ImagePlus className="h-4 w-4" /> Upload logo<input className="sr-only" type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.target.value = "" }} /></label>
              <span className="text-xs text-[var(--cp-ink-soft)]">PNG, JPEG, or SVG; maximum 2 MB.</span>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold">Accountability & inventory</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div><Label htmlFor="cashier-discount-limit">Cashier max discount (%)</Label><Input id="cashier-discount-limit" type="number" min="0" max="100" step="0.1" value={settings.cashierMaxDiscountPercent} onChange={(event) => setNumber("cashierMaxDiscountPercent", event.target.value)} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Higher discounts require Admin login or PIN approval and a reason.</p></div>
              <div><Label htmlFor="pharmacy-loss-threshold">Loss alert threshold (PKR)</Label><Input id="pharmacy-loss-threshold" type="number" min="0" step="0.01" value={settings.lossAlertThreshold} onChange={(event) => setNumber("lossAlertThreshold", event.target.value)} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Notify Admin when an invoice’s total cost shortfall reaches this amount. 0 disables alerts.</p></div>
              <div><Label htmlFor="default-low-stock">Default low-stock level (units)</Label><Input id="default-low-stock" type="number" min="0" step="1" value={settings.defaultLowStockLevel} onChange={(event) => setNumber("defaultLowStockLevel", event.target.value)} /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Used for batches created without a specific reorder level.</p></div>
            </div>
            <div className="mt-5 flex justify-end"><Button type="submit" disabled={saving}><Save className="h-4 w-4" />{saving ? "Saving…" : "Save settings"}</Button></div>
          </section>
        </form>

        <section className="mt-5 rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[var(--cp-primary)]" /><h2 className="text-base font-semibold">Protected actions: Admin PIN</h2></div>
          <p className="mt-1 text-sm text-[var(--cp-ink-soft)]">The PIN is stored as a password hash and is never returned by the API. Cashiers may use it to request approval for above-limit discounts.</p>
          <form onSubmit={(event) => void updatePin(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
            {savedSettings?.adminPinConfigured && <div><Label htmlFor="current-admin-pin">Current Admin PIN</Label><Input id="current-admin-pin" type="password" inputMode="numeric" autoComplete="current-password" value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} pattern="[0-9]{4,12}" required /></div>}
            <div><Label htmlFor="new-admin-pin">New Admin PIN</Label><Input id="new-admin-pin" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.target.value)} pattern="[0-9]{4,12}" required /></div>
            <div><Label htmlFor="confirm-admin-pin">Confirm new PIN</Label><Input id="confirm-admin-pin" type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} pattern="[0-9]{4,12}" required /></div>
            <div className="flex items-end sm:col-span-2"><Button type="submit" disabled={pinSaving}><ShieldCheck className="h-4 w-4" />{pinSaving ? "Updating…" : savedSettings?.adminPinConfigured ? "Change Admin PIN" : "Set Admin PIN"}</Button></div>
          </form>
        </section>

        <section className="mt-5 rounded-2xl border border-[var(--cp-border)] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Database backup</h2><p className="mt-1 text-sm text-[var(--cp-ink-soft)]">Uses the existing CarePlus backup and restore service. Last successful backup: {savedSettings?.lastBackupAt ? formatDateTime(savedSettings.lastBackupAt) : "Never"}.</p></div><Button onClick={() => void createBackup()} disabled={backupSaving}><DatabaseBackup className="h-4 w-4" />{backupSaving ? "Creating…" : "Create backup"}</Button></div>
          <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">Admin-only action. Backup history and restore controls remain available on the existing Backup & Restore page.</p>
        </section>
      </>}
    </>
  )
}
