import * as React from "react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { api, apiAssetUrl, type ApiDepartment, type ApiDepartmentHod, type ApiDoctorSchedule, type ApiDoctorScheduleInput, type ApiError, type ApiHospitalProfile, type ApiLabTest, type ApiMedicineCategory, type ApiNotificationTemplate, type ApiNotificationTemplateInput, type ApiNotificationType, type ApiOTRoom, type ApiPermissionAction, type ApiRolePermission, type ApiScheduleDay, type ApiWard } from "@/lib/api"
import { DEFAULT_HOSPITAL_PROFILE, storeHospitalProfile, useHospitalProfile } from "@/lib/hospitalProfile"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { Activity, Baby, Bone, Brain, HeartPulse, Pill, Stethoscope, Syringe, Trash2 } from "lucide-react"

const SECTIONS = [
  "Hospital Profile", "Departments", "Doctor Schedules", "Lab Tests", "Medicine Categories",
  "Ward Setup", "Room/Bed Setup", "OT Rooms", "Invoice Settings", "Pharmacy Discounts", "Notification Templates", "Role Permissions",
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
const SCHEDULE_DAYS: ApiScheduleDay[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const DEFAULT_DAY = { enabled: true, start: "09:00", end: "17:00" }

function scheduleFromDoctor(doctor: ApiDoctorSchedule): ApiDoctorScheduleInput {
  const raw = doctor.scheduleJson as Partial<ApiDoctorScheduleInput> & { daysOff?: string[]; workingHours?: { start?: string; end?: string } } | null | undefined
  const weekly = Object.fromEntries(SCHEDULE_DAYS.map((day) => {
    const saved = raw?.weekly?.[day]
    const legacyHours = raw?.workingHours
    return [day, saved ?? { ...DEFAULT_DAY, enabled: !raw?.daysOff?.includes(day), start: legacyHours?.start ?? DEFAULT_DAY.start, end: legacyHours?.end ?? DEFAULT_DAY.end }]
  })) as ApiDoctorScheduleInput["weekly"]
  return { slotDuration: raw?.slotDuration ?? 20, weekly }
}

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

function DoctorSchedulesPanel() {
  const { toast } = useToast()
  const [doctors, setDoctors] = React.useState<ApiDoctorSchedule[]>([])
  const [selectedId, setSelectedId] = React.useState("")
  const [schedule, setSchedule] = React.useState<ApiDoctorScheduleInput | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const items = await api.listDoctorSchedules()
      setDoctors(items)
      setSelectedId((current) => current || items[0]?.id || "")
    } catch (error) {
      toast({ title: "Unable to load schedules", description: (error as ApiError).message, variant: "error" })
    } finally { setLoading(false) }
  }, [toast])

  React.useEffect(() => { void load() }, [load])
  React.useEffect(() => {
    const doctor = doctors.find((item) => item.id === selectedId)
    setSchedule(doctor ? scheduleFromDoctor(doctor) : null)
  }, [doctors, selectedId])

  const updateDay = (day: ApiScheduleDay, patch: Partial<ApiDoctorScheduleInput["weekly"][ApiScheduleDay]>) => {
    setSchedule((current) => current ? { ...current, weekly: { ...current.weekly, [day]: { ...current.weekly[day], ...patch } } } : current)
  }
  const save = async () => {
    if (!selectedId || !schedule) return
    setSaving(true)
    try {
      const saved = await api.updateDoctorSchedule(selectedId, schedule)
      setDoctors((items) => items.map((doctor) => doctor.id === selectedId ? { ...doctor, scheduleJson: saved.scheduleJson } : doctor))
      toast({ title: "Schedule saved", description: "Doctor availability and appointment slots were updated.", variant: "success" })
    } catch (error) { toast({ title: "Unable to save schedule", description: (error as ApiError).message, variant: "error" }) }
    finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading doctor schedules...</p>
  if (!doctors.length) return <p className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No doctors are available to configure.</p>
  const selectedDoctor = doctors.find((doctor) => doctor.id === selectedId)
  return <div className="flex flex-col gap-4">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
      <div><Label>Doctor</Label><Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.user.name} · {doctor.department?.name ?? "No department"}</option>)}</Select>{selectedDoctor && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{selectedDoctor.specialization || selectedDoctor.qualification || selectedDoctor.user.email}</p>}</div>
      <div><Label>Slot duration</Label><Select value={schedule?.slotDuration ?? 20} onChange={(event) => setSchedule((current) => current ? { ...current, slotDuration: Number(event.target.value) } : current)}><option value={10}>10 minutes</option><option value={15}>15 minutes</option><option value={20}>20 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></Select></div>
    </div>
    {schedule && <div className="overflow-x-auto rounded-lg border border-[var(--cp-border)]"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="p-3">Day</th><th className="p-3">Available</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Slots</th></tr></thead><tbody>{SCHEDULE_DAYS.map((day) => { const item = schedule.weekly[day]; const slotCount = item.enabled && item.start < item.end ? Math.max(0, Math.floor((new Date(`1970-01-01T${item.end}`).getTime() - new Date(`1970-01-01T${item.start}`).getTime()) / 60000 / schedule.slotDuration)) : 0; return <tr key={day} className="border-b border-[var(--cp-border)] last:border-0"><td className="p-3 font-semibold">{day}</td><td className="p-3"><input type="checkbox" checked={item.enabled} onChange={(event) => updateDay(day, { enabled: event.target.checked })} /></td><td className="p-3"><Input type="time" value={item.start} disabled={!item.enabled} onChange={(event) => updateDay(day, { start: event.target.value })} /></td><td className="p-3"><Input type="time" value={item.end} disabled={!item.enabled} onChange={(event) => updateDay(day, { end: event.target.value })} /></td><td className="p-3 text-xs text-[var(--cp-ink-soft)]">{item.enabled ? `${slotCount} appointment slots` : "Closed"}</td></tr> })}</tbody></table></div>}
    <div className="flex justify-end"><Button onClick={save} disabled={saving || !schedule}>{saving ? "Saving..." : "Save Schedule"}</Button></div>
  </div>
}

const notificationTypes: ApiNotificationType[] = ["APPOINTMENT_PENDING", "APPOINTMENT_CONFIRMED", "LAB_RESULT_READY", "CRITICAL_LAB_RESULT", "LOW_STOCK_MEDICINE", "NEAR_EXPIRY_MEDICINE", "BED_AVAILABLE", "PAYMENT_PENDING", "DISCHARGE_REMINDER", "SURGERY_STARTING_SOON", "OT_CHECKLIST_INCOMPLETE"]
const placeholderOptions = ["patientName", "date", "time", "doctorName", "testName", "amount", "receiptNumber", "medicineName", "bedName", "procedureName"]
const humanize = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/(^| )\S/g, (letter) => letter.toUpperCase())
const blankTemplate: ApiNotificationTemplateInput = { notificationType: "APPOINTMENT_CONFIRMED", name: "", titleTemplate: "", messageTemplate: "", availablePlaceholders: [], isActive: true }

