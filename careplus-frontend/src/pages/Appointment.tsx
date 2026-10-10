import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { AnimatePresence, motion } from "framer-motion"
import { CalendarCheck, ChevronLeft, ChevronRight, CheckCircle2, HeartPulse, Printer, User, Stethoscope, FileText } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { departments } from "@/data/departments"
import { services } from "@/data/services"
import { api, apiAssetUrl, type ApiError } from "@/lib/api"
import { useHospitalProfile } from "@/lib/hospitalProfile"

interface FormState {
  departmentId: string
  doctorId: string
  serviceId: string
  date: string
  time: string
  fullName: string
  phone: string
  email: string
  age: string
  reason: string
}

const STEPS = [
  { id: 1, label: "Specialist & Visit" },
  { id: 2, label: "Schedule" },
  { id: 3, label: "Your Details" },
]

function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

export default function Appointment() {
  const [params] = useSearchParams()
  const { toast } = useToast()
  const hospitalProfile = useHospitalProfile()

  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [shakeKey, setShakeKey] = useState(0)
  const [confirmed, setConfirmed] = useState<{ form: FormState; appointmentId: string; tokenNumber: number } | null>(null)
  const [publicDoctors, setPublicDoctors] = useState<Awaited<ReturnType<typeof api.listPublicDoctors>>>([])
  const [publicDepartments, setPublicDepartments] = useState<Awaited<ReturnType<typeof api.listPublicDepartments>>>([])
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitInFlight = useRef(false)

  const [form, setForm] = useState<FormState>({
    departmentId: params.get("department") ?? "",
    doctorId: params.get("doctor") ?? "",
    serviceId: params.get("service") ?? "",
    date: "",
    time: "",
    fullName: "",
    phone: "",
    email: "",
    age: "",
    reason: "",
  })

  useEffect(() => {
    Promise.all([api.listPublicDoctors(), api.listPublicDepartments()]).then(([nextDoctors, nextDepartments]) => { setPublicDoctors(nextDoctors); setPublicDepartments(nextDepartments) }).catch(() => {
      toast({ title: "Unable to load specialists", description: "Please try again in a moment.", variant: "error" })
    })
  }, [toast])

  useEffect(() => {
    if (!form.doctorId || !form.date) {
      setAvailableSlots([])
      return
    }
    setSlotsLoading(true)
    api.getPublicAvailableSlots(form.doctorId, form.date)
      .then((result: { availableSlots: string[] }) => setAvailableSlots(result.availableSlots))
      .catch(() => setAvailableSlots([]))
      .finally(() => setSlotsLoading(false))
  }, [form.doctorId, form.date])

  const availableDoctors = useMemo(
    () => (form.departmentId ? publicDoctors.filter((d) => d.department?.id === form.departmentId) : publicDoctors),
    [form.departmentId, publicDoctors]
  )

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: "" }))
  }

  function validateStep(current: number): boolean {
    const newErrors: Record<string, string> = {}
    if (current === 1) {
      if (!form.departmentId) newErrors.departmentId = "Choose a department"
      if (!form.doctorId) newErrors.doctorId = "Choose a doctor"
    }
    if (current === 2) {
      if (!form.date) newErrors.date = "Choose a preferred date"
      if (form.date && form.date < todayISO()) newErrors.date = "Choose today or a future date"
      if (!form.time) newErrors.time = "Choose an available time"
    }
    if (current === 3) {
      if (!form.fullName.trim()) newErrors.fullName = "Enter your full name"
      if (!/^\+?[0-9][0-9\s-]{6,18}$/.test(form.phone.trim())) newErrors.phone = "Enter a valid phone number"
      const ageValue = Number(form.age)
      if (!form.age || Number.isNaN(ageValue) || !Number.isInteger(ageValue) || ageValue < 0 || ageValue > 120) newErrors.age = "Enter a valid age between 0 and 120"
    }
    setErrors(newErrors)
    if (Object.values(newErrors).some(Boolean)) {
      setShakeKey((k) => k + 1)
      return false
    }
    return true
  }

  async function goNext() {
    if (!validateStep(step)) return
    if (step < 3) {
      setStep((s) => s + 1)
    } else if (!submitInFlight.current) {
      submitInFlight.current = true
      setIsSubmitting(true)
      try {
        const appointment = await api.createPublicAppointment({
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          age: Number(form.age),
          doctorId: form.doctorId,
          departmentId: form.departmentId,
          appointmentDate: form.date,
          timeSlot: toApiTime(form.time),
          ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
        })
        setConfirmed({ form, appointmentId: appointment.id, tokenNumber: appointment.tokenNumber })
        toast({ title: "Appointment request received", description: `Reference ${appointment.id.slice(0, 8).toUpperCase()} — staff will contact you to confirm.`, variant: "success" })
      } catch (error) {
        const requestError = error as ApiError
        const details = requestError.details as Record<string, string[] | string> | null
        const fieldErrors = details && typeof details === "object"
          ? Object.fromEntries(Object.entries(details).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]))
          : {}
        if (Object.keys(fieldErrors).length) setErrors((current) => ({ ...current, ...fieldErrors }))
        toast({ title: "Appointment request could not be submitted", description: requestError.message || "Please review the highlighted fields and try again.", variant: "error" })
      } finally {
        submitInFlight.current = false
        setIsSubmitting(false)
      }
    }
  }

  function goBack() {
    setStep((s) => Math.max(1, s - 1))
  }

  const selectedDoctor = publicDoctors.find((d) => d.id === form.doctorId)
  const selectedDept = selectedDoctor?.department
  const selectedService = services.find((s) => s.id === form.serviceId)

  if (confirmed) {
    const dept = publicDepartments.find((d) => d.id === confirmed.form.departmentId) ?? departments.find((d) => d.id === confirmed.form.departmentId)
    const doc = publicDoctors.find((d) => d.id === confirmed.form.doctorId)
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="overflow-hidden" id="confirmation-print">
            <div className="confirmation-print-header">
              <div className="confirmation-print-logo">
                {hospitalProfile.logoUrl ? <img src={apiAssetUrl(hospitalProfile.logoUrl)} alt="" /> : <HeartPulse />}
              </div>
              <div>
                <strong>{hospitalProfile.name}</strong>
                <span>Appointment Confirmation</span>
              </div>
            </div>
            <div className="bg-[var(--color-accent)] px-8 py-8 text-center text-white">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10" />
              <h1 className="font-[var(--font-display)] text-2xl font-bold">Appointment Requested</h1>
              <p className="mt-1 text-sm text-white/85">Your request is pending staff confirmation.</p>
            </div>
            <div className="space-y-4 p-8 print:p-0">
              <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] pb-4">
                <span className="text-sm text-[var(--color-ink-soft)]">Reference Number</span>
                <span className="font-[var(--font-data)] font-bold text-[var(--color-primary)]">{confirmed.appointmentId.slice(0, 8).toUpperCase()}</span>
              </div>
              <Row label="Token" value={`#${confirmed.tokenNumber}`} />
              <Row label="Patient" value={confirmed.form.fullName} />
              <Row label="Department" value={doc?.department?.name ?? dept?.name ?? "—"} />
              <Row label="Doctor" value={doc?.user.name ?? "Any available specialist"} />
              <Row label="Date" value={confirmed.form.date} />
              <Row label="Time" value={confirmed.form.time} />
              <Row label="Phone" value={confirmed.form.phone} />
              {confirmed.form.reason && <Row label="Reason for visit" value={confirmed.form.reason} />}
            </div>
            <div className="no-print flex gap-3 border-t border-[var(--color-border-soft)] p-6">
              <Button variant="outline" className="flex-1" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print Confirmation
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  setConfirmed(null)
                  setStep(1)
                  setForm({ departmentId: "", doctorId: "", serviceId: "", date: "", time: "", fullName: "", phone: "", email: "", age: "", reason: "" })
                }}
              >
                Book Another
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Book an Appointment"
        title="Let's find you a time that works."
        description="Three quick steps — no account needed. Staff will contact you to confirm your request."
      />

      <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
        {/* Stepper */}
        <div className="mb-10 flex items-center justify-between">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors duration-300 ${
                    step === s.id
                      ? "bg-[var(--color-primary)] text-white"
                      : step > s.id
                      ? "bg-[var(--color-accent)] text-white"
                      : "bg-[var(--color-primary-light)] text-[var(--color-ink-faint)]"
                  }`}
                >
                  {step > s.id ? <CheckCircle2 className="h-5 w-5" /> : s.id}
                </div>
                <span className="hidden text-xs font-medium text-[var(--color-ink-soft)] sm:block">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 rounded-full transition-colors duration-300 ${step > s.id ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-soft)]"}`} />
              )}
            </div>
          ))}
        </div>

        <motion.div key={shakeKey} animate={Object.keys(errors).length ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
          <Card className="p-6 sm:p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                {step === 1 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2 text-[var(--color-primary)]">
                      <Stethoscope className="h-5 w-5" />
                      <h2 className="font-[var(--font-display)] text-lg font-bold text-[var(--color-ink)]">Choose specialist & visit type</h2>
                    </div>
                    <div>
                      <Label htmlFor="department">Department {errors.departmentId && <span className="text-[var(--color-emergency)]">— {errors.departmentId}</span>}</Label>
                      <Select id="department" value={form.departmentId} onChange={(e) => update("departmentId", e.target.value)} error={Boolean(errors.departmentId)}>
                        <option value="">Select a department</option>
                        {publicDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="doctor">Doctor {errors.doctorId && <span className="text-[var(--color-emergency)]">— {errors.doctorId}</span>}</Label>
                      <Select id="doctor" value={form.doctorId} onChange={(e) => update("doctorId", e.target.value)} error={Boolean(errors.doctorId)}>
                        <option value="">Any available specialist</option>
                        {availableDoctors.map((d) => <option key={d.id} value={d.id}>{d.user.name} — {d.specialization}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="service">Service (optional)</Label>
                      <Select id="service" value={form.serviceId} onChange={(e) => update("serviceId", e.target.value)}>
                        <option value="">General consultation</option>
                        {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.priceFrom}</option>)}
                      </Select>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2 text-[var(--color-primary)]">
                      <CalendarCheck className="h-5 w-5" />
                      <h2 className="font-[var(--font-display)] text-lg font-bold text-[var(--color-ink)]">Pick a date & time</h2>
                    </div>
                    <div>
                      <Label htmlFor="date">Preferred date {errors.date && <span className="text-[var(--color-emergency)]">— {errors.date}</span>}</Label>
                      <Input id="date" type="date" min={todayISO()} value={form.date} onChange={(e) => { update("date", e.target.value); update("time", "") }} error={Boolean(errors.date)} />
                    </div>
                    <div>
                      <Label>Preferred time {errors.time && <span className="text-[var(--color-emergency)]">— {errors.time}</span>}</Label>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {slotsLoading && <p className="col-span-full text-sm text-[var(--color-ink-soft)]">Loading available times…</p>}
                        {!slotsLoading && form.date && availableSlots.length === 0 && <p className="col-span-full text-sm text-[var(--color-ink-soft)]">No slots available</p>}
                        {availableSlots.map((slot) => (
                          <button
                            type="button"
                            key={slot}
                            onClick={() => update("time", formatTimeSlot(slot))}
                            className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                              form.time === slot
                                ? "border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "border-[var(--color-border-soft)] text-[var(--color-ink-soft)] hover:border-[var(--color-accent)]"
                            }`}
                          >
                            {formatTimeSlot(slot)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-5">
                    <div className="flex items-center gap-2 text-[var(--color-primary)]">
                      <User className="h-5 w-5" />
                      <h2 className="font-[var(--font-display)] text-lg font-bold text-[var(--color-ink)]">Your details</h2>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label htmlFor="fullName">Full name {errors.fullName && <span className="text-[var(--color-emergency)]">— {errors.fullName}</span>}</Label>
                        <Input id="fullName" placeholder="e.g. Ali Hassan" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} error={Boolean(errors.fullName)} />
                      </div>
                      <div>
                        <Label htmlFor="phone">Phone number {errors.phone && <span className="text-[var(--color-emergency)]">— {errors.phone}</span>}</Label>
                        <Input id="phone" placeholder="0300 1234567" value={form.phone} onChange={(e) => update("phone", e.target.value)} error={Boolean(errors.phone)} />
                      </div>
                      <div>
                        <Label htmlFor="age">Age {errors.age && <span className="text-[var(--color-emergency)]">— {errors.age}</span>}</Label>
                        <Input id="age" type="number" min={0} max={120} step={1} placeholder="e.g. 32" value={form.age} onChange={(e) => update("age", e.target.value)} error={Boolean(errors.age)} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="email">Email (optional)</Label>
                        <Input id="email" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => update("email", e.target.value)} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="reason">Reason for visit (optional)</Label>
                        <Textarea id="reason" placeholder="Briefly describe your symptoms or reason for the visit" value={form.reason} onChange={(e) => update("reason", e.target.value)} />
                      </div>
                    </div>

                    <div className="rounded-xl bg-[var(--color-primary-light)] p-4 text-sm text-[var(--color-primary)]">
                      <div className="mb-1 flex items-center gap-1.5 font-semibold"><FileText className="h-4 w-4" /> Summary</div>
                      <p className="text-[var(--color-ink-soft)]">
                        {selectedDept?.name ?? "Any department"} · {selectedDoctor?.user.name ?? "Any specialist"} · {form.date || "—"} at {form.time || "—"}
                        {selectedService ? ` · ${selectedService.name}` : ""}
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={goBack} disabled={step === 1}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button variant="primary" onClick={goNext} disabled={isSubmitting}>
                {isSubmitting ? "Booking..." : step === 3 ? "Confirm Appointment" : "Continue"} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </motion.div>
      </section>
    </div>
  )
}

function toApiTime(time: string) {
  const [value, meridiem] = time.split(" ")
  let [hours, minutes] = value.split(":").map(Number)
  if (meridiem === "PM" && hours !== 12) hours += 12
  if (meridiem === "AM" && hours === 12) hours = 0
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function formatTimeSlot(time: string) {
  const [hours, minutes] = time.split(":").map(Number)
  const meridiem = hours >= 12 ? "PM" : "AM"
  const displayHours = hours % 12 || 12
  return `${String(displayHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${meridiem}`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      <span className="font-medium text-[var(--color-ink)]">{value}</span>
    </div>
  )
}
