import * as React from "react"
import { ScanLine, Plus, RefreshCw } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { api, type ApiUltrasoundOrder, type ApiUser } from "@/lib/api"
import { formatDateTime } from "@/dashboard/lib/format"

const inputClass = "w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm text-[var(--cp-ink)]"

export default function UltrasoundDashboard() {
  const { patients, currentUser } = useDashboard()
  const [orders, setOrders] = React.useState<ApiUltrasoundOrder[]>([])
  const [staff, setStaff] = React.useState<ApiUser[]>([])
  const [selected, setSelected] = React.useState<ApiUltrasoundOrder | null>(null)
  const [status, setStatus] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [showForm, setShowForm] = React.useState(false)
  const [form, setForm] = React.useState({ patientId: "", examType: "Abdominal", priority: "ROUTINE" as const, notes: "" })
  const [completeForm, setCompleteForm] = React.useState({ findings: "", impression: "" })
  const [imageFiles, setImageFiles] = React.useState<File[]>([])
  const [scheduleForm, setScheduleForm] = React.useState({ scheduledAt: "", technicianId: "" })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")

  const load = React.useCallback(async () => {
    setError("")
    try {
      const [loaded, users] = await Promise.all([api.listUltrasoundOrders(status ? { status } : {}), api.listUsers()])
      setOrders(loaded)
      setStaff(users.filter((user) => user.role === "ULTRASOUND_TECHNICIAN" || user.role === "RADIOLOGIST"))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load ultrasound orders") }
  }, [status])

  React.useEffect(() => { void load() }, [load])

  const run = async (action: () => Promise<ApiUltrasoundOrder>) => {
    setBusy(true); setError("")
    try { const updated = await action(); setSelected(updated); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed") } finally { setBusy(false) }
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("")
    try { await api.createUltrasoundOrder(form); setShowForm(false); setForm({ patientId: "", examType: "Abdominal", priority: "ROUTINE", notes: "" }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create order") } finally { setBusy(false) }
  }

  const visibleOrders = orders.filter((order) => {
    const text = `${order.patient?.firstName ?? ""} ${order.patient?.lastName ?? ""} ${order.patient?.mrNumber ?? ""} ${order.examType}`.toLowerCase()
    return text.includes(query.toLowerCase())
  })
  const canCreate = currentUser?.role === "doctor"
  const canWork = currentUser?.role === "admin" || currentUser?.role === "ultrasound_technician" || currentUser?.role === "radiologist"

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Ultrasound & Imaging" action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</Button>{canCreate && <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> New order</Button>}</div>} />
    {error && <p role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    {showForm && <Card><CardContent className="p-5"><form className="grid gap-3 sm:grid-cols-2" onSubmit={create}>
      <label className="text-sm font-medium">Patient<select required className={inputClass} value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })}><option value="">Select patient</option>{patients.map((patient) => <option key={patient.id ?? patient.mrNumber} value={patient.id}>{patient.name} ({patient.mrNumber})</option>)}</select></label>
      <label className="text-sm font-medium">Exam type<input required className={inputClass} value={form.examType} onChange={(e) => setForm({ ...form, examType: e.target.value })} /></label>
      <label className="text-sm font-medium">Priority<select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}><option value="ROUTINE">Routine</option><option value="URGENT">Urgent</option><option value="EMERGENCY">Stat / Emergency</option></select></label>
      <label className="text-sm font-medium sm:col-span-2">Clinical notes<textarea className={inputClass} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>Create order</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Close</Button></div>
    </form></CardContent></Card>}
    <div className="flex gap-3"><input className={inputClass} placeholder="Search patient, MR number, exam" value={query} onChange={(e) => setQuery(e.target.value)} /><select className="rounded-lg border border-[var(--cp-border)] bg-white px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="ORDERED">Ordered</option><option value="SCHEDULED">Scheduled</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>
    <Card><CardContent className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--cp-border)] text-xs text-[var(--cp-ink-soft)]"><th className="p-4">Patient</th><th className="p-4">Exam</th><th className="p-4">Priority</th><th className="p-4">Scheduled</th><th className="p-4">Technician</th><th className="p-4">Status</th></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id} className="cursor-pointer border-b border-[var(--cp-border)] hover:bg-[var(--cp-bg)]" onClick={() => setSelected(order)}><td className="p-4 font-medium">{order.patient?.firstName} {order.patient?.lastName}<span className="block text-xs text-[var(--cp-ink-soft)]">{order.patient?.mrNumber}</span></td><td className="p-4">{order.examType}</td><td className="p-4"><StatusBadge status={order.priority} /></td><td className="p-4">{order.scheduledAt ? formatDateTime(order.scheduledAt) : "Not scheduled"}</td><td className="p-4">{order.technician?.name ?? "Unassigned"}</td><td className="p-4"><StatusBadge status={order.status} /></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="p-8 text-center text-sm text-[var(--cp-ink-soft)]"><ScanLine className="mx-auto mb-2 h-7 w-7" />No ultrasound orders found.</div>}</CardContent></Card>
    {selected && <Card><CardContent className="flex flex-col gap-4 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{selected.examType}</h2><p className="text-sm text-[var(--cp-ink-soft)]">{selected.patient?.firstName} {selected.patient?.lastName} · {selected.patient?.mrNumber}</p></div><StatusBadge status={selected.status} /></div><p className="text-sm">{selected.notes || "No clinical notes recorded."}</p>
      {canWork && selected.status === "ORDERED" && <div className="grid gap-2 sm:grid-cols-3"><input type="datetime-local" className={inputClass} value={scheduleForm.scheduledAt} onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledAt: e.target.value })} /><select className={inputClass} value={scheduleForm.technicianId} onChange={(e) => setScheduleForm({ ...scheduleForm, technicianId: e.target.value })}><option value="">Assign staff</option>{staff.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><Button disabled={busy || !scheduleForm.scheduledAt} onClick={() => void run(() => api.scheduleUltrasound(selected.id, scheduleForm))}>Schedule</Button></div>}
      {canWork && selected.status === "SCHEDULED" && <Button className="w-fit" disabled={busy} onClick={() => void run(() => api.startUltrasound(selected.id))}>Start scan</Button>}
      {canWork && selected.status === "IN_PROGRESS" && <div className="flex flex-col gap-2"><textarea className={inputClass} rows={4} placeholder="Findings" value={completeForm.findings} onChange={(e) => setCompleteForm({ ...completeForm, findings: e.target.value })} /><textarea className={inputClass} rows={3} placeholder="Impression" value={completeForm.impression} onChange={(e) => setCompleteForm({ ...completeForm, impression: e.target.value })} /><label className="text-sm font-medium">Ultrasound images<input className={inputClass} type="file" accept="image/jpeg,image/png,application/dicom" multiple onChange={(e) => setImageFiles(Array.from(e.target.files ?? []))} /></label><Button className="w-fit" disabled={busy || !completeForm.findings || !completeForm.impression} onClick={() => void (async () => { setBusy(true); setError(""); try { const uploaded = imageFiles.length ? await api.uploadUltrasoundImages(selected.id, imageFiles) : selected; await run(() => api.completeUltrasound(uploaded.id, { findings: completeForm.findings, impression: completeForm.impression, imageUrls: uploaded.imageUrls })) } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to upload images") } finally { setBusy(false) } })()}>Complete scan</Button></div>}
      {selected.status !== "COMPLETED" && selected.status !== "CANCELLED" && (canWork || currentUser?.role === "doctor") && <Button variant="outline" className="w-fit" disabled={busy} onClick={() => void run(() => api.cancelUltrasound(selected.id))}>Cancel order</Button>}
      {selected.findings && <div><h3 className="font-semibold">Findings</h3><p className="whitespace-pre-wrap text-sm">{selected.findings}</p><h3 className="mt-3 font-semibold">Impression</h3><p className="whitespace-pre-wrap text-sm">{selected.impression}</p>{selected.imageUrls.map((url) => <a className="block text-sm text-[var(--cp-primary)] underline" href={url} target="_blank" rel="noreferrer" key={url}>{url}</a>)}</div>}
    </CardContent></Card>}
  </div>
}
