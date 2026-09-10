import * as React from "react"
import {
  HeartPulse, Users, Activity, AlertTriangle, ListTodo, Lock, ChevronRight,
  Table2, LineChart as LineChartIcon, Flag,
} from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Modal, EmptyState } from "@/dashboard/components/Primitives"
import { LineChartWidget } from "@/dashboard/components/charts/Charts"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Bed } from "@/dashboard/types"
import { useToast } from "@/hooks/use-toast"
import { api, type ApiNursingTask, type ApiPatientVitals, type ApiWard } from "@/lib/api"

function VitalsForm({ bed, onClose }: { bed: Bed | null; onClose: () => void }) {
  const { toast } = useToast()
  const [bp, setBp] = React.useState("")
  const [temp, setTemp] = React.useState("")
  const [pulse, setPulse] = React.useState("")
  const [rr, setRr] = React.useState("")
  const [spo2, setSpo2] = React.useState("")
  const [pain, setPain] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { setBp(""); setTemp(""); setPulse(""); setRr(""); setSpo2(""); setPain("") }, [bed])
  if (!bed) return null

  return (
    <Modal open={!!bed} onClose={onClose} title={`Record Vitals — ${bed.patientName}`} description={`${bed.bedNumber} · ${bed.ward}`} size="md">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div><Label>Blood Pressure</Label><Input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="120/80" className="h-12 text-base" /></div>
        <div><Label>Temperature (°F)</Label><Input value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="98.6" className="h-12 cp-tabular text-base" /></div>
        <div><Label>Pulse (bpm)</Label><Input value={pulse} onChange={(e) => setPulse(e.target.value)} placeholder="76" className="h-12 cp-tabular text-base" /></div>
        <div><Label>Resp. Rate</Label><Input value={rr} onChange={(e) => setRr(e.target.value)} placeholder="16" className="h-12 cp-tabular text-base" /></div>
        <div><Label>SpO2 (%)</Label><Input value={spo2} onChange={(e) => setSpo2(e.target.value)} placeholder="98" className="h-12 cp-tabular text-base" /></div>
        <div><Label>Pain Score (0–10)</Label><Input value={pain} onChange={(e) => setPain(e.target.value)} placeholder="2" className="h-12 cp-tabular text-base" /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={async () => {
            if (!bp || !temp || !pulse) { toast({ title: "BP, Temperature and Pulse are required", variant: "error" }); return }
            const [bpSystolic, bpDiastolic] = bp.split("/").map(Number)
            if (!bed.admissionId || !Number.isFinite(bpSystolic) || !Number.isFinite(bpDiastolic)) { toast({ title: "Enter blood pressure as systolic/diastolic", variant: "error" }); return }
            setSaving(true)
            try {
              await api.recordVitals({ admissionId: bed.admissionId, bpSystolic, bpDiastolic, temperature: Number(temp), pulse: Number(pulse), respiratoryRate: rr ? Number(rr) : undefined, oxygenSaturation: spo2 ? Number(spo2) : undefined, painScore: pain ? Number(pain) : undefined })
              toast({ title: "Vitals recorded", description: `Saved for ${bed.patientName}.`, variant: "success" })
              onClose()
            } catch (error) {
              toast({ title: "Vitals failed", description: error instanceof Error ? error.message : "Unable to record vitals.", variant: "error" })
            } finally { setSaving(false) }
          }}
          disabled={saving}
        >
          Save Vitals
        </Button>
      </div>
    </Modal>
  )
}

