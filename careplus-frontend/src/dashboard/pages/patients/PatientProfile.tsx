import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  AlertTriangle, CalendarPlus, Stethoscope, FlaskConical, Receipt, BedDouble,
  Printer, Phone, Mail, MapPin, Droplet, ChevronDown, ChevronUp, Syringe,
  LogOut, Activity,
} from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Tabs } from "@/dashboard/components/Primitives"
import { StatusBadge } from "@/dashboard/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { displayPakistaniPhone, formatBloodGroup, formatCurrency, formatDate, formatDateTime } from "@/dashboard/lib/format"
import { NotPermitted } from "@/dashboard/components/Layout"
import { AdmitPatientModal } from "@/dashboard/pages/ward/AdmitPatientModal"
import { AddAdmissionDepositModal } from "@/dashboard/components/ward/AddAdmissionDepositModal"
import { OT_STATUS_META } from "@/dashboard/pages/ot/otStatusMeta"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { api, openAuthenticatedPrintWindow, toPatient, toSurgery, type ApiPatientClinicalSummary, type ApiPatientProfileData } from "@/lib/api"

const TABS = ["Overview", "Timeline", "Visits", "Prescriptions", "Lab Reports", "Ultrasound History", "Pharmacy", "Billing", "Admissions", "OT"]

const STAGE_ICON: Record<string, typeof BedDouble> = {
  "Ward Admission": BedDouble,
  "Discharge": LogOut,
  "OT Surgery": Syringe,
}