function NotificationTemplatesPanel() {
  const { toast } = useToast()
  const [templates, setTemplates] = React.useState<ApiNotificationTemplate[]>([])
  const [editing, setEditing] = React.useState<ApiNotificationTemplate | null>(null)
  const [form, setForm] = React.useState<ApiNotificationTemplateInput>(blankTemplate)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState<ApiNotificationTemplate | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try { setTemplates(await api.listNotificationTemplates()) }
    catch (error) { toast({ title: "Unable to load templates", description: (error as ApiError).message, variant: "error" }) }
    finally { setLoading(false) }
  }, [toast])
  React.useEffect(() => { void load() }, [load])

  const openForm = (template?: ApiNotificationTemplate) => {
    setEditing(template ?? null)
    setForm(template ? { notificationType: template.notificationType, name: template.name, titleTemplate: template.titleTemplate, messageTemplate: template.messageTemplate, availablePlaceholders: template.availablePlaceholders, isActive: template.isActive } : { ...blankTemplate, availablePlaceholders: ["patientName", "date"] })
    setModalOpen(true)
  }
  const save = async () => {
    if (!form.name.trim() || !form.titleTemplate.trim() || !form.messageTemplate.trim()) return
    setSaving(true)
    try {
      const payload = { ...form, name: form.name.trim(), titleTemplate: form.titleTemplate.trim(), messageTemplate: form.messageTemplate.trim() }
      const saved = editing ? await api.updateNotificationTemplate(editing.id, payload) : await api.createNotificationTemplate(payload)
      setTemplates((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved].sort((a, b) => a.notificationType.localeCompare(b.notificationType)))
      setModalOpen(false); toast({ title: editing ? "Template updated" : "Template created", variant: "success" })
    } catch (error) { toast({ title: "Unable to save template", description: (error as ApiError).message, variant: "error" }) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!confirming) return
    try { await api.deleteNotificationTemplate(confirming.id); setTemplates((items) => items.filter((item) => item.id !== confirming.id)); setConfirming(null); toast({ title: "Template deleted", variant: "success" }) }
    catch (error) { toast({ title: "Unable to delete template", description: (error as ApiError).message, variant: "error" }) }
  }

  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading notification templates...</p>
  return <div className="flex flex-col gap-3">
    <div className="flex items-start justify-between gap-3"><p className="max-w-2xl text-sm text-[var(--cp-ink-soft)]">Use double braces for dynamic values, such as <code className="rounded bg-[var(--cp-bg)] px-1">{'{{patientName}}'}</code> or <code className="rounded bg-[var(--cp-bg)] px-1">{'{{date}}'}</code>.</p><Button size="sm" onClick={() => openForm()}>Add Template</Button></div>
    {!templates.length ? <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No notification templates configured.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Event</th><th>Name</th><th>Preview</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{templates.map((template) => <tr key={template.id} className="border-b border-[var(--cp-border)] last:border-0"><td className="py-3 font-semibold">{humanize(template.notificationType)}</td><td>{template.name}</td><td className="max-w-sm truncate text-[var(--cp-ink-soft)]">{template.titleTemplate}</td><td><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", template.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{template.isActive ? "Active" : "Inactive"}</span></td><td className="text-right"><Button variant="ghost" size="sm" onClick={() => openForm(template)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Delete ${template.name}`} onClick={() => setConfirming(template)}><Trash2 className="h-4 w-4 text-[var(--color-emergency)]" /></Button></td></tr>)}</tbody></table></div>}
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Notification Template" : "Add Notification Template"} size="lg"><div className="flex flex-col gap-4"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Event</Label><Select value={form.notificationType} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, notificationType: event.target.value as ApiNotificationType })}>{notificationTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}</Select></div><div><Label>Template name</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Appointment reminder" /></div></div><div><Label>Title template</Label><Input value={form.titleTemplate} onChange={(event) => setForm({ ...form, titleTemplate: event.target.value })} placeholder="Appointment reminder for {{patientName}}" /></div><div><Label>Message template</Label><Textarea rows={4} value={form.messageTemplate} onChange={(event) => setForm({ ...form, messageTemplate: event.target.value })} placeholder="Your appointment is scheduled for {{date}} at {{time}}." /></div><div><Label>Available placeholders</Label><div className="mt-2 flex flex-wrap gap-2">{placeholderOptions.map((placeholder) => <button type="button" key={placeholder} onClick={() => setForm({ ...form, availablePlaceholders: form.availablePlaceholders.includes(placeholder) ? form.availablePlaceholders.filter((item) => item !== placeholder) : [...form.availablePlaceholders, placeholder] })} className={cn("rounded-full border px-2.5 py-1 text-xs", form.availablePlaceholders.includes(placeholder) ? "border-[var(--cp-primary)] bg-[var(--cp-primary-light)] text-[var(--cp-primary)]" : "border-[var(--cp-border)] text-[var(--cp-ink-soft)]")}>{`{{${placeholder}}}`}</button>)}</div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active template</label><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving || !form.name.trim() || !form.titleTemplate.trim() || !form.messageTemplate.trim()}>{saving ? "Saving..." : "Save Template"}</Button></div></div></Modal>
    <ConfirmDialog open={Boolean(confirming)} onClose={() => setConfirming(null)} onConfirm={remove} title="Delete notification template?" description={`This will permanently delete ${confirming?.name ?? "this template"}.`} confirmLabel="Delete" destructive />
  </div>
}

function LabTestsPanel() {
  const { toast } = useToast()
  const [tests, setTests] = React.useState<ApiLabTest[]>([])
  const [editing, setEditing] = React.useState<ApiLabTest | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    testName: "",
    testCode: "",
    category: "",
    sampleType: "",
    price: "",
    unit: "",
    referenceRangeMin: "",
    referenceRangeMax: "",
    turnaroundTimeHours: "",
    isActive: true,
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const items = await api.listLabTests(true)
      setTests(items)
    } catch (error) {
      toast({ title: "Unable to load lab tests", description: (error as ApiError).message, variant: "error" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void load() }, [load])

  const openForm = (test?: ApiLabTest) => {
    setEditing(test ?? null)
    setForm({
      testName: test?.testName ?? "",
      testCode: test?.testCode ?? "",
      category: test?.category ?? "",
      sampleType: test?.sampleType ?? "",
      price: test?.price != null ? String(test.price) : "",
      unit: test?.unit ?? "",
      referenceRangeMin: test?.referenceRangeMin != null ? String(test.referenceRangeMin) : "",
      referenceRangeMax: test?.referenceRangeMax != null ? String(test.referenceRangeMax) : "",
      turnaroundTimeHours: test?.turnaroundTimeHours != null ? String(test.turnaroundTimeHours) : "",
      isActive: test?.isActive ?? true,
    })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.testName.trim() || !form.testCode.trim()) return
    const price = Number(form.price)
    if (!Number.isFinite(price) || price < 0) return

    setSaving(true)
    try {
      const payload = {
        testName: form.testName.trim(),
        testCode: form.testCode.trim(),
        category: form.category.trim() || undefined,
        sampleType: form.sampleType.trim() || undefined,
        price,
        unit: form.unit.trim() || undefined,
        referenceRangeMin: form.referenceRangeMin === "" ? undefined : Number(form.referenceRangeMin),
        referenceRangeMax: form.referenceRangeMax === "" ? undefined : Number(form.referenceRangeMax),
        turnaroundTimeHours: form.turnaroundTimeHours === "" ? undefined : Number(form.turnaroundTimeHours),
        isActive: form.isActive,
      }

      const saved = editing ? await api.updateLabTest(editing.id, payload) : await api.createLabTest(payload)
      setTests((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved].sort((a, b) => a.testName.localeCompare(b.testName)))
      setModalOpen(false)
      toast({ title: editing ? "Lab test updated" : "Lab test created", variant: "success" })
      await load()
    } catch (error) {
      toast({ title: "Unable to save lab test", description: (error as ApiError).message, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (test: ApiLabTest) => {
    try {
      await api.deleteLabTest(test.id)
      setTests((items) => items.filter((item) => item.id !== test.id))
      toast({ title: "Lab test archived", variant: "success" })
    } catch (error) { toast({ title: "Unable to archive lab test", description: (error as ApiError).message, variant: "error" }) }
  }

  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading lab tests...</p>

  return <div className="flex flex-col gap-3">
    <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Seeded medical reference ranges are placeholders only and must be reviewed by a pathologist before clinical use. Use Lab → Test Catalog to manage parameters and packages.</p>
    <div className="flex justify-end"><Button size="sm" onClick={() => openForm()}>Add Lab Test</Button></div>
    {!tests.length ? <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No lab tests configured.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Test</th><th>Code</th><th>Category</th><th>Sample</th><th>Price</th><th>Range</th><th>TAT</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{tests.map((test) => <tr key={test.id} className="border-b border-[var(--cp-border)] last:border-0"><td className="py-3 font-semibold">{test.testName}</td><td>{test.testCode}</td><td>{test.category ?? "—"}</td><td>{test.sampleType ?? "—"}</td><td>PKR {Number(test.price).toLocaleString()}</td><td>{test.referenceRangeMin != null || test.referenceRangeMax != null ? `${test.referenceRangeMin ?? "—"} - ${test.referenceRangeMax ?? "—"}` : "—"}</td><td>{test.turnaroundTimeHours != null ? `${test.turnaroundTimeHours}h` : "—"}</td><td><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", test.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{test.isActive ? "Active" : "Inactive"}</span></td><td className="text-right"><Button variant="ghost" size="sm" onClick={() => openForm(test)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Archive ${test.testName}`} onClick={() => void remove(test)}><Trash2 className="h-4 w-4 text-[var(--color-emergency)]" /></Button></td></tr>)}</tbody></table></div>}

    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Lab Test" : "Add Lab Test"} size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>Test name</Label><Input value={form.testName} onChange={(event) => setForm({ ...form, testName: event.target.value })} /></div>
          <div><Label>Test code</Label><Input value={form.testCode} onChange={(event) => setForm({ ...form, testCode: event.target.value })} /></div>
          <div><Label>Category</Label><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Chemistry" /></div>
          <div><Label>Sample type</Label><Input value={form.sampleType} onChange={(event) => setForm({ ...form, sampleType: event.target.value })} placeholder="Serum" /></div>
          <div><Label>Price (PKR)</Label><Input type="number" min="0" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></div>
          <div><Label>Unit</Label><Input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="mg/dL" /></div>
          <div><Label>Reference min</Label><Input type="number" step="0.01" value={form.referenceRangeMin} onChange={(event) => setForm({ ...form, referenceRangeMin: event.target.value })} /></div>
          <div><Label>Reference max</Label><Input type="number" step="0.01" value={form.referenceRangeMax} onChange={(event) => setForm({ ...form, referenceRangeMax: event.target.value })} /></div>
          <div><Label>Turnaround time (hours)</Label><Input type="number" min="0" step="1" value={form.turnaroundTimeHours} onChange={(event) => setForm({ ...form, turnaroundTimeHours: event.target.value })} /></div>
          <div><Label>Status</Label><Select value={form.isActive ? "ACTIVE" : "INACTIVE"} onChange={(event) => setForm({ ...form, isActive: event.target.value === "ACTIVE" })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></div>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !form.testName.trim() || !form.testCode.trim()}>{saving ? "Saving..." : editing ? "Save Changes" : "Create Test"}</Button></div>
      </div>
    </Modal>
  </div>
}

const WARD_AMENITIES = ["AC", "Attached Bathroom", "TV", "Oxygen Supply", "Cardiac Monitor"]
const WARD_TYPE_DEFAULTS: Record<string, { dailyRate: number; capacity: number }> = {
  "General Ward": { dailyRate: 3500, capacity: 10 },
  "Private Room": { dailyRate: 9000, capacity: 8 },
  ICU: { dailyRate: 22000, capacity: 6 },
}

function WardSetupPanel() {
  const { toast } = useToast()
  const [wards, setWards] = React.useState<ApiWard[]>([])
  const [editing, setEditing] = React.useState<ApiWard | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({ wardName: "", dailyRate: "", capacity: "", amenities: [] as string[], isActive: true })

  const load = React.useCallback(async () => {
    setLoading(true)
    try { setWards(await api.listWards(true)) }
    catch (error) { toast({ title: "Unable to load ward types", description: (error as ApiError).message, variant: "error" }) }
    finally { setLoading(false) }
  }, [toast])
  React.useEffect(() => { void load() }, [load])

  const openForm = (ward?: ApiWard) => {
    const defaults = WARD_TYPE_DEFAULTS[ward?.wardName ?? "General Ward"] ?? { dailyRate: 0, capacity: 1 }
    setEditing(ward ?? null)
    setForm({ wardName: ward?.wardName ?? "", dailyRate: ward ? String(ward.dailyRate) : String(defaults.dailyRate), capacity: ward ? String(ward.capacity) : String(defaults.capacity), amenities: Array.isArray(ward?.amenities) ? ward.amenities : [], isActive: ward?.isActive ?? true })
    setModalOpen(true)
  }

  const save = async () => {
    const name = form.wardName.trim()
    const dailyRate = Number(form.dailyRate)
    const capacity = Number(form.capacity)
    if (!name || !Number.isFinite(dailyRate) || dailyRate <= 0 || !Number.isInteger(capacity) || capacity <= 0) {
      toast({ title: "Check ward details", description: "Name, daily rate, and capacity must be valid positive values.", variant: "error" })
      return
    }
    if (wards.some((ward) => ward.id !== editing?.id && ward.wardName.trim().toLowerCase() === name.toLowerCase())) {
      toast({ title: "Ward type already exists", description: "Use a unique ward or room type name.", variant: "error" })
      return
    }
    setSaving(true)
    try {
      const payload = { wardName: name, wardType: editing?.wardType, dailyRate, capacity, amenities: form.amenities, isActive: form.isActive }
      const saved = editing ? await api.updateWard(editing.id, payload) : await api.createWard(payload)
      setWards((items) => editing ? items.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [...items, saved].sort((a, b) => a.wardName.localeCompare(b.wardName)))
      setModalOpen(false)
      toast({ title: editing ? "Ward type updated" : "Ward type created", description: "Beds and future ward charges now use the saved rate.", variant: "success" })
      await load()
    } catch (error) { toast({ title: "Unable to save ward type", description: (error as ApiError).message, variant: "error" }) }
    finally { setSaving(false) }
  }

  const archive = async (ward: ApiWard) => {
    try { await api.deleteWard(ward.id); await load(); toast({ title: "Ward type archived", variant: "success" }) }
    catch (error) { toast({ title: "Unable to archive ward type", description: (error as ApiError).message, variant: "error" }) }
  }

  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading ward types...</p>
  return <div className="flex flex-col gap-3">
    <div className="flex justify-end"><Button size="sm" onClick={() => openForm()}>+ Add Ward Type</Button></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{wards.map((ward) => <button type="button" key={ward.id} onClick={() => openForm(ward)} className={cn("rounded-lg border p-4 text-left transition-colors hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]", !ward.isActive && "opacity-60")}><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-[var(--cp-ink)]">{ward.wardName}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{Number(ward.dailyRate).toLocaleString()} / day · {ward.capacity} beds</p></div><span className={cn("rounded-full px-2 py-1 text-[10px] font-semibold", ward.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{ward.isActive ? "Active" : "Inactive"}</span></div><p className="mt-3 text-xs text-[var(--cp-ink-soft)]">{ward.amenities?.length ? ward.amenities.join(", ") : "No amenities configured"}</p></button>)}</div>
    {!wards.length && <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No ward types configured.</div>}
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Configure Ward Type" : "Add Ward Type"} size="lg"><div className="flex flex-col gap-4"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Ward / room type name</Label><Input value={form.wardName} onChange={(event) => setForm({ ...form, wardName: event.target.value })} placeholder="e.g. Deluxe Suite" /></div><div><Label>Daily rate (PKR)</Label><Input type="number" min="1" step="1" value={form.dailyRate} onChange={(event) => setForm({ ...form, dailyRate: event.target.value })} /></div><div><Label>Capacity (beds)</Label><Input type="number" min="1" step="1" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></div><div><Label>Status</Label><Select value={form.isActive ? "ACTIVE" : "INACTIVE"} onChange={(event) => setForm({ ...form, isActive: event.target.value === "ACTIVE" })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></div></div><div><Label>Amenities</Label><div className="mt-2 flex flex-wrap gap-2">{WARD_AMENITIES.map((amenity) => <label key={amenity} className="flex items-center gap-2 rounded-full border border-[var(--cp-border)] px-3 py-1.5 text-xs"><input type="checkbox" checked={form.amenities.includes(amenity)} onChange={(event) => setForm({ ...form, amenities: event.target.checked ? [...form.amenities, amenity] : form.amenities.filter((item) => item !== amenity) })} />{amenity}</label>)}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>{editing && <Button variant="ghost" onClick={() => { setModalOpen(false); void archive(editing) }}>Archive</Button>}<Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button></div></div></Modal>
  </div>
}

type RoomBedRow = { id: string; roomId: string; roomNumber: string; bedNumber: string; bedLabel: string; wardId: string; wardName: string; status: string; originalWardId: string; isRoomOnly?: boolean }
const toRoomBedRows = (items: ApiWard[]): RoomBedRow[] => items.flatMap((ward) => ward.rooms.flatMap((room) => room.beds.length ? room.beds.map((bed): RoomBedRow => ({ id: bed.id, roomId: room.id, roomNumber: room.roomNumber, bedNumber: bed.bedNumber, bedLabel: bed.bedLabel ?? "", wardId: ward.id, wardName: ward.wardName, status: bed.status, originalWardId: ward.id })) : [{ id: `room:${room.id}`, roomId: room.id, roomNumber: room.roomNumber, bedNumber: "", bedLabel: "", wardId: ward.id, wardName: ward.wardName, status: "No beds", originalWardId: ward.id, isRoomOnly: true }]))

function RoomBedSetupPanel() {
  const { toast } = useToast()
  const [wards, setWards] = React.useState<ApiWard[]>([])
  const [rows, setRows] = React.useState<RoomBedRow[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [deleted, setDeleted] = React.useState<string[]>([])
  const [addBatches, setAddBatches] = React.useState<Array<{ wardId: string; roomNumber: string; bedNumbers: string[] }>>([])
  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [bulkForm, setBulkForm] = React.useState({ wardId: "", roomNumber: "", prefix: "", start: "1", end: "5" })
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const items = await api.listWards(true)
      setWards(items)
      setRows(toRoomBedRows(items))
      setDeleted([]); setSelected([]); setAddBatches([])
      setBulkForm((current) => ({ ...current, wardId: current.wardId || items[0]?.id || "" }))
    } catch (error) { toast({ title: "Unable to load rooms and beds", description: (error as ApiError).message, variant: "error" }) }
    finally { setLoading(false) }
  }, [toast])
  React.useEffect(() => { void load() }, [load])

  const updateRow = (id: string, patch: Partial<RoomBedRow>) => setRows((items) => items.map((row) => row.id === id ? { ...row, ...patch, wardName: patch.wardId ? wards.find((ward) => ward.id === patch.wardId)?.wardName ?? row.wardName : row.wardName } : row))
  const toggleSelected = (id: string) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])
  const reassignSelected = (wardId: string) => setRows((items) => items.map((row) => selected.includes(row.id) ? { ...row, wardId, wardName: wards.find((ward) => ward.id === wardId)?.wardName ?? row.wardName } : row))

  const addBulk = () => {
    const startNumber = Number(bulkForm.start)
    const endNumber = Number(bulkForm.end)
    const letterRange = /^[A-Za-z]$/.test(bulkForm.start) && /^[A-Za-z]$/.test(bulkForm.end)
    const validNumeric = Number.isInteger(startNumber) && Number.isInteger(endNumber) && startNumber >= 1 && endNumber >= startNumber
    const validLetters = letterRange && bulkForm.start.toUpperCase().charCodeAt(0) <= bulkForm.end.toUpperCase().charCodeAt(0)
    if (!bulkForm.wardId || !bulkForm.roomNumber.trim() || (!validNumeric && !validLetters)) { toast({ title: "Check bulk bed details", description: "Choose a ward, room, and a valid numeric or letter bed range.", variant: "error" }); return }
    const start = letterRange ? bulkForm.start.toUpperCase().charCodeAt(0) : startNumber
    const end = letterRange ? bulkForm.end.toUpperCase().charCodeAt(0) : endNumber
    const bedNumbers = Array.from({ length: end - start + 1 }, (_, index) => `${bulkForm.prefix}${letterRange ? String.fromCharCode(start + index) : start + index}`)
    setAddBatches((items) => [...items, { wardId: bulkForm.wardId, roomNumber: bulkForm.roomNumber.trim(), bedNumbers }])
    setBulkOpen(false)
    toast({ title: `${bedNumbers.length} beds queued`, description: "Click Save Changes to persist the bulk addition.", variant: "success" })
  }

  const save = async () => {
    const visibleRows = rows.filter((row) => !deleted.includes(row.id))
    const duplicateKeys = new Set<string>()
    for (const row of visibleRows) {
      if (row.isRoomOnly) continue
      const key = `${row.wardId}:${row.roomNumber.trim().toLowerCase()}:${row.bedNumber.trim().toLowerCase()}`
      if (!row.roomNumber.trim() || !row.bedNumber.trim() || duplicateKeys.has(key)) { toast({ title: "Duplicate or empty bed identifier", description: "Room and bed identifiers must be unique within each ward.", variant: "error" }); return }
      duplicateKeys.add(key)
    }
    setSaving(true)
    try {
      const result = await api.bulkUpdateRoomBeds({
        roomUpdates: wards.flatMap((ward) => ward.rooms.filter((room) => visibleRows.some((row) => row.roomId === room.id)).map((room) => ({ id: room.id, wardId: visibleRows.find((row) => row.roomId === room.id)?.wardId ?? ward.id, roomNumber: visibleRows.find((row) => row.roomId === room.id)?.roomNumber ?? room.roomNumber }))),
        bedUpdates: visibleRows.filter((row) => !row.isRoomOnly).map((row) => ({ id: row.id, roomId: row.wardId === row.originalWardId ? row.roomId : undefined, wardId: row.wardId === row.originalWardId ? undefined : row.wardId, bedNumber: row.bedNumber.trim(), bedLabel: row.bedLabel.trim() || null })),
        deleteBedIds: deleted,
        addBeds: addBatches,
      })
      setWards(result)
      setRows(toRoomBedRows(result))
      setDeleted([]); setSelected([]); setAddBatches([])
      toast({ title: "Rooms and beds saved", description: "Ward Board will now show the updated records.", variant: "success" })
    } catch (error) { toast({ title: "Unable to save rooms and beds", description: (error as ApiError).message, variant: "error" }) }
    finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading rooms and beds...</p>
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><Button size="sm" onClick={() => setBulkOpen(true)}>+ Bulk Add Beds</Button><div className="flex items-center gap-2"><Select value="" onChange={(event) => reassignSelected(event.target.value)} disabled={!selected.length}><option value="">Reassign selected...</option>{wards.filter((ward) => ward.isActive).map((ward) => <option key={ward.id} value={ward.id}>{ward.wardName}</option>)}</Select><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button></div></div>
    {addBatches.length > 0 && <p className="text-xs text-[var(--cp-primary)]">{addBatches.reduce((total, batch) => total + batch.bedNumbers.length, 0)} new beds queued for saving.</p>}
    <div className="overflow-x-auto rounded-lg border border-[var(--cp-border)]"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="p-3"><input type="checkbox" aria-label="Select all beds" checked={rows.length > 0 && selected.length === rows.length} onChange={() => setSelected(selected.length === rows.length ? [] : rows.map((row) => row.id))} /></th><th className="p-3">Room Number</th><th className="p-3">Bed Number / Label</th><th className="p-3">Ward Type</th><th className="p-3">Status</th><th className="p-3 text-right">Delete</th></tr></thead><tbody>{rows.filter((row) => !deleted.includes(row.id)).map((row) => <tr key={row.id} className="border-b border-[var(--cp-border)] last:border-0"><td className="p-2"><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleSelected(row.id)} aria-label={`Select ${row.bedNumber || row.roomNumber}`} /></td><td className="p-2"><Input value={row.roomNumber} onChange={(event) => updateRow(row.id, { roomNumber: event.target.value })} /></td><td className="p-2">{row.isRoomOnly ? <span className="text-xs text-[var(--cp-ink-soft)]">No beds yet</span> : <div className="grid grid-cols-2 gap-2"><Input value={row.bedNumber} onChange={(event) => updateRow(row.id, { bedNumber: event.target.value })} /><Input value={row.bedLabel} placeholder="Label" onChange={(event) => updateRow(row.id, { bedLabel: event.target.value })} /></div>}</td><td className="p-2"><Select value={row.wardId} onChange={(event) => updateRow(row.id, { wardId: event.target.value })}>{wards.filter((ward) => ward.isActive).map((ward) => <option key={ward.id} value={ward.id}>{ward.wardName}</option>)}</Select></td><td className="p-2 text-xs font-semibold text-[var(--cp-ink-soft)]">{row.status}</td><td className="p-2 text-right"><Button variant="ghost" size="sm" disabled={row.isRoomOnly || row.status === "OCCUPIED"} title={row.status === "OCCUPIED" ? "Occupied beds cannot be deleted" : row.isRoomOnly ? "Rooms are retained while configuring beds" : "Delete bed"} onClick={() => setDeleted((items) => [...items, row.id])}>Delete</Button></td></tr>)}</tbody></table></div>
    {!rows.length && <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No rooms or beds configured.</div>}
    <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Bulk Add Beds"><div className="flex flex-col gap-4"><div><Label>Ward type</Label><Select value={bulkForm.wardId} onChange={(event) => setBulkForm({ ...bulkForm, wardId: event.target.value })}>{wards.filter((ward) => ward.isActive).map((ward) => <option key={ward.id} value={ward.id}>{ward.wardName}</option>)}</Select></div><div><Label>Room number</Label><Input value={bulkForm.roomNumber} onChange={(event) => setBulkForm({ ...bulkForm, roomNumber: event.target.value })} placeholder="101" /></div><div className="grid grid-cols-3 gap-3"><div><Label>Prefix</Label><Input value={bulkForm.prefix} onChange={(event) => setBulkForm({ ...bulkForm, prefix: event.target.value })} placeholder="Bed-" /></div><div><Label>Start</Label><Input value={bulkForm.start} onChange={(event) => setBulkForm({ ...bulkForm, start: event.target.value })} placeholder="A or 1" /></div><div><Label>End</Label><Input value={bulkForm.end} onChange={(event) => setBulkForm({ ...bulkForm, end: event.target.value })} placeholder="D or 10" /></div></div><p className="text-xs text-[var(--cp-ink-soft)]">Examples: A to D creates A, B, C, D. 1 to 10 creates ten numbered beds.</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button><Button onClick={addBulk}>Queue Beds</Button></div></div></Modal>
  </div>
}

function OTRoomsPanel() {
  const { toast } = useToast()
  const [rooms, setRooms] = React.useState<ApiOTRoom[]>([])
  const [removed, setRemoved] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try { setRooms(await api.listOTRooms(true)); setRemoved([]) }
    catch (error) { toast({ title: "Unable to load OT rooms", description: (error as ApiError).message, variant: "error" }) }
    finally { setLoading(false) }
  }, [toast])
  React.useEffect(() => { void load() }, [load])

  const updateRoom = (id: string, patch: Partial<ApiOTRoom>) => setRooms((items) => items.map((room) => room.id === id ? { ...room, ...patch } : room))
  const addRoom = () => setRooms((items) => [...items, { id: `new-${crypto.randomUUID()}`, name: "New OT Room", isActive: true }])
  const removeRoom = (room: ApiOTRoom) => setRemoved((items) => items.includes(room.id) ? items : [...items, room.id])

  const save = async () => {
    const visible = rooms.filter((room) => !removed.includes(room.id))
    const names = new Set<string>()
    for (const room of visible) {
      const name = room.name.trim()
      if (!name) { toast({ title: "OT room name required", description: "Every OT room must have a name.", variant: "error" }); return }
      const key = name.toLowerCase()
      if (names.has(key)) { toast({ title: "OT room names must be unique", description: `Duplicate name: ${name}`, variant: "error" }); return }
      names.add(key)
    }
    setSaving(true)
    try {
      await Promise.all([
        ...visible.map((room) => room.id.startsWith("new-") ? api.createOTRoom({ name: room.name.trim(), isActive: room.isActive }) : api.updateOTRoom(room.id, { name: room.name.trim(), isActive: room.isActive })),
        ...removed.filter((id) => !id.startsWith("new-")).map((id) => api.deleteOTRoom(id)),
      ])
      await load()
      toast({ title: "OT rooms saved", description: "Changes will remain after refresh and are available to surgery scheduling.", variant: "success" })
    } catch (error) { toast({ title: "Unable to save OT rooms", description: (error as ApiError).message, variant: "error" }) }
    finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading OT rooms...</p>
  return <div className="flex flex-col gap-3">
    <div className="flex justify-between gap-2"><Button size="sm" onClick={addRoom}>+ Add New OT Room</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button></div>
    <div className="overflow-x-auto rounded-lg border border-[var(--cp-border)]"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="p-3">Room Name</th><th className="p-3">Status</th><th className="p-3 text-right">Remove</th></tr></thead><tbody>{rooms.filter((room) => !removed.includes(room.id)).map((room) => <tr key={room.id} className="border-b border-[var(--cp-border)] last:border-0"><td className="p-2"><Input value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} /></td><td className="p-2"><button type="button" onClick={() => updateRoom(room.id, { isActive: !room.isActive })} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", room.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{room.isActive ? "Active" : "Inactive"}</button></td><td className="p-2 text-right"><Button variant="ghost" size="sm" onClick={() => removeRoom(room)}>Remove</Button></td></tr>)}</tbody></table></div>
    {!rooms.length && <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No OT rooms configured.</div>}
  </div>
}

function MedicineCategoriesPanel() {
  const { toast } = useToast()
  const [categories, setCategories] = React.useState<ApiMedicineCategory[]>([])
  const [editing, setEditing] = React.useState<ApiMedicineCategory | null>(null)
  const [confirming, setConfirming] = React.useState<ApiMedicineCategory | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", description: "", isActive: true })
  const load = React.useCallback(async () => { setLoading(true); try { setCategories(await api.listMedicineCategories()) } catch (error) { toast({ title: "Unable to load medicine categories", description: (error as ApiError).message, variant: "error" }) } finally { setLoading(false) } }, [toast])
  React.useEffect(() => { void load() }, [load])
  const openForm = (category?: ApiMedicineCategory) => { setEditing(category ?? null); setForm({ name: category?.name ?? "", description: category?.description ?? "", isActive: category?.isActive ?? true }); setModalOpen(true) }
  const save = async () => {
    const name = form.name.trim()
    if (!name) { toast({ title: "Category name required", variant: "error" }); return }
    if (categories.some((category) => category.id !== editing?.id && category.name.trim().toLowerCase() === name.toLowerCase())) { toast({ title: "Duplicate category", description: "Category names must be unique.", variant: "error" }); return }
    setSaving(true)
    try {
      const payload = { name, description: form.description.trim() || undefined, isActive: form.isActive }
      const saved = editing ? await api.updateMedicineCategory(editing.id, payload) : await api.createMedicineCategory(payload)
      setCategories((items) => (editing ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]).sort((a, b) => a.name.localeCompare(b.name)))
      setModalOpen(false)
      toast({ title: editing ? "Category updated" : "Category added", variant: "success" })
    } catch (error) { toast({ title: "Unable to save category", description: (error as ApiError).message, variant: "error" }) } finally { setSaving(false) }
  }
  const toggle = async (category: ApiMedicineCategory) => {
    try { const saved = await api.updateMedicineCategory(category.id, { name: category.name, description: category.description ?? undefined, isActive: !category.isActive }); setCategories((items) => items.map((item) => item.id === saved.id ? saved : item)); toast({ title: `Category ${saved.isActive ? "activated" : "deactivated"}`, variant: "success" }) }
    catch (error) { toast({ title: "Unable to update category status", description: (error as ApiError).message, variant: "error" }) }
  }
  const remove = async () => { if (!confirming) return; try { await api.deleteMedicineCategory(confirming.id); setCategories((items) => items.filter((item) => item.id !== confirming.id)); setConfirming(null); toast({ title: "Category deleted", variant: "success" }) } catch (error) { toast({ title: "Unable to delete category", description: (error as ApiError).message, variant: "error" }) } }
  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading medicine categories...</p>
  return <div className="flex flex-col gap-3"><div className="flex items-center justify-between gap-2"><p className="text-sm text-[var(--cp-ink-soft)]">Keep medicine categories organized for inventory and prescribing.</p><Button size="sm" onClick={() => openForm()}>Add Category</Button></div>{!categories.length ? <div className="rounded-lg border border-dashed border-[var(--cp-border-strong)] p-6 text-center text-sm text-[var(--cp-ink-soft)]">No medicine categories configured.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="py-2">Category</th><th>Description</th><th>Medicines</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id} className="border-b border-[var(--cp-border)] last:border-0"><td className="py-3 font-semibold">{category.name}</td><td className="max-w-xs truncate text-[var(--cp-ink-soft)]">{category.description || "—"}</td><td>{category._count?.medicines ?? 0}</td><td><button type="button" onClick={() => void toggle(category)} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", category.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>{category.isActive ? "Active" : "Inactive"}</button></td><td className="text-right"><Button variant="ghost" size="sm" onClick={() => openForm(category)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Delete ${category.name}`} onClick={() => setConfirming(category)}><Trash2 className="h-4 w-4 text-[var(--color-emergency)]" /></Button></td></tr>)}</tbody></table></div>}
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit Medicine Category" : "Add Medicine Category"}><div className="flex flex-col gap-4"><div><Label>Category name</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Antibiotics" /></div><div><Label>Description (optional)</Label><Textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Medicines used to treat bacterial infections" /></div><div><Label>Status</Label><Select value={form.isActive ? "ACTIVE" : "INACTIVE"} onChange={(event) => setForm({ ...form, isActive: event.target.value === "ACTIVE" })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving || !form.name.trim()}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Category"}</Button></div></div></Modal>
    <ConfirmDialog open={Boolean(confirming)} onClose={() => setConfirming(null)} onConfirm={remove} title="Delete medicine category?" description={confirming?._count?.medicines ? `${confirming.name} is assigned to ${confirming._count.medicines} medicine(s). Reassign them first before deleting.` : `This permanently deletes ${confirming?.name ?? "this category"}.`} confirmLabel="Delete" destructive />
  </div>
}

const invoiceSettingDefaults = { invoicePrefix: "INV", taxPercent: "0", currency: "PKR", terms: "Payment due at time of service." }
function InvoiceSettingsPanel() {
  const { toast } = useToast()
  const [form, setForm] = React.useState(invoiceSettingDefaults)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => { Promise.all(Object.keys(invoiceSettingDefaults).map((key) => api.getSetting(`invoice_${key}`))).then((values) => { const next = { ...invoiceSettingDefaults }; values.forEach((value, index) => { if (typeof value?.value === "string") next[Object.keys(invoiceSettingDefaults)[index] as keyof typeof next] = value.value }); setForm(next) }).catch((error) => toast({ title: "Unable to load invoice settings", description: (error as ApiError).message, variant: "error" })).finally(() => setLoading(false)) }, [toast])
  const save = async () => { const tax = Number(form.taxPercent); if (!form.invoicePrefix.trim() || !Number.isFinite(tax) || tax < 0 || tax > 100) { toast({ title: "Check invoice settings", description: "Prefix is required and tax must be between 0 and 100%.", variant: "error" }); return }; setSaving(true); try { await Promise.all(Object.entries(form).map(([key, value]) => api.updateSetting(`invoice_${key}`, value.trim()))); toast({ title: "Invoice settings saved", variant: "success" }) } catch (error) { toast({ title: "Unable to save invoice settings", description: (error as ApiError).message, variant: "error" }) } finally { setSaving(false) } }
  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading invoice settings...</p>
  return <div className="flex flex-col gap-4"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Invoice prefix</Label><Input value={form.invoicePrefix} onChange={(event) => setForm({ ...form, invoicePrefix: event.target.value })} /></div><div><Label>Tax percentage</Label><Input type="number" min="0" max="100" step="0.01" value={form.taxPercent} onChange={(event) => setForm({ ...form, taxPercent: event.target.value })} /></div><div><Label>Currency</Label><Select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>{["PKR", "USD", "AED", "SAR", "GBP", "EUR"].map((currency) => <option key={currency}>{currency}</option>)}</Select></div><div className="sm:col-span-2"><Label>Terms and conditions</Label><Textarea rows={4} value={form.terms} onChange={(event) => setForm({ ...form, terms: event.target.value })} /></div></div><div className="flex justify-end"><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button></div></div>
}

function PharmacyDiscountSettingsPanel() {
  const { toast } = useToast()
  const [limit, setLimit] = React.useState("10")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => {
    let active = true
    void api.getSetting("cashierMaxDiscountPercent").then((setting) => {
      if (active && setting) setLimit(String(setting.value ?? 10))
    }).catch((error) => toast({ title: "Unable to load pharmacy discount setting", description: (error as ApiError).message, variant: "error" })).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [toast])
  const save = async () => {
    const value = Number(limit)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast({ title: "Invalid discount limit", description: "Enter a percentage from 0 to 100.", variant: "error" })
      return
    }
    setSaving(true)
    try {
      await api.updateSetting("cashierMaxDiscountPercent", value)
      toast({ title: "Pharmacy discount limit saved", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to save discount limit", description: (error as ApiError).message, variant: "error" })
    } finally {
      setSaving(false)
    }
  }
  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading pharmacy discount settings...</p>
  return <div className="max-w-xl space-y-4">
    <p className="text-sm text-[var(--cp-ink-soft)]">Cashiers and pharmacists can approve discounts up to this percentage without an Admin. Larger discounts require Admin login confirmation and a reason.</p>
    <div><Label htmlFor="cashier-max-discount">Cashier maximum discount (%)</Label><Input id="cashier-max-discount" type="number" min="0" max="100" step="0.01" value={limit} onChange={(event) => setLimit(event.target.value)} /></div>
    <div className="flex justify-end"><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button></div>
  </div>
}

const permissionRoles = ["ADMIN", "BILLING_MANAGER", "DOCTOR", "NURSE", "RECEPTIONIST"]
const permissionModules = ["ward", "billing", "reports"] as const
const permissionLevels = ["Full", "View/Edit", "View", "None"] as const
type PermissionLevel = typeof permissionLevels[number]
type PermissionRow = { role: string; ward: PermissionLevel; billing: PermissionLevel; reports: PermissionLevel }
const permissionStorageKey = "careplus-role-permissions"
const defaultPermissionRows: PermissionRow[] = [
  { role: "ADMIN", ward: "Full", billing: "Full", reports: "Full" },
  { role: "DOCTOR", ward: "View/Edit", billing: "View", reports: "View" },
  { role: "NURSE", ward: "View/Edit", billing: "None", reports: "View" },
  { role: "RECEPTIONIST", ward: "View", billing: "View/Edit", reports: "View" },
]
const fullPermissionActions: ApiPermissionAction[] = ["view", "create", "edit", "delete", "export"]
const permissionActionsByLevel: Record<PermissionLevel, ApiPermissionAction[]> = {
  Full: fullPermissionActions,
  "View/Edit": ["view", "create", "edit"],
  View: ["view"],
  None: [],
}
function permissionLevel(actions: ApiPermissionAction[]): PermissionLevel {
  if (actions.length === fullPermissionActions.length && fullPermissionActions.every((action) => actions.includes(action))) return "Full"
  const viewEditActions: ApiPermissionAction[] = ["view", "create", "edit"]
  if (viewEditActions.every((action) => actions.includes(action)) && actions.length === 3) return "View/Edit"
  if (actions.length === 1 && actions[0] === "view") return "View"
  return "None"
}
function RolePermissionsPanel() {
  const { toast } = useToast()
  const [permissions, setPermissions] = React.useState<PermissionRow[]>(defaultPermissionRows)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [newRole, setNewRole] = React.useState("")
  React.useEffect(() => {
    const stored = window.localStorage.getItem(permissionStorageKey)
    let storedRows: PermissionRow[] | null = null
    try {
      const parsed = stored ? JSON.parse(stored) : null
      if (Array.isArray(parsed)) storedRows = parsed as PermissionRow[]
    } catch {
      window.localStorage.removeItem(permissionStorageKey)
    }
    api.listRolePermissions().then((items) => {
      const source = storedRows?.length ? storedRows : defaultPermissionRows
      const rows = source.map((row) => ({ ...row }))
      for (const role of permissionRoles) {
        const row = rows.find((item) => item.role === role) ?? { role, ward: "None" as PermissionLevel, billing: "None" as PermissionLevel, reports: "None" as PermissionLevel }
        for (const module of permissionModules) {
          const saved = items.find((item) => item.role === role && item.module === module)
          if (saved) row[module] = permissionLevel(saved.allowedActions)
        }
        if (!rows.includes(row)) rows.push(row)
      }
      setPermissions(rows)
    }).catch((error) => {
      if (storedRows?.length) setPermissions(storedRows)
      toast({ title: "Unable to load role permissions", description: (error as ApiError).message, variant: "error" })
    }).finally(() => setLoading(false))
  }, [toast])
  const updatePermission = (role: string, module: keyof Omit<PermissionRow, "role">, value: PermissionLevel) => setPermissions((items) => items.map((item) => item.role === role ? { ...item, [module]: value } : item))
  const addRole = () => {
    const role = newRole.trim().toUpperCase().replace(/\s+/g, "_")
    if (!role || permissions.some((item) => item.role === role)) return
    setPermissions((items) => [...items, { role, ward: "None", billing: "None", reports: "None" }])
    setNewRole("")
  }
  const save = async () => {
    setSaving(true)
    try {
      const builtInRows = permissions.filter((item) => permissionRoles.includes(item.role))
      await Promise.all(builtInRows.flatMap((row) => permissionModules.map((module) => api.updateRolePermission({ role: row.role, module, allowedActions: permissionActionsByLevel[row[module]] }))))
      window.localStorage.setItem(permissionStorageKey, JSON.stringify(permissions))
      toast({ title: "Role permissions saved", description: "Your permission changes are now persistent.", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to save role permissions", description: (error as ApiError).message, variant: "error" })
    } finally { setSaving(false) }
  }
  if (loading) return <p className="text-sm text-[var(--cp-ink-soft)]">Loading role permissions...</p>
  return <div className="flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Manage access by role</p><p className="text-xs text-[var(--cp-ink-soft)]">Changes apply after saving.</p></div><div className="flex gap-2"><Input value={newRole} onChange={(event) => setNewRole(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addRole() }} placeholder="New role name" aria-label="New role name" /><Button variant="outline" onClick={addRole}>+ Add Role</Button></div></div><div className="overflow-x-auto rounded-lg border border-[var(--cp-border)]"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-bg)] text-left text-xs uppercase text-[var(--cp-ink-soft)]"><th className="p-3">Role</th><th className="p-3">Ward Access</th><th className="p-3">Billing Access</th><th className="p-3">Reports</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{permissions.map((row) => <tr key={row.role} className="border-b border-[var(--cp-border)] last:border-0"><td className="p-2 font-semibold">{row.role.replace(/_/g, " ")}</td>{permissionModules.map((module) => <td key={module} className="p-2"><Select value={row[module]} onChange={(event) => updatePermission(row.role, module, event.target.value as PermissionLevel)} aria-label={`${row.role} ${module} access`}>{permissionLevels.map((level) => <option key={level} value={level}>{level}</option>)}</Select></td>)}<td className="p-2 text-right"><Button variant="ghost" size="sm" onClick={() => setPermissions((items) => items.filter((item) => item.role !== row.role))}>Delete</Button></td></tr>)}</tbody></table></div><div className="flex justify-end"><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button></div></div>
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
      .catch((cause) => toast({ title: "Unable to load settings", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }))
    return () => { cancelled = true }
  }, [section])

  React.useEffect(() => {
    if (section !== "Hospital Profile") return
    api.getHospitalProfile().then((value) => { if (value) { const next = { ...DEFAULT_PROFILE, ...value }; setProfile(next); storeHospitalProfile(next) } }).catch((cause) => toast({ title: "Unable to load hospital profile", description: cause instanceof Error ? cause.message : "Please try again.", variant: "error" }))
  }, [section, toast])

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
          pmdcRegistrationNo: profile.pmdcRegistrationNo?.trim() || null,
          phcRegistrationNo: profile.phcRegistrationNo?.trim() || null,
          phcRlNo: profile.phcRlNo?.trim() || null,
          clinicDaysTimings: profile.clinicDaysTimings?.trim() || null,
          refillText: profile.refillText?.trim() || null,
          dispensingStampText: profile.dispensingStampText?.trim() || null,
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
        <SettingsField label="PM&DC Registration No." value={profile.pmdcRegistrationNo ?? ""} onChange={(value) => updateProfile("pmdcRegistrationNo", value)} />
        <SettingsField label="PHC Registration No." value={profile.phcRegistrationNo ?? ""} onChange={(value) => updateProfile("phcRegistrationNo", value)} />
        <SettingsField label="PHC RL No." value={profile.phcRlNo ?? ""} onChange={(value) => updateProfile("phcRlNo", value)} />
        <SettingsField label="Contact Phone" value={profile.phone ?? ""} onChange={(value) => updateProfile("phone", value)} />
        <SettingsField label="Emergency Contact (recommended)" value={profile.emergencyContact ?? ""} onChange={(value) => updateProfile("emergencyContact", value)} placeholder="Emergency Number" />
        <SettingsField label="Email" value={profile.email ?? ""} onChange={(value) => updateProfile("email", value)} />
        <div><Label>Tax ID / NTN Number <span className="text-xs text-[var(--cp-ink-soft)]">(recommended)</span></Label><Input value={profile.taxId ?? ""} onChange={(e) => updateProfile("taxId", e.target.value)} placeholder="NTN-XXXXXXX" /><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Required for invoice compliance in Pakistan</p></div>
        <div><Label>Currency</Label><Select value={profile.currency} onChange={(e) => updateProfile("currency", e.target.value)}>{["PKR", "USD", "AED", "SAR", "GBP", "EUR"].map((currency) => <option key={currency}>{currency}</option>)}</Select></div>
        <div><Label>Timezone</Label><Select value={profile.timezone} onChange={(e) => updateProfile("timezone", e.target.value)}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</Select></div>
        <div className="sm:col-span-2"><SettingsField label="Address" value={profile.address ?? ""} onChange={(value) => updateProfile("address", value)} textarea /></div>
        <div className="sm:col-span-2"><SettingsField label="Clinic Days & Timings" value={profile.clinicDaysTimings ?? ""} onChange={(value) => updateProfile("clinicDaysTimings", value)} textarea placeholder="e.g. Mon-Sat, 9:00 AM - 5:00 PM" /></div>
        <div className="sm:col-span-2"><SettingsField label="Prescription Refill Text" value={profile.refillText ?? ""} onChange={(value) => updateProfile("refillText", value)} placeholder="e.g. Refills: 0 1 2 3 4" /></div>
        <div className="sm:col-span-2"><SettingsField label="Dispensing Stamp Text" value={profile.dispensingStampText ?? ""} onChange={(value) => updateProfile("dispensingStampText", value)} placeholder="Optional digital dispensing note" /></div>
        <div><Label>Hospital Logo</Label><label className="mt-1 flex min-h-28 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--cp-border-strong)] p-3 text-center text-sm text-[var(--cp-ink-soft)]"><input className="sr-only" type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => uploadAsset("logo", e.target.files?.[0])} />{profile.logoUrl ? <img src={apiAssetUrl(profile.logoUrl)} alt="Hospital logo" className="max-h-20 max-w-full object-contain" /> : uploading === "logo" ? "Uploading..." : "Drop or click to upload"}</label></div>
        <div><Label>Favicon</Label><label className="mt-1 flex min-h-28 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--cp-border-strong)] p-3 text-center text-sm text-[var(--cp-ink-soft)]"><input className="sr-only" type="file" accept="image/png,image/jpeg,image/svg+xml,image/x-icon" onChange={(e) => uploadAsset("favicon", e.target.files?.[0])} />{profile.faviconUrl ? <img src={apiAssetUrl(profile.faviconUrl)} alt="Hospital favicon" className="h-8 w-8 object-contain" /> : uploading === "favicon" ? "Uploading..." : "Upload 32 x 32 icon"}</label></div>
      </div>
    ),
    "Departments": (
      <DepartmentsPanel />
    ),
    "Doctor Schedules": (
      <DoctorSchedulesPanel />
    ),
    "Lab Tests": (
      <LabTestsPanel />
    ),
    "Notification Templates": (
      <NotificationTemplatesPanel />
    ),
    "Ward Setup": (
      <WardSetupPanel />
    ),
    "Room/Bed Setup": (
      <RoomBedSetupPanel />
    ),
    "Medicine Categories": (
      <MedicineCategoriesPanel />
    ),
    "OT Rooms": (
      <OTRoomsPanel />
    ),
    "Invoice Settings": (
      <InvoiceSettingsPanel />
    ),
    "Pharmacy Discounts": (
      <PharmacyDiscountSettingsPanel />
    ),
    "Role Permissions": (
      <RolePermissionsPanel />
    ),
  }

  return (
    <div className="flex flex-col gap-4">
      {content[section]}
      {section !== "Doctor Schedules" && section !== "Notification Templates" && section !== "Ward Setup" && section !== "Room/Bed Setup" && section !== "OT Rooms" && section !== "Medicine Categories" && section !== "Invoice Settings" && section !== "Pharmacy Discounts" && section !== "Role Permissions" && <div className="flex justify-end border-t border-[var(--cp-border)] pt-4">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
      </div>}
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
