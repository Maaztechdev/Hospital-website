import * as React from "react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { api, apiAssetUrl, type ApiDepartment, type ApiDepartmentHod, type ApiError, type ApiHospitalProfile } from "@/lib/api"
import { DEFAULT_HOSPITAL_PROFILE, storeHospitalProfile, useHospitalProfile } from "@/lib/hospitalProfile"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { Activity, Baby, Bone, Brain, HeartPulse, Pill, Stethoscope, Syringe, Trash2 } from "lucide-react"

const SECTIONS = [
  "Hospital Profile", "Departments", "Doctor Schedules", "Lab Tests", "Medicine Categories",
  "Ward Setup", "Room/Bed Setup", "OT Rooms", "Invoice Settings", "Notification Templates", "Role Permissions",
] as const

const DEFAULT_SETTINGS: Record<string, string> = {
  hospital_name: "Khalida Medicare Hospital",
  registration_no: "PHC-2019-0451",
  contact_phone: "+92 42 3587 4210",
  email: "info@khalida.pk",
  address: "12-B Gulberg III, Lahore, Pakistan",
}

const DEFAULT_PROFILE = DEFAULT_HOSPITAL_PROFILE
const timezones = ["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "UTC", "Europe/London", "America/New_York"]

function SettingsField({ label, value, onChange, placeholder, textarea }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; textarea?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      {textarea ? <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /> : <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </div>
  )
}

const DEPARTMENT_ICONS = { HeartPulse, Bone, Baby, Brain, Pill, Stethoscope, Syringe, Activity }
type DepartmentIcon = keyof typeof DEPARTMENT_ICONS

function DepartmentsPanel() {
  const { toast } = useToast()
  const [departments, setDepartments] = React.useState<ApiDepartment[]>([])
  const [hods, setHods] = React.useState<ApiDepartmentHod[]>([])
  const [editing, setEditing] = React.useState<ApiDepartment | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState<ApiDepartment | null>(null)
  const [deleteBlocked, setDeleteBlocked] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", hodId: "", icon: "HeartPulse" as DepartmentIcon, status: "ACTIVE" as "ACTIVE" | "INACTIVE" })
  const load = React.useCallback(() => Promise.all([api.listDepartments(), api.listAvailableHods()]).then(([items, available]) => { setDepartments(items); setHods(available) }).catch((error) => toast({ title: "Unable to load departments", description: (error as ApiError).message, variant: "error" })), [toast])
  React.useEffect(() => { void load() }, [load])
  const openForm = (department?: ApiDepartment) => { setEditing(department ?? null); setForm(department ? { name: department.name, hodId: department.hodId ?? "", icon: (department.icon as DepartmentIcon) || "HeartPulse", status: department.status } : { name: "", hodId: "", icon: "HeartPulse", status: "ACTIVE" }); setModalOpen(true) }
  const save = async () => { if (!form.name.trim()) return; try { const payload = { ...form, name: form.name.trim(), hodId: form.hodId || null, icon: form.icon }; if (editing) await api.updateDepartment(editing.id, payload); else await api.createDepartment(payload); setModalOpen(false); await load(); toast({ title: editing ? "Department updated" : "Department created", variant: "success" }) } catch (error) { toast({ title: "Save failed", description: (error as ApiError).message, variant: "error" }) } }
  const toggle = async (department: ApiDepartment) => { setDepartments((items) => items.map((item) => item.id === department.id ? { ...item, status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } : item)); try { await api.updateDepartmentStatus(department.id, department.status === "ACTIVE" ? "INACTIVE" : "ACTIVE") } catch (error) { setDepartments((items) => items.map((item) => item.id === department.id ? department : item)); toast({ title: "Status update failed", description: (error as ApiError).message, variant: "error" }) } }
  const remove = async () => { if (!confirming) return; if (deleteBlocked) { try { await api.updateDepartmentStatus(confirming.id, "INACTIVE"); setConfirming(null); setDeleteBlocked(false); await load(); toast({ title: "Department set inactive", variant: "success" }) } catch (error) { toast({ title: "Status update failed", description: (error as ApiError).message, variant: "error" }) } return } try { await api.deleteDepartment(confirming.id); setConfirming(null); await load(); toast({ title: "Department deleted", variant: "success" }) } catch (error) { const apiError = error as ApiError; if (apiError.status === 409) setDeleteBlocked(true); else toast({ title: "Delete failed", description: apiError.message, variant: "error" }) } }
  return <div className="flex flex-col gap-3">
    <div className="flex justify-end"><Button size="sm" onClick={() => openForm()}>Add Department</Button></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Icon</th><th>Name</th><th>HOD</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{departments.map((department) => { const Icon = DEPARTMENT_ICONS[(department.icon as DepartmentIcon) || "Stethoscope"] || Stethoscope; return <tr key={department.id} className={cn("border-b border-[var(--cp-border)] last:border-0", department.status === "INACTIVE" && "opacity-50")}><td className="py-3"><Icon className="h-5 w-5 text-[var(--cp-primary)]" /></td><td className="font-semibold">{department.name}</td><td>{department.hod?.user.name ?? "Not Assigned"}</td><td><button onClick={() => toggle(department)} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", department.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{department.status === "ACTIVE" ? "Active" : "Inactive"}</button></td><td className="text-right"><Button variant="ghost" size="sm" onClick={() => openForm(department)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Delete ${department.name}`} onClick={() => { setDeleteBlocked(false); setConfirming(department) }}><Trash2 className="h-4 w-4 text-[var(--color-emergency)]" /></Button></td></tr> })}</tbody></table></div>
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Department" : "Add Department"} description="Keep assignment options current for new clinical records."><div className="flex flex-col gap-4"><div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div><div><Label>Head of Department</Label><Select value={form.hodId} onChange={(e) => setForm({ ...form, hodId: e.target.value })}><option value="">Not Assigned</option>{hods.map((hod) => <option key={hod.id} value={hod.id}>{hod.name}{hod.specialization ? ` — ${hod.specialization}` : ""}</option>)}</Select></div><div><Label>Icon</Label><div className="mt-2 grid grid-cols-4 gap-2">{(Object.keys(DEPARTMENT_ICONS) as DepartmentIcon[]).map((key) => { const Icon = DEPARTMENT_ICONS[key]; return <button type="button" key={key} aria-label={key} onClick={() => setForm({ ...form, icon: key })} className={cn("flex h-11 items-center justify-center rounded-lg border", form.icon === key ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)]" : "border-[var(--cp-border)]")}><Icon className="h-5 w-5" /></button> })}</div></div><div><Label>Status</Label><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "ACTIVE" | "INACTIVE" })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={save} disabled={!form.name.trim()}>Save Department</Button></div></div></Modal>
    <ConfirmDialog open={Boolean(confirming)} onClose={() => { setConfirming(null); setDeleteBlocked(false) }} onConfirm={remove} title={deleteBlocked ? "Delete blocked" : "Delete department?"} description={deleteBlocked ? "Ye department active doctors/records ke sath linked hai. Delete nahi ho sakta — isse Inactive karein." : `This permanently deletes ${confirming?.name ?? "this department"}. Linked departments cannot be deleted.`} confirmLabel={deleteBlocked ? "Set Inactive Instead" : "Delete"} destructive={!deleteBlocked} />
  </div>
}