export default function NursePanel() {
  const { beds, currentUser } = useDashboard()
  const [vitalsTab, setVitalsTab] = React.useState<"table" | "chart">("table")
  const [vitalsBed, setVitalsBed] = React.useState<Bed | null>(null)
  const [tasks, setTasks] = React.useState<ApiNursingTask[]>([])
  const [taskDescription, setTaskDescription] = React.useState("")
  const [taskAdmissionId, setTaskAdmissionId] = React.useState("")
  const [wards, setWards] = React.useState<ApiWard[]>([])
  const [assignmentWardId, setAssignmentWardId] = React.useState("")
  const [shiftDate, setShiftDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [shiftType, setShiftType] = React.useState<"MORNING" | "EVENING" | "NIGHT">("MORNING")
  const [vitalsHistory, setVitalsHistory] = React.useState<ApiPatientVitals[]>([])
  const [vitalsLoading, setVitalsLoading] = React.useState(false)
  const { toast } = useToast()

  const occupied = beds.filter((b) => b.status === "Occupied")
  const historyAdmissionId = occupied[0]?.admissionId
  const vitalsDue = occupied.slice(0, Math.max(1, Math.ceil(occupied.length / 2)))
  const critical = occupied.filter((b) => b.ward === "ICU")

  React.useEffect(() => {
    if (!historyAdmissionId) { setVitalsHistory([]); return }
    let active = true
    setVitalsLoading(true)
    api.listVitalsHistory(historyAdmissionId).then((history) => {
      if (active) setVitalsHistory(history)
    }).catch(() => {
      if (active) toast({ title: "Unable to load vitals history", variant: "error" })
    }).finally(() => { if (active) setVitalsLoading(false) })
    return () => { active = false }
  }, [historyAdmissionId, toast])

  React.useEffect(() => {
    let active = true
    Promise.all([api.listWards(), ...occupied.filter((bed) => bed.admissionId).map((bed) => api.listNursingTasks(bed.admissionId!))])
      .then(([wardResponse, ...taskResponses]) => {
        if (!active) return
        setWards(wardResponse as ApiWard[])
        setTasks((taskResponses as ApiNursingTask[][]).flat())
        if (!assignmentWardId) setAssignmentWardId((wardResponse as ApiWard[])[0]?.id ?? "")
        if (!taskAdmissionId) setTaskAdmissionId(occupied.find((bed) => bed.admissionId)?.admissionId ?? "")
      })
      .catch(() => { if (active) toast({ title: "Unable to load nursing tasks", variant: "error" }) })
    return () => { active = false }
  }, [beds, assignmentWardId, taskAdmissionId, toast])

  async function completeTask(task: ApiNursingTask) {
    try {
      const completed = await api.completeNursingTask(task.id)
      setTasks((current) => current.map((item) => item.id === completed.id ? completed : item))
      toast({ title: "Task completed", variant: "success" })
    } catch (error) { toast({ title: "Task completion failed", description: error instanceof Error ? error.message : "Unable to complete task.", variant: "error" }) }
  }

  async function createTask() {
    if (!taskAdmissionId || !taskDescription.trim()) return
    try {
      const task = await api.createNursingTask({ admissionId: taskAdmissionId, taskDescription: taskDescription.trim() })
      setTasks((current) => [task, ...current]); setTaskDescription("")
      toast({ title: "Task created", variant: "success" })
    } catch (error) { toast({ title: "Task creation failed", description: error instanceof Error ? error.message : "Unable to create task.", variant: "error" }) }
  }

  async function createAssignment() {
    if (!currentUser?.id || !assignmentWardId) return
    try {
      await api.createNurseAssignment({ nurseUserId: currentUser.id, wardId: assignmentWardId, shiftDate, shiftType })
      toast({ title: "Nurse assignment created", variant: "success" })
    } catch (error) { toast({ title: "Assignment failed", description: error instanceof Error ? error.message : "Unable to create assignment.", variant: "error" }) }
  }

  const vitalsChart = vitalsHistory.map((vital) => ({ label: new Date(vital.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), value: vital.oxygenSaturation ?? 0 }))

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Nurse Panel" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Assigned Patients" value={occupied.length.toString()} icon={Users} tone="primary" />
        <StatCard label="Current Ward" value={currentUser?.role === "nurse" ? "All Wards" : "—"} icon={HeartPulse} tone="primary" />
        <StatCard label="Vitals Due" value={vitalsDue.length.toString()} icon={Activity} tone="warning" />
        <StatCard label="Critical Alerts" value={critical.length.toString()} icon={AlertTriangle} tone="critical" />
        <StatCard label="Pending Tasks" value={tasks.filter((task) => task.status !== "COMPLETED").length.toString()} icon={ListTodo} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
          <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Nurse Assignment</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select value={assignmentWardId} onChange={(e) => setAssignmentWardId(e.target.value)}><option value="">Select ward</option>{wards.map((ward) => <option key={ward.id} value={ward.id}>{ward.wardName}</option>)}</Select>
            <Input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} />
            <Select value={shiftType} onChange={(e) => setShiftType(e.target.value as typeof shiftType)}><option value="MORNING">Morning</option><option value="EVENING">Evening</option><option value="NIGHT">Night</option></Select>
          </div>
          <Button className="mt-3" size="sm" onClick={createAssignment}>Assign Nurse</Button>
        </div>
        <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
          <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Add Nursing Task</p>
          <div className="flex gap-2"><Select value={taskAdmissionId} onChange={(e) => setTaskAdmissionId(e.target.value)}><option value="">Select patient</option>{occupied.filter((bed) => bed.admissionId).map((bed) => <option key={bed.admissionId} value={bed.admissionId}>{bed.patientName} · {bed.bedNumber}</option>)}</Select><Input value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} placeholder="Task description" /></div>
          <Button className="mt-3" size="sm" onClick={createTask} disabled={!taskAdmissionId || !taskDescription.trim()}>Add Task</Button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Nursing Tasks</p>
        {tasks.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No nursing tasks recorded.</p> : <div className="flex flex-col gap-2">{tasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 border-b border-[var(--cp-border)] py-2 last:border-0"><span className="text-sm text-[var(--cp-ink)]">{task.taskDescription}</span>{task.status === "COMPLETED" ? <span className="text-xs text-[var(--cp-success)]">Completed</span> : <Button size="sm" variant="outline" onClick={() => completeTask(task)}>Complete</Button>}</div>)}</div>}
      </div>

      {/* Assigned patients — table on desktop, cards on mobile */}
      <div>
        <p className="mb-2 text-sm font-bold text-[var(--cp-ink)]">Assigned Patients</p>
        {occupied.length === 0 ? (
          <EmptyState icon={Users} title="No patients assigned" description="Patients admitted to your wards will appear here." />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--cp-border)] bg-[var(--cp-surface-warm)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-soft)]">
                    <th className="px-4 py-3">Patient</th><th className="px-4 py-3">Bed</th><th className="px-4 py-3">Next Vitals</th><th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {occupied.map((b) => {
                    const overdue = vitalsDue.includes(b)
                    return (
                      <tr key={b.id} className="border-b border-[var(--cp-border)] last:border-0">
                        <td className="px-4 py-3 font-medium text-[var(--cp-ink)]">{b.patientName}</td>
                        <td className="cp-tabular px-4 py-3 text-[var(--cp-ink-soft)]">{b.bedNumber} · {b.ward}</td>
                        <td className="px-4 py-3">
                          {overdue ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cp-critical)]"><Flag className="h-3 w-3" /> Overdue</span> : <span className="text-xs text-[var(--cp-ink-soft)]">In 2 hrs</span>}
                        </td>
                        <td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => setVitalsBed(b)}>Record Vitals</Button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 sm:hidden">
              {occupied.map((b) => {
                const overdue = vitalsDue.includes(b)
                return (
                  <div key={b.id} className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4 cp-shadow">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-[var(--cp-ink)]">{b.patientName}</p>
                      {overdue && <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cp-critical)]"><Flag className="h-3 w-3" /> Overdue</span>}
                    </div>
                    <p className="cp-tabular mt-0.5 text-xs text-[var(--cp-ink-soft)]">{b.bedNumber} · {b.ward}</p>
                    <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setVitalsBed(b)}>Record Vitals</Button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Vitals history */}
      <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-[var(--cp-ink)]">Vitals History (SpO2 %) — {occupied[0]?.patientName ?? "Sample Patient"}</p>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--cp-border)] p-0.5">
            <button onClick={() => setVitalsTab("table")} className={`flex h-8 w-8 items-center justify-center rounded-md ${vitalsTab === "table" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]"}`}><Table2 className="h-4 w-4" /></button>
            <button onClick={() => setVitalsTab("chart")} className={`flex h-8 w-8 items-center justify-center rounded-md ${vitalsTab === "chart" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]"}`}><LineChartIcon className="h-4 w-4" /></button>
          </div>
        </div>
        {vitalsTab === "chart" ? (
          vitalsLoading ? (
            <p className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading vitals history...</p>
          ) : vitalsChart.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">No vitals recorded for this patient.</p>
          ) : (
            <LineChartWidget data={vitalsChart} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px] border-collapse text-sm">
              <thead><tr className="border-b border-[var(--cp-border)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-soft)]"><th className="px-2 py-2">Time</th><th className="px-2 py-2">SpO2</th><th className="px-2 py-2">Flag</th></tr></thead>
              <tbody>
                {vitalsHistory.map((vital) => (
                  <tr key={vital.id} className="border-b border-[var(--cp-border)] last:border-0">
                    <td className="px-2 py-2 text-[var(--cp-ink-soft)]">{new Date(vital.recordedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                    <td className="cp-tabular px-2 py-2 font-medium text-[var(--cp-ink)]">{vital.oxygenSaturation ?? "—"}%</td>
                    <td className="px-2 py-2">{(vital.oxygenSaturation ?? 100) < 96 ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cp-critical)]"><Flag className="h-3 w-3" /> Low</span> : <span className="text-xs text-[var(--cp-success)]">Normal</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Locked / read-only sections */}
      <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Clinical Records (Read-only)</p>
        <div className="flex flex-col gap-2">
          {["Doctor Diagnosis", "Signed Prescriptions", "Invoices", "Lab Results"].map((section) => (
            <div key={section} className="flex items-center justify-between rounded-lg border border-[var(--cp-border)] px-3 py-2.5">
              <span className="text-sm text-[var(--cp-ink)]">{section}</span>
              <span className="flex items-center gap-1.5 text-xs text-[var(--cp-ink-faint)]"><Lock className="h-3.5 w-3.5" /> View only <ChevronRight className="h-3.5 w-3.5" /></span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--cp-ink-faint)]">Nurses can view but not edit doctor-authored clinical records.</p>
      </div>

      <VitalsForm bed={vitalsBed} onClose={() => setVitalsBed(null)} />
    </div>
  )
}