export default function PatientProfile() {
  const { mrNumber } = useParams()
  const navigate = useNavigate()
  const { patients, currentUser, dispatch } = useDashboard()
  const isLabTechnician = currentUser?.role === "lab_technician"
  const { toast } = useToast()
  const [tab, setTab] = React.useState("Overview")
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [admitOpen, setAdmitOpen] = React.useState(false)
  const [depositAdmission, setDepositAdmission] = React.useState<{ id: string; patientName: string } | null>(null)
  const [profileData, setProfileData] = React.useState<ApiPatientProfileData | null>(null)
  const [clinicalSummary, setClinicalSummary] = React.useState<ApiPatientClinicalSummary | null>(null)
  const [clinicalSummaryError, setClinicalSummaryError] = React.useState("")
  const [clinicalSummaryRetry, setClinicalSummaryRetry] = React.useState(0)
  const [profileLoading, setProfileLoading] = React.useState(true)
  const [profileError, setProfileError] = React.useState<string | null>(null)
  const [profileRefresh, setProfileRefresh] = React.useState(0)
  const [startingConsultation, setStartingConsultation] = React.useState(false)

  const dashboardPatient = patients.find((p) => p.mrNumber === mrNumber)
  const patient = profileData ? toPatient(profileData.patient) : dashboardPatient
  const visibleTabs = isLabTechnician ? TABS.filter((name) => name !== "Billing") : TABS
  const loadPatientProfile = React.useCallback(() => {
    setProfileLoading(true)
    setProfileError(null)
    const profileRequest = dashboardPatient?.id
      ? api.getPatientProfile(dashboardPatient.id)
      : mrNumber
        ? api.searchPatients(mrNumber, 10).then((results) => {
          const match = results.find((item) => item.mrNumber === mrNumber)
          if (!match) throw new Error(`Patient ${mrNumber} was not found or is not accessible to your account.`)
          return api.getPatientProfile(match.id)
        })
        : Promise.reject(new Error("A patient medical record number is required to load this profile."))
    profileRequest
      .then(setProfileData)
      .catch((cause: unknown) => setProfileError(cause instanceof Error ? cause.message : "Unable to load this patient's records."))
      .finally(() => setProfileLoading(false))
  }, [dashboardPatient?.id, mrNumber])
  React.useEffect(() => {
    loadPatientProfile()
    const invalidate = () => loadPatientProfile()
    window.addEventListener("careplus:data-invalidated", invalidate)
    return () => window.removeEventListener("careplus:data-invalidated", invalidate)
  }, [loadPatientProfile, profileRefresh])
  const patientId = profileData?.patient.id ?? dashboardPatient?.id
  React.useEffect(() => {
    if (!patientId) return
    setClinicalSummaryError("")
    api.getPatientClinicalSummary(patientId)
      .then(setClinicalSummary)
      .catch((cause: unknown) => setClinicalSummaryError(cause instanceof Error ? cause.message : "Clinical history could not be loaded."))
  }, [patientId, clinicalSummaryRetry])
  if (!patient && !profileLoading) return <NotPermitted />
  if (!patient) return <div className="flex flex-col gap-4"><div className="h-10 w-56 animate-pulse rounded bg-[var(--cp-border)]" /><div className="h-40 animate-pulse rounded-xl bg-[var(--cp-border)]" /></div>

  const canBookAppointment = ["admin", "receptionist", "doctor", "nurse"].includes(currentUser?.role ?? "")
  const canAddLab = ["admin", "doctor", "receptionist"].includes(currentUser?.role ?? "")
  const canCreateInvoice = ["admin", "receptionist"].includes(currentUser?.role ?? "")
  const canAdmitPatient = ["admin", "billing_manager", "receptionist", "doctor"].includes(currentUser?.role ?? "")
  const canTakePayments = ["admin", "billing_manager", "receptionist"].includes(currentUser?.role ?? "")

  const patientTimeline = profileData ? [
    ...profileData.consultations.map((visit) => ({
      id: visit.id, stage: "OPD Consultation", datetime: visit.appointment.appointmentDate,
      department: visit.doctor.department?.name ?? "OPD", staff: visit.doctor.user.name,
      status: visit.prescriptionStatus, details: visit.diagnosis ?? visit.chiefComplaint ?? "",
    })),
    ...profileData.admissions.map((admission) => ({
      id: admission.id, stage: admission.status === "DISCHARGED" ? "Discharge" : "Ward Admission",
      datetime: admission.dischargeDate ?? admission.admissionDate,
      department: admission.bed.room.ward.wardName, staff: admission.attendingDoctor?.user.name ?? "Staff",
      status: admission.status, details: admission.admissionReason,
    })),
    ...profileData.surgeries.map((surgery) => ({
      id: surgery.id, stage: "OT Surgery", datetime: surgery.scheduledStart,
      department: surgery.otRoom.name, staff: surgery.surgeon.user.name,
      status: surgery.status, details: surgery.surgeryType,
    })),
    ...profileData.labOrders.map((order) => ({
      id: order.id, stage: "Lab Order", datetime: order.orderedAt,
      department: "Laboratory", staff: order.doctor?.user.name ?? "Not recorded",
      status: order.status, details: order.test.testName,
    })),
    ...profileData.ultrasoundOrders.map((order) => ({
      id: order.id, stage: "Ultrasound", datetime: order.createdAt,
      department: "Ultrasound", staff: order.doctor?.user.name ?? "Not recorded",
      status: order.status, details: order.examType,
    })),
  ].sort((left, right) => new Date(right.datetime).getTime() - new Date(left.datetime).getTime()) : []
  const patientLab = profileData?.labOrders ?? []
  const patientInvoices = profileData?.invoices ?? []
  const patientConsultations = profileData?.consultations ?? []
  const patientAdmissions = profileData?.admissions ?? []
  const patientSurgeries = profileData?.surgeries ?? []
  const totalBilled = patientInvoices.reduce((sum, invoice) => sum + Number(invoice.grandTotal), 0)
  const invoicePayments = patientInvoices.reduce((sum, invoice) => sum + invoice.payments.reduce((paid, payment) => paid + Number(payment.amount), 0), 0)
  const advanceDeposits = (profileData?.ledgerEntries ?? []).reduce((sum, entry) => sum + Number(entry.amount), 0)
  const totalPaid = invoicePayments + advanceDeposits
  const balance = totalBilled - totalPaid
  const activeAdmission = profileData?.activeAdmission ?? null
  const eligibleAppointment = profileData?.startableAppointments.find((appointment) => appointment.status !== "COMPLETED")
  const lastVisit = patientConsultations[0]

  async function startConsultation() {
    if (!eligibleAppointment || startingConsultation) return
    setStartingConsultation(true)
    try {
      const started = await api.startConsultation(eligibleAppointment.id)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: started.id, status: started.status })
      navigate(`/dashboard/doctor/consultation/${started.id}?mr=${encodeURIComponent(patient!.mrNumber)}`)
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "Unable to start the selected appointment.")
    } finally {
      setStartingConsultation(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Patient Profile"
        action={
          <Button variant="outline" size="sm" onClick={() => {
            if (!openAuthenticatedPrintWindow(`/print/patient-summary/${patient.id}`)) {
              toast({ title: "Allow pop-ups to print", description: "Your browser blocked the patient summary print page. Allow pop-ups and try again.", variant: "error" })
            }
          }}>
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
                <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {displayPakistaniPhone(patient.phone)}</span>
                {patient.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {patient.email}</span>}
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {patient.address?.trim() && patient.address.trim().toLowerCase() !== "none" ? patient.address.trim() : "—"}</span>
                <span className="inline-flex items-center gap-1"><Droplet className="h-3.5 w-3.5" /> {formatBloodGroup(patient.bloodGroup)}</span>
              </div>
              {clinicalSummary?.allergies.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border-2 border-[var(--cp-critical)] bg-[var(--cp-critical-light)] px-2.5 py-1 text-xs font-bold text-[var(--cp-critical)]">
                    <AlertTriangle className="h-3.5 w-3.5" /> Allergies:
                  </span>
                  {clinicalSummary.allergies.map((a) => (
                    <span key={a} className="rounded-full border border-[var(--cp-critical)] px-2 py-0.5 text-xs font-semibold text-[var(--cp-critical)]">{a}</span>
                  ))}
                </div>
              ) : clinicalSummary && <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">{clinicalSummary.allergiesReviewed ? "No known allergies" : "Allergies: Not recorded"}</p>}
              <p className="mt-2 text-xs text-[var(--cp-ink-soft)]">Emergency contact: <span className="cp-tabular font-medium text-[var(--cp-ink)]">{patient.emergencyContact || "—"}</span></p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            {canBookAppointment && <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/appointments?mr=${patient.mrNumber}&name=${encodeURIComponent(patient.name)}`)}>
              <CalendarPlus className="h-4 w-4" /> Book Appointment
            </Button>}
            {currentUser?.role === "doctor" && <Button size="sm" variant="outline" disabled={!eligibleAppointment || startingConsultation} title={!eligibleAppointment ? "No active appointment today" : undefined} onClick={() => void startConsultation()}>
              <Stethoscope className="h-4 w-4" /> Start Consultation
            </Button>}
            {canAddLab && <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/lab?mr=${patient.mrNumber}`)}>
              <FlaskConical className="h-4 w-4" /> Add Lab Test
            </Button>}
            {(currentUser?.role === "doctor" || currentUser?.role === "radiologist") && <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/ultrasound?patientId=${patient.id}`)}>
              <Activity className="h-4 w-4" /> Add Ultrasound
            </Button>}
            {canCreateInvoice && <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/billing?mr=${patient.mrNumber}`)}>
              <Receipt className="h-4 w-4" /> Create Invoice
            </Button>}
            {canAdmitPatient && (activeAdmission
              ? <span className="inline-flex items-center gap-1 rounded-md border border-[var(--cp-primary)] px-3 py-2 text-xs font-semibold text-[var(--cp-primary)]">Admitted — Bed {activeAdmission.bed.bedNumber}</span>
              : <Button size="sm" variant="outline" onClick={() => setAdmitOpen(true)}>
                <BedDouble className="h-4 w-4" /> Admit Patient
              </Button>)}
          </div>
        </CardContent>
      </Card>

      <div className="print:hidden">
        <Tabs tabs={visibleTabs} active={tab} onChange={setTab} />
      </div>

      <div className="print:hidden">
        {profileError ? (
          <Card><CardContent className="flex flex-col items-start gap-3 p-5" role="alert">
            <p className="text-sm text-[var(--cp-critical)]">{profileError}</p>
            <Button size="sm" variant="outline" onClick={() => setProfileRefresh((current) => current + 1)}>Retry</Button>
          </CardContent></Card>
        ) : profileLoading || !profileData ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label={`Loading ${tab}`}>
            {[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--cp-border)]" />)}
            <div className="h-40 animate-pulse rounded-xl bg-[var(--cp-border)] sm:col-span-3" />
          </div>
        ) : profileData && (<>
        {tab === "Overview" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="sm:col-span-3"><CardContent className="p-4">
              <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-[var(--cp-ink)]">Clinical history</p>{clinicalSummaryError && <Button size="sm" variant="outline" onClick={() => setClinicalSummaryRetry((value) => value + 1)}>Retry</Button>}</div>
              {clinicalSummaryError ? <p role="alert" className="mt-2 text-sm text-[var(--cp-critical)]">{clinicalSummaryError}</p> : !clinicalSummary ? <div role="status" className="mt-2 h-12 animate-pulse rounded bg-[var(--cp-border)]" /> : <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Allergies</p><p className={clinicalSummary.allergies.length ? "font-semibold text-[var(--cp-critical)]" : ""}>{clinicalSummary.allergies.length ? clinicalSummary.allergies.join(", ") : clinicalSummary.allergiesReviewed ? "No known allergies" : "Not recorded"}</p></div>
                <div><p className="text-xs font-semibold uppercase text-[var(--cp-ink-soft)]">Chronic conditions</p><p>{clinicalSummary.chronicConditions.length ? clinicalSummary.chronicConditions.join(", ") : clinicalSummary.chronicConditionsReviewed ? "None recorded" : "Not recorded"}</p>{clinicalSummary.medicalHistory && <p className="text-xs text-[var(--cp-ink-soft)]">Medical history: {clinicalSummary.medicalHistory}</p>}</div>
              </div>}
            </CardContent></Card>
            {!isLabTechnician && <>
              <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Total Billed</p><p className="cp-tabular mt-1 text-xl font-bold text-[var(--cp-ink)]">{formatCurrency(totalBilled)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Total Paid</p><p className="cp-tabular mt-1 text-xl font-bold text-[var(--cp-success)]">{formatCurrency(totalPaid)}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Balance</p><p className={cn("cp-tabular mt-1 text-xl font-bold", balance === 0 ? "text-[var(--cp-success)]" : balance > 0 ? "text-[var(--cp-warning)]" : "text-[var(--cp-info)]")}>{formatCurrency(balance)}</p></CardContent></Card>
            </>}
            <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Last visit</p><p className="mt-1 text-sm font-semibold text-[var(--cp-ink)]">{lastVisit ? formatDate(lastVisit.appointment.appointmentDate) : "Not recorded"}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{lastVisit?.diagnosis || "No diagnosis recorded"}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-[var(--cp-ink-soft)]">Last recorded vitals</p><p className="mt-1 text-sm font-semibold text-[var(--cp-ink)]">{profileData.lastVitals ? formatDate(profileData.lastVitals.recordedAt) : "Not recorded"}</p><p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{profileData.lastVitals ? `BP ${profileData.lastVitals.systolic ?? "Not recorded"}/${profileData.lastVitals.diastolic ?? "Not recorded"} · Pulse ${profileData.lastVitals.pulse ?? "Not recorded"} · SpO₂ ${profileData.lastVitals.oxygenSaturation ?? "Not recorded"}` : "Not recorded"}</p></CardContent></Card>
            <Card className="sm:col-span-3"><CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold text-[var(--cp-ink)]">Registration details</p>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-[var(--cp-ink-soft)]">Age</dt><dd className="text-[var(--cp-ink)]">{patient.age} years</dd></div>
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
                    <button onClick={() => ev.stage === "OPD Consultation" ? navigate(`/dashboard/doctor/consultation-record/${ev.id}`) : setExpanded(expanded === ev.id ? null : ev.id)} className="flex w-full items-start justify-between gap-3 pl-2 text-left">
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
              <button key={c.id} onClick={() => navigate(`/dashboard/doctor/consultation-record/${c.id}`)} className="mb-2 block w-full rounded-lg border border-[var(--cp-border)] p-3 text-left last:mb-0 hover:bg-[var(--cp-bg)]">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[var(--cp-ink)]">{c.doctor.user.name} · Token #{c.appointment.tokenNumber} — {formatDate(c.appointment.appointmentDate)}</p>
                  <StatusBadge status={c.prescriptionStatus} />
                </div>
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Diagnosis: {c.diagnosis || "—"}</p>
              </button>
            ))}
          </CardContent></Card>
        )}

        {tab === "Prescriptions" && (
          <Card><CardContent className="p-5">
            {patientConsultations.flatMap((c) => c.prescriptions).length === 0 ? (
              <p className="text-sm text-[var(--cp-ink-soft)]">No prescriptions issued yet.</p>
            ) : patientConsultations.map((c) => c.prescriptions.length > 0 && (
              <div key={c.id} className="mb-3 rounded-lg border border-[var(--cp-border)] p-3 last:mb-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-faint)]">{formatDate(c.appointment.appointmentDate)} · {c.doctor.user.name} · <StatusBadge status={c.prescriptionStatus} /></p>
                <ul className="flex flex-col gap-1 text-sm">
                  {c.prescriptions.flatMap((prescription) => prescription.items.map((item) => <li key={item.id}>{item.medicineName} — {item.dosage ?? `${item.doseAmount ?? "—"} ${item.doseUnit ?? ""}`}, {item.frequency ?? item.frequencyCode ?? "—"}, {item.durationValue ?? item.durationDays ?? "—"} {item.durationUnit ?? "days"}</li>))}
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
                      <p className="text-sm font-semibold text-[var(--cp-ink)]">{l.test.testName}</p>
                      <p className="text-xs text-[var(--cp-ink-soft)]">{formatDate(l.orderedAt)} · Ordered by {l.doctor?.user.name ?? "Not recorded"}</p>
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
            {profileData.ultrasoundOrders.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No ultrasound records yet.</p> : (
              <ul className="flex flex-col gap-2">
                {profileData.ultrasoundOrders.map((scan) => <li key={scan.id} className="rounded-lg border border-[var(--cp-border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[var(--cp-ink)]">{scan.examType}</p><StatusBadge status={scan.status} /></div>
                  <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">{formatDateTime(scan.createdAt)} · {scan.doctor?.user.name ?? "Ordering doctor"} · {scan.priority}</p>
                  {scan.impression && <p className="mt-2 text-sm text-[var(--cp-ink)]">{scan.impression}</p>}
                </li>)}
              </ul>
            )}
          </CardContent></Card>
        )}

        {tab === "Pharmacy" && (
          <Card><CardContent className="p-5">
            {(currentUser?.role === "admin" || currentUser?.role === "pharmacist") && patientId && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--cp-bg)] p-3">
              <p className="text-sm text-[var(--cp-ink-soft)]">View this patient’s pharmacy credit balance and ledger.</p>
              <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/pharmacy/khata?patientId=${encodeURIComponent(patientId)}`)}>Open pharmacy Khata</Button>
            </div>}
            {patientInvoices.filter((invoice) => invoice.pharmacySale).length === 0
              ? <p className="text-sm text-[var(--cp-ink-soft)]">No pharmacy sales are linked to this patient.</p>
              : <ul className="flex flex-col gap-2">{patientInvoices.flatMap((invoice) => {
                const sale = invoice.pharmacySale
                return sale ? sale.items.map((item) => <li key={item.id} className="rounded-lg border border-[var(--cp-border)] p-3"><p className="text-sm font-semibold text-[var(--cp-ink)]">{item.medicine.name} · {item.quantity} dispensed</p><p className="text-xs text-[var(--cp-ink-soft)]">{formatDate(sale.createdAt)} · Invoice {invoice.invoiceNumber}</p></li>) : []
              })}</ul>}
          </CardContent></Card>
        )}

        {tab === "Billing" && (
          <Card><CardContent className="p-5">
            {patientInvoices.length === 0 && profileData.ledgerEntries.length === 0 ? <p className="text-sm text-[var(--cp-ink-soft)]">No billing or payment records for this patient yet.</p> : (
              <ul className="flex flex-col gap-2">
                {profileData.ledgerEntries.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3"><div><p className="text-sm font-semibold text-[var(--cp-ink)]">Advance deposit {formatCurrency(Number(entry.amount))}</p><p className="text-xs text-[var(--cp-ink-soft)]">{formatDate(entry.createdAt)} · {entry.paymentMethod.replace("_", " ")}</p></div><StatusBadge status="Paid" /></li>)}
                {patientInvoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-border)] p-3 cursor-pointer hover:bg-[var(--cp-bg)]" onClick={() => navigate(`/dashboard/billing/${inv.id}`)}>
                    <div>
                      <p className="cp-tabular text-sm font-semibold text-[var(--cp-ink)]">{inv.invoiceNumber ?? "Invoice"}</p>
                      <p className="text-xs text-[var(--cp-ink-soft)]">{formatDate(inv.createdAt)} · Paid {formatCurrency(inv.payments.reduce((sum, payment) => sum + Number(payment.amount), 0))} · Balance {formatCurrency(Number(inv.balanceAmount))}</p>
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
                    <p className="text-sm font-semibold text-[var(--cp-ink)]">{a.bed.bedNumber} · {a.bed.room.ward.wardName}</p>
                    <div className="flex items-center gap-2">
                      {!isLabTechnician && a.depositStatus === "PENDING" && <span className="inline-flex rounded-full bg-[var(--cp-warning-light)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-warning)]">Deposit pending</span>}
                      <StatusBadge status={a.status} />
                    </div>
                  </div>
                  <p className="text-xs text-[var(--cp-ink-soft)]">Admitted {formatDateTime(a.admissionDate)} under {a.attendingDoctor?.user.name ?? "Not recorded"} — {a.admissionType}</p>
                  <p className="text-sm text-[var(--cp-ink)]">{a.admissionReason}</p>
                  {a.dischargeDate && <p className="text-xs text-[var(--cp-ink-soft)]">Discharged {formatDateTime(a.dischargeDate)}</p>}
                  {!isLabTechnician && <div className="mt-1 flex flex-wrap gap-4 text-xs text-[var(--cp-ink-soft)]">
                    <span>Deposit: <span className="cp-tabular font-semibold text-[var(--cp-ink)]">{formatCurrency(Number(a.depositAmount))}</span></span>
                    <span>Outstanding: <span className={cn("cp-tabular font-semibold", Number(a.outstandingBalance ?? 0) === 0 ? "text-[var(--cp-success)]" : "text-[var(--cp-warning)]")}>{formatCurrency(Number(a.outstandingBalance ?? 0))}</span></span>
                  </div>}
                  {a.depositStatus === "PENDING" && canTakePayments && <Button size="sm" variant="outline" className="self-start" onClick={() => setDepositAdmission({ id: a.id, patientName: patient.name })}>Add deposit</Button>}
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
              patientSurgeries.map((record) => {
                const s = toSurgery(record)
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
        </>)}
      </div>

      <AdmitPatientModal open={admitOpen} onClose={() => setAdmitOpen(false)} prefillMR={patient.mrNumber} />
      <AddAdmissionDepositModal
        open={Boolean(depositAdmission)}
        admissionId={depositAdmission?.id ?? null}
        patientName={depositAdmission?.patientName ?? patient.name}
        onClose={() => setDepositAdmission(null)}
        onRecorded={() => setProfileRefresh((current) => current + 1)}
      />

      {/* Print-only summary */}
      <div className="hidden print:block">
        <h2 className="text-lg font-bold">Patient Summary — {patient.name}</h2>
        <p>{patient.mrNumber} · {patient.age} yrs · {patient.gender} · {formatBloodGroup(patient.bloodGroup)}</p>
        <p>Phone: {displayPakistaniPhone(patient.phone)} · Address: {patient.address?.trim() && patient.address.trim().toLowerCase() !== "none" ? patient.address.trim() : "—"}</p>
        <p>Allergies: {patient.allergies.join(", ") || "None recorded"}</p>
      </div>
    </div>
  )
}
