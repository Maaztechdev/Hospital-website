import * as React from "react"
import { useParams } from "react-router-dom"
import { Check, AlertOctagon, Printer, Upload, ShieldCheck } from "lucide-react"
import { DashboardPageHeader, NotPermitted } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { LabInterpretation, LabOrderStatus } from "@/dashboard/types"
import { formatDate, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { api, toLabOrder } from "@/lib/api"
import { apiAssetUrl, useHospitalProfile } from "@/lib/hospitalProfile"

const STEPS: LabOrderStatus[] = ["Ordered", "Sample Collected", "Processing", "Completed", "Verified"]

export default function LabOrderDetail() {
  const { orderId } = useParams()
  const { toast } = useToast()
  const profile = useHospitalProfile()
  const { labOrders, patients, dispatch } = useDashboard()
  const order = labOrders.find((l) => l.id === orderId)

  const [resultValue, setResultValue] = React.useState(order?.resultValue ?? "")
  const [unit, setUnit] = React.useState(order?.resultUnit ?? "")
  const [range, setRange] = React.useState(order?.referenceRange ?? "")
  const [interpretation, setInterpretation] = React.useState<LabInterpretation>(order?.interpretation ?? "Normal")
  const [notes, setNotes] = React.useState(order?.technicianNotes ?? "")
  const [fileName, setFileName] = React.useState(order?.reportFileName ?? "")

  React.useEffect(() => {
    if (!orderId) return
    api.getLabOrder(orderId).then((serverOrder) => {
      dispatch({ type: "UPDATE_LAB_ORDER", id: orderId, patch: toLabOrder(serverOrder, order) })
    }).catch(() => undefined)
  }, [orderId, dispatch])

  if (!order) return <NotPermitted />
  const patient = patients.find((p) => p.mrNumber === order.mrNumber)
  const stepIdx = STEPS.indexOf(order.status)

  async function refreshOrder() {
    const serverOrder = await api.getLabOrder(order!.id)
    dispatch({ type: "UPDATE_LAB_ORDER", id: order!.id, patch: toLabOrder(serverOrder, order) })
  }

  async function advanceTo(status: LabOrderStatus) {
    await api.updateLabSampleStatus(order!.id, status === "Sample Collected" ? "SAMPLE_COLLECTED" : "PROCESSING")
    await refreshOrder()
    toast({ title: `Order marked ${status}`, description: `${order!.testName} moved to ${status}.`, variant: "info" })
  }

  async function saveResult() {
    await api.enterLabResult(order!.id, { resultValue, unit, referenceRange: range, interpretation: interpretation.toUpperCase() as "NORMAL" | "HIGH" | "LOW" | "CRITICAL", technicianNotes: notes })
    await refreshOrder()
    toast({ title: "Result saved", description: interpretation === "Critical" ? "Critical result recorded — verify immediately." : "Result entered successfully.", variant: interpretation === "Critical" ? "error" : "success" })
  }

  async function verify() {
    await api.verifyLabOrder(order!.id)
    await refreshOrder()
    toast({ title: "Result verified", description: "Report is now finalized.", variant: "success" })
  }

  async function uploadReport(file: File) {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast({ title: "Unsupported report file", description: "Use a PDF, JPEG, or PNG up to 10 MB.", variant: "error" })
      return
    }
    await api.uploadLabReport(order!.id, file)
    setFileName(file.name)
    await refreshOrder()
    toast({ title: "Report uploaded", description: `${file.name} is attached to this order.`, variant: "success" })
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title={`Lab Order ${order.id}`}
        action={<Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print Report</Button>}
      />

      {order.interpretation === "Critical" && (
        <div className="flex items-center gap-3 rounded-xl border-2 border-[var(--cp-critical)] bg-[var(--cp-critical-light)] p-4">
          <AlertOctagon className="h-5 w-5 shrink-0 text-[var(--cp-critical)]" />
          <p className="text-sm font-bold text-[var(--cp-critical)]">Critical result — notify the ordering physician immediately.</p>
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[var(--cp-ink)]">{order.testName}</p>
              <p className="text-xs text-[var(--cp-ink-soft)]">{order.patientName} · {order.mrNumber} · Ordered by {order.doctorName} · {formatDate(order.orderDate)}</p>
            </div>
            <StatusBadge status={order.priority} />
          </div>

          {/* Status stepper */}
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                      i <= stepIdx ? "bg-[var(--cp-primary)] text-white" : "bg-[var(--cp-neutral-light)] text-[var(--cp-ink-faint)]"
                    )}
                  >
                    {i < stepIdx ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cn("hidden text-center text-[10px] font-medium sm:block", i <= stepIdx ? "text-[var(--cp-ink)]" : "text-[var(--cp-ink-faint)]")}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <span className={cn("mx-1 h-0.5 flex-1", i < stepIdx ? "bg-[var(--cp-primary)]" : "bg-[var(--cp-border)]")} />}
              </React.Fragment>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {order.status === "Ordered" && <Button size="sm" variant="outline" onClick={() => advanceTo("Sample Collected")}>Mark Sample Collected</Button>}
            {order.status === "Sample Collected" && <Button size="sm" variant="outline" onClick={() => advanceTo("Processing")}>Start Processing</Button>}
          </div>
        </CardContent>
      </Card>

      {(order.status === "Processing" || order.status === "Completed") && (
        <Card>
          <CardHeader><CardTitle>Result Entry</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="rv">Result Value</Label><Input id="rv" className="cp-tabular" value={resultValue} onChange={(e) => setResultValue(e.target.value)} /></div>
            <div><Label htmlFor="ru">Unit</Label><Input id="ru" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
            <div><Label htmlFor="rr">Reference Range</Label><Input id="rr" className="cp-tabular" value={range} onChange={(e) => setRange(e.target.value)} /></div>
            <div>
              <Label htmlFor="ri">Interpretation</Label>
              <Select id="ri" value={interpretation} onChange={(e) => setInterpretation(e.target.value as LabInterpretation)}>
                <option>Normal</option><option>High</option><option>Low</option><option>Critical</option>
              </Select>
            </div>
            <div className="sm:col-span-2"><Label htmlFor="tn">Technician Notes</Label><Textarea id="tn" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="sm:col-span-2">
              <Label htmlFor="upload">Report Upload</Label>
              <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-bg)] px-4 text-sm text-[var(--cp-ink-soft)] hover:border-[var(--cp-primary)]">
                <Upload className="h-4 w-4" /> {fileName || "Click to attach a PDF report"}
                <input id="upload" type="file" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadReport(file) }} />
              </label>
            </div>
            <div className="sm:col-span-2"><Button size="sm" onClick={saveResult}>Save Result</Button></div>
          </CardContent>
        </Card>
      )}

      {(order.resultValue || order.status === "Completed" || order.status === "Verified") && (
        <Card className="border-2">
          <CardContent className="p-6">
            <div className="mb-4 border-b border-[var(--cp-border)] pb-4 text-center">
              <div className="flex items-center justify-center gap-3">{profile.logoUrl && <img src={apiAssetUrl(profile.logoUrl)} alt="" className="h-10 w-10 object-contain" />}<div><p className="text-lg font-bold text-[var(--cp-ink)]">{profile.name} — Laboratory Report</p><p className="text-xs text-[var(--cp-ink-soft)]">{profile.address ?? ""} · Accredited Diagnostic Laboratory</p></div></div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-[var(--cp-ink-faint)]">Patient</p><p className="font-medium">{patient?.name}</p></div>
              <div><p className="text-xs text-[var(--cp-ink-faint)]">MR Number</p><p className="cp-tabular font-medium">{order.mrNumber}</p></div>
              <div><p className="text-xs text-[var(--cp-ink-faint)]">Age / Gender</p><p className="font-medium">{patient?.age} / {patient?.gender}</p></div>
              <div><p className="text-xs text-[var(--cp-ink-faint)]">Report Date</p><p className="font-medium">{formatDate(order.orderDate)}</p></div>
            </div>
            <table className="mb-4 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--cp-border)] text-left text-xs uppercase text-[var(--cp-ink-faint)]">
                  <th className="py-2">Test</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Interpretation</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--cp-border)]">
                  <td className="py-2">{order.testName}</td>
                  <td className="cp-tabular font-semibold">{order.resultValue ?? resultValue ?? "—"}</td>
                  <td>{order.resultUnit ?? unit}</td>
                  <td className="cp-tabular">{order.referenceRange ?? range}</td>
                  <td><StatusBadge status={order.interpretation ?? interpretation} /></td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-[var(--cp-ink-soft)]">Technician notes: {order.technicianNotes ?? notes ?? "—"}</p>
            {order.reportFileName && <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">Attached report: {order.reportFileName}</p>}
            <div className="mt-8 flex justify-between text-xs text-[var(--cp-ink-soft)]">
              <div>_____________________<br />Lab Technician</div>
              <div>_____________________<br />Pathologist Signature</div>
            </div>
            {order.status !== "Verified" && (
              <div className="mt-5 print:hidden">
                <Button size="sm" onClick={verify}><ShieldCheck className="h-4 w-4" /> Verify Result</Button>
              </div>
            )}
            {order.status === "Verified" && (
              <p className="mt-4 text-xs font-medium text-[var(--cp-success)] print:hidden">Verified by {order.verifiedBy} on {order.verifiedAt ? formatDateTime(order.verifiedAt) : ""}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
