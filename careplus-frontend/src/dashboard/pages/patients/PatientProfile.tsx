import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  AlertTriangle, CalendarPlus, Stethoscope, FlaskConical, Receipt, BedDouble,
  Printer, Phone, Mail, MapPin, Droplet, ChevronDown, ChevronUp, Syringe,
  ArrowRightLeft, LogOut, Activity,
} from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Tabs } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatCurrency, formatDate, formatDateTime } from "@/dashboard/lib/format"
import { NotPermitted } from "@/dashboard/components/Layout"
import { AdmitPatientModal } from "@/dashboard/pages/ward/AdmitPatientModal"
import { OT_STATUS_META } from "@/dashboard/pages/ot/otStatusMeta"
import { cn } from "@/lib/utils"
import { api, type ApiUltrasoundOrder } from "@/lib/api"

const TABS = ["Overview", "Timeline", "Visits", "Prescriptions", "Lab Reports", "Ultrasound History", "Pharmacy", "Billing", "Admissions", "OT"]

const STAGE_ICON: Record<string, typeof BedDouble> = {
  "Ward Admission": BedDouble,
  "Discharge": LogOut,
  "OT Surgery": Syringe,
}

export default function PatientProfile() {
  const { mrNumber } = useParams()
  const navigate = useNavigate()
  const { patients, timeline, labOrders, invoices, consultations, admissions, surgeries } = useDashboard()
  const [tab, setTab] = React.useState("Overview")
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [admitOpen, setAdmitOpen] = React.useState(false)
  const [ultrasounds, setUltrasounds] = React.useState<ApiUltrasoundOrder[]>([])

  const patient = patients.find((p) => p.mrNumber === mrNumber)
  React.useEffect(() => {
    if (!patient?.id) return
    void api.listPatientUltrasounds(patient.id).then(setUltrasounds).catch(() => setUltrasounds([]))
  }, [patient?.id])
  if (!patient) return <NotPermitted />

  const patientTimeline = timeline.filter((t) => t.mrNumber === patient.mrNumber)
  const patientLab = labOrders.filter((l) => l.mrNumber === patient.mrNumber)
  const patientInvoices = invoices.filter((i) => i.mrNumber === patient.mrNumber)
  const patientConsultations = consultations.filter((c) => c.mrNumber === patient.mrNumber)
  const patientAdmissions = admissions.filter((a) => a.mrNumber === patient.mrNumber)
  const patientSurgeries = surgeries.filter((s) => s.mrNumber === patient.mrNumber)

  const totalBilled = patientInvoices.reduce((s, i) => s + i.lineItems.reduce((a, li) => a + li.qty * li.unitPrice - li.discount, 0), 0)
  const totalPaid = patientInvoices.reduce((s, i) => s + i.payments.reduce((a, p) => a + p.amount, 0), 0)

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Patient Profile"
        action={
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print Patient Summary
          </Button>
        }
      />

      {/* Header card */}
      <Card className="print:border-0 print:shadow-none">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--cp-primary-light)] text-lg font-bold text-[var(--cp-primary)]">
              {patient.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[var(--cp-ink)]">{patient.name}</h2>
                <StatusBadge status={patient.status} />
              </div>
              <p className="cp-tabular text-xs text-[var(--cp-ink-soft)]">{patient.mrNumber} · {patient.age} yrs · {patient.gender}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--cp-ink-soft)]">
                <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {patient.phone}</span>
                {patient.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {patient.email}</span>}
                {patient.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {patient.address}</span>}
                <span className="inline-flex items-center gap-1"><Droplet className="h-3.5 w-3.5" /> {patient.bloodGroup}</span>
              </div>
              {patient.allergies.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--cp-critical)] bg-[var(--cp-critical-light)] px-2.5 py-1 text-xs font-bold text-[var(--cp-critical)]">
                    <AlertTriangle className="h-3.5 w-3.5" /> Allergies:
                  </span>
                  {patient.allergies.map((a) => (
                    <span key={a} className="rounded-full border border-[var(--cp-critical)] px-2 py-0.5 text-xs font-semibold text-[var(--cp-critical)]">{a}</span>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">Emergency contact: <span className="cp-tabular font-medium text-[var(--cp-ink)]">{patient.emergencyContact}</span></p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/appointments?mr=${patient.mrNumber}&name=${encodeURIComponent(patient.name)}`)}>
              <CalendarPlus className="h-4 w-4" /> Book Appointment
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/doctor?mr=${patient.mrNumber}`)}>
              <Stethoscope className="h-4 w-4" /> Start Consultation
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/lab?mr=${patient.mrNumber}`)}>
              <FlaskConical className="h-4 w-4" /> Add Lab Test
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/ultrasound?patientId=${patient.id}`)}>
              <Activity className="h-4 w-4" /> Add Ultrasound
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/billing?mr=${patient.mrNumber}`)}>
              <Receipt className="h-4 w-4" /> Create Invoice
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdmitOpen(true)}>
              <BedDouble className="h-4 w-4" /> Admit Patient
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="print:hidden">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <div className="print:hidden">
        {tab === "Overview" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Total Billed</p><p className="cp-tabular mt-1 text-xl font-bold text-[var(--cp-ink)]">{formatCurrency(totalBilled)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Total Paid</p><p className="cp-tabular mt-1 text-xl font-bold text-[var(--cp-success)]">{formatCurrency(totalPaid)}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Balance</p><p className="cp-tabular mt-1 text-xl font-bold text-[var(--cp-warning)]">{formatCurrency(patient.balance)}</p></CardContent></Card>
            <Card className="sm:col-span-3"><CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">Registration details</p>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-[var(--cp-ink-soft)]">Date of Birth</dt><dd className="text-[var(--cp-ink)]">{formatDate(patient.dob)}</dd></div>
                <div><dt className="text-xs text-[var(--cp-ink-soft)]">CNIC</dt><dd className="cp-tabular text-[var(--cp-ink)]">{patient.cnic ?? "—"}</dd></div>
                <div><dt className="text-xs text-[var(--cp-ink-soft)]">Registered On</dt><dd className="text-[var(--cp-ink)]">{formatDate(patient.registeredAt)}</dd></div>
                <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-[var(--cp-ink-soft)]">Notes</dt><dd className="text-[var(--cp-ink)]">{patient.notes ?? "No additional notes."}</dd></div>
              </dl>
            </CardContent></Card>
          </div>
        )}

        {tab === "Timeline" && (
          <Card><CardContent className="p-5">
            {patientTimeline.length === 0 ? (
              <p className="text-sm text-[var(--cp-ink-soft)]">No recorded events yet for this patient.</p>
            ) : (
              <ol className="relative flex flex-col gap-6 border-l-2 border-[var(--cp-primary-light)] pl-5">
                {patientTimeline.map((ev) => {
                  const Icon = STAGE_ICON[ev.stage]
                  return (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[27px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--cp-surface)] bg-[var(--cp-primary)] text-white cp-shadow">
                      {Icon ? <Icon className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <button onClick={() => setExpanded(expanded === ev.id ? null : ev.id)} className="flex w-full items-start justify-between gap-3 pl-2 text-left">
                      <div>
                        <p className="text-sm font-semibold text-[var(--cp-ink)]">{ev.stage}</p>
                        <p className="text-xs text-[var(--cp-ink-soft)]">{formatDateTime(ev.datetime)} · {ev.department} · {ev.staff}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={ev.status} />
                        {ev.details && (expanded === ev.id ? <ChevronUp className="h-4 w-4 text-[var(--cp-ink-faint)]" /> : <ChevronDown className="h-4 w-4 text-[var(--cp-ink-faint)]" />)}
                      </div>
                    </button>
                    {expanded === ev.id && ev.details && (
                      <p className="mt-2 ml-2 rounded-lg bg-[var(--cp-bg)] p-3 text-sm text-[var(--cp-ink-soft)]">{ev.details}</p>
                    )}
                  </li>
                )})}
              </ol>
            )}
          </CardContent></Card>
        )}

        {tab === "Visits" && (
          <Card><CardContent className="p-5">
            <p className="mb-3 text-sm text-[var(--cp-ink-soft)]">All OPD consultations recorded for {patient.name}.</p>
            {patientConsultations.length === 0 ? (
              <p className="text-sm text-[var(--cp-ink-faint)]">No consultations recorded yet.</p>
            ) : patientConsultations.map((c) => (
              <div key={c.id} className="mb-2 rounded-lg border border-[var(--cp-border)] p-3 last:mb-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--cp-ink)]">{c.doctorName} — {formatDate(c.date)}</p>
                  <StatusBadge status={c.status} />
                </div>
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Diagnosis: {c.diagnosis || "—"}</p>
              </div>
            ))}
          </CardContent></Card>
        )}

        {tab === "Prescriptions" && (
          <Card><CardContent className="p-5">
            {patientConsultations.flatMap((c) => c.prescriptions).length === 0 ? (
              <p className="text-sm text-[var(--cp-ink-soft)]">No prescriptions issued yet.</p>
            ) : patientConsultations.map((c) => c.prescriptions.length > 0 && (
              <div key={c.id} className="mb-3 rounded-lg border border-[var(--cp-border)] p-3 last:mb-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-faint)]">{formatDate(c.date)} · {c.doctorName} · <StatusBadge status={c.status} /></p>
                <ul className="flex flex-col gap-1 text-sm">
                  {c.prescriptions.map((p) => <li key={p.id}>{p.medicine} — {p.dosage}, {p.frequency}, {p.duration}</li>)}
                </ul>
              </div>
            ))}
          </CardContent></Card>
        )}

        {tab === "Lab Reports" && (
          <Card><CardContent className="p-5">
            {patientLab.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No lab orders yet.</p> : (
              <ul className="flex flex-col gap-2">
                {patientLab.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--cp-ink)]">{l.testName}</p>
                      <p className="text-xs text-[var(--cp-ink-soft)]">{formatDate(l.orderDate)} · Ordered by {l.doctorName}</p>
                    </div>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        )}

        {tab === "Ultrasound History" && (
          <Card><CardContent className="p-5">
            {ultrasounds.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No ultrasound records yet.</p> : (
              <ul className="flex flex-col gap-2">
                {ultrasounds.map((scan) => <li key={scan.id} className="rounded-lg border border-[var(--cp-border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[var(--cp-ink)]">{scan.examType}</p><StatusBadge status={scan.status} /></div>
                  <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{formatDateTime(scan.createdAt)} · {scan.doctor?.user.name ?? "Ordering doctor"} · {scan.priority}</p>
                  {scan.impression && <p className="mt-2 text-sm text-[var(--cp-ink)]">{scan.impression}</p>}
                </li>)}
              </ul>
            )}
          </CardContent></Card>
        )}

        {tab === "Pharmacy" && (
          <Card><CardContent className="p-5"><p className="text-sm text-[var(--cp-ink-soft)]">Dispensed medicines linked to this patient's signed prescriptions will appear here once dispensed from the Pharmacy module.</p></CardContent></Card>
        )}

        {tab === "Billing" && (
          <Card><CardContent className="p-5">
            {patientInvoices.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No invoices for this patient yet.</p> : (
              <ul className="flex flex-col gap-2">
                {patientInvoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3 cursor-pointer hover:bg-[var(--cp-bg)]" onClick={() => navigate(`/dashboard/billing/${inv.id}`)}>
                    <div>
                      <p className="cp-tabular text-sm font-semibold text-[var(--cp-ink)]">{inv.id}</p>
                      <p className="text-xs text-[var(--cp-ink-soft)]">{formatDate(inv.date)}</p>
                    </div>
                    <StatusBadge status={inv.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        )}

        {tab === "Admissions" && (
          <div className="flex flex-col gap-3">
            {patientAdmissions.length === 0 ? (
              <Card><CardContent className="p-5"><p className="text-sm text-[var(--cp-ink-soft)]">No ward admission history for this patient.</p></CardContent></Card>
            ) : (
              patientAdmissions.map((a) => (
                <Card key={a.id}><CardContent className="flex flex-col gap-2 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--cp-ink)]">{a.bedNumber} · {a.ward}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-xs text-[var(--cp-ink-soft)]">Admitted {formatDateTime(a.admissionDate)} under {a.doctorName} — {a.admissionType}</p>
                  <p className="text-sm text-[var(--cp-ink)]">{a.reason}</p>
                  {a.dischargeDate && <p className="text-xs text-[var(--cp-ink-soft)]">Discharged {formatDateTime(a.dischargeDate)}</p>}
                  <div className="mt-1 flex flex-wrap gap-4 text-xs text-[var(--cp-ink-soft)]">
                    <span>Deposit: <span className="cp-tabular font-semibold text-[var(--cp-ink)]">{formatCurrency(a.depositAmount)}</span></span>
                    <span>Outstanding: <span className="cp-tabular font-semibold text-[var(--cp-warning)]">{formatCurrency(a.outstandingBalance)}</span></span>
                  </div>
                </CardContent></Card>
              ))
            )}
          </div>
        )}

        {tab === "OT" && (
          <div className="flex flex-col gap-3">
            {patientSurgeries.length === 0 ? (
              <Card><CardContent className="p-5"><p className="text-sm text-[var(--cp-ink-soft)]">No OT / surgery records for this patient.</p></CardContent></Card>
            ) : (
              patientSurgeries.map((s) => {
                const meta = OT_STATUS_META[s.status]
                return (
                  <Card key={s.id}><CardContent className="flex flex-col gap-2 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--cp-ink)]">{s.procedureName}</p>
                      <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold", meta.bg, meta.tone)}><Syringe className="h-3 w-3" /> {s.status}</span>
                    </div>
                    <p className="text-xs text-[var(--cp-ink-soft)]">{s.otRoom} · {s.scheduledDate} at {s.scheduledTime} · {s.surgeonName}</p>
                    <Button size="sm" variant="outline" className="w-fit" onClick={() => navigate(`/dashboard/ot/${s.id}`)}><Activity className="h-3.5 w-3.5" /> View Surgery</Button>
                  </CardContent></Card>
                )
              })
            )}
          </div>
        )}
      </div>

      <AdmitPatientModal open={admitOpen} onClose={() => setAdmitOpen(false)} prefillMR={patient.mrNumber} />

      {/* Print-only summary */}
      <div className="hidden print:block">
        <h2 className="text-lg font-bold">Patient Summary — {patient.name}</h2>
        <p>{patient.mrNumber} · {patient.age} yrs · {patient.gender} · {patient.bloodGroup}</p>
        <p>Allergies: {patient.allergies.join(", ") || "None recorded"}</p>
      </div>
    </div>
  )
}