function SectionPanel({ section }: { section: string }) {
  const { toast } = useToast()
  const sharedProfile = useHospitalProfile()
  const [form, setForm] = React.useState<Record<string, string>>(DEFAULT_SETTINGS)
  const [profile, setProfile] = React.useState<ApiHospitalProfile>(sharedProfile)
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState<"logo" | "favicon" | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api.listSettings()
      .then((settings) => {
        if (cancelled) return
        const next = { ...DEFAULT_SETTINGS }
        for (const item of settings) {
          if (typeof item.value === "string") next[item.key] = item.value
        }
        setForm(next)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [section])

  React.useEffect(() => {
    if (section !== "Hospital Profile") return
    api.getHospitalProfile().then((value) => { if (value) { const next = { ...DEFAULT_PROFILE, ...value }; setProfile(next); storeHospitalProfile(next) } }).catch(() => undefined)
  }, [section])

  React.useEffect(() => {
    if (profile.faviconUrl) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement("link")
      link.rel = "icon"; link.href = apiAssetUrl(profile.faviconUrl); document.head.appendChild(link)
    }
  }, [profile.faviconUrl])

  const updateProfile = (key: keyof ApiHospitalProfile, value: string) => setProfile((previous) => ({ ...previous, [key]: value }))
  const uploadAsset = async (type: "logo" | "favicon", file?: File) => {
    if (!file) return
    setUploading(type)
    try { const uploaded = await api.uploadHospitalAsset(type, file); setProfile((previous) => ({ ...previous, ...uploaded })); toast({ title: "Upload complete", description: `${type} updated.`, variant: "success" }) }
    catch (error) { toast({ title: "Upload failed", description: (error as ApiError).message, variant: "error" }) }
    finally { setUploading(null) }
  }

  const save = async () => {
    setSaving(true)
    try {
      if (section === "Hospital Profile") {
        const payload = {
          ...profile,
          name: profile.name.trim(),
          registrationNo: profile.registrationNo?.trim() || null,
          address: profile.address?.trim() || null,
          phone: profile.phone?.trim() || null,
          email: profile.email?.trim() || null,
          emergencyContact: profile.emergencyContact?.trim() || null,
          taxId: profile.taxId?.trim() || null,
        }
        const saved = await api.updateHospitalProfile(payload); storeHospitalProfile(saved); setProfile(saved)
      }
      else for (const [key, value] of Object.entries(form)) await api.updateSetting(key, value)
      toast({ title: "Settings saved", description: `${section} updated successfully.`, variant: "success" })
    } catch (error) {
      toast({ title: "Save failed", description: (error as ApiError).message || "Unable to save settings.", variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const content: Record<string, React.ReactNode> = {
    "Hospital Profile": (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SettingsField label="Hospital Name" value={profile.name} onChange={(value) => updateProfile("name", value)} />
        <SettingsField label="Registration No." value={profile.registrationNo ?? ""} onChange={(value) => updateProfile("registrationNo", value)} />
        <SettingsField label="Contact Phone" value={profile.phone ?? ""} onChange={(value) => updateProfile("phone", value)} />
        <SettingsField label="Emergency Contact (recommended)" value={profile.emergencyContact ?? ""} onChange={(value) => updateProfile("emergencyContact", value)} placeholder="Emergency Number" />
        <SettingsField label="Email" value={profile.email ?? ""} onChange={(value) => updateProfile("email", value)} />
        <div><Label>Tax ID / NTN Number <span className="text-xs text-[var(--cp-ink-soft)]">(recommended)</span></Label><Input value={profile.taxId ?? ""} onChange={(e) => updateProfile("taxId", e.target.value)} placeholder="NTN-XXXXXXX" /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Required for invoice compliance in Pakistan</p></div>
        <div><Label>Currency</Label><Select value={profile.currency} onChange={(e) => updateProfile("currency", e.target.value)}>{["PKR", "USD", "AED", "SAR", "GBP", "EUR"].map((currency) => <option key={currency}>{currency}</option>)}</Select></div>
        <div><Label>Timezone</Label><Select value={profile.timezone} onChange={(e) => updateProfile("timezone", e.target.value)}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</Select></div>
        <div className="sm:col-span-2"><SettingsField label="Address" value={profile.address ?? ""} onChange={(value) => updateProfile("address", value)} textarea /></div>
        <div><Label>Hospital Logo</Label><label className="mt-1 flex min-h-28 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--cp-border-strong)] p-3 text-center text-sm text-[var(--cp-ink-soft)]"><input className="sr-only" type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => uploadAsset("logo", e.target.files?.[0])} />{profile.logoUrl ? <img src={apiAssetUrl(profile.logoUrl)} alt="Hospital logo" className="max-h-20 max-w-full object-contain" /> : uploading === "logo" ? "Uploading..." : "Drop or click to upload"}</label></div>
        <div><Label>Favicon</Label><label className="mt-1 flex min-h-28 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--cp-border-strong)] p-3 text-center text-sm text-[var(--cp-ink-soft)]"><input className="sr-only" type="file" accept="image/png,image/jpeg,image/svg+xml,image/x-icon" onChange={(e) => uploadAsset("favicon", e.target.files?.[0])} />{profile.faviconUrl ? <img src={apiAssetUrl(profile.faviconUrl)} alt="Hospital favicon" className="h-8 w-8 object-contain" /> : uploading === "favicon" ? "Uploading..." : "Upload 32 x 32 icon"}</label></div>
      </div>
    ),
    "Departments": (
      <DepartmentsPanel />
    ),
    "Ward Setup": (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["General Ward", "Private Room", "ICU"].map((w) => (
          <div key={w} className="rounded-lg border border-[var(--cp-border)] p-3">
            <p className="text-sm font-semibold text-[var(--cp-ink)]">{w}</p>
            <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Configure daily rate, capacity, and amenities.</p>
          </div>
        ))}
      </div>
    ),
    "Room/Bed Setup": (
      <div className="text-sm text-[var(--cp-ink-soft)]">Manage individual beds, room numbers, and ward assignments from the Ward Board's bed detail drawer, or bulk-edit here.</div>
    ),
    "OT Rooms": (
      <div className="flex flex-col gap-2">
        {["OT-1", "OT-2", "OT-3"].map((r) => (
          <div key={r} className="flex items-center justify-between rounded-lg border border-[var(--cp-border)] px-3 py-2.5 text-sm">
            <span className="text-[var(--cp-ink)]">{r}</span>
            <span className="text-xs text-[var(--cp-ink-faint)]">Active</span>
          </div>
        ))}
      </div>
    ),
    "Role Permissions": (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] border-collapse text-sm">
          <thead><tr className="border-b border-[var(--cp-border)] text-left text-xs font-semibold uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Role</th><th className="py-2">Ward Access</th><th className="py-2">Billing Access</th><th className="py-2">Reports</th></tr></thead>
          <tbody>
            {[["Admin", "Full", "Full", "Full"], ["Doctor", "View/Edit", "View", "View"], ["Nurse", "View/Edit", "None", "None"], ["Receptionist", "View", "Full", "None"]].map((row) => (
              <tr key={row[0]} className="border-b border-[var(--cp-border)] last:border-0">{row.map((c, i) => <td key={i} className="py-2.5 text-[var(--cp-ink)]">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  }

  return (
    <div className="flex flex-col gap-4">
      {content[section] ?? (
        <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">{section} configuration will appear here.</div>
      )}
      <div className="flex justify-end border-t border-[var(--cp-border)] pt-4">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [active, setActive] = React.useState<(typeof SECTIONS)[number]>(SECTIONS[0])

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Settings" />
      <div className="flex flex-col gap-4 lg:flex-row">
        <nav className="cp-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-2 lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                active === s ? "bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]"
              )}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="flex-1 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
          <p className="mb-4 text-sm font-bold text-[var(--cp-ink)]">{active}</p>
          <SectionPanel section={active} />
        </div>
      </div>
    </div>
  )
}
