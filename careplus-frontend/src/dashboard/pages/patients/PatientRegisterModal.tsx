import * as React from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle } from "lucide-react"
import { Modal } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { BloodGroup, Gender, Patient } from "@/dashboard/types"
import { formatBloodGroup, formatPakistaniCNIC, formatPakistaniPhone, isValidCNIC, isValidPhone, normalizePakistaniPhone, toApiBloodGroup } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, toPatient, type ApiError } from "@/lib/api"

const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]

interface FormState {
  name: string
  age: string
  gender: Gender | ""
  phone: string
  email: string
  address: string
  cnic: string
  bloodGroup: BloodGroup
  allergies: string
  emergencyContact: string
  notes: string
}

const EMPTY: FormState = {
  name: "", age: "", gender: "", phone: "", email: "", address: "",
  cnic: "", bloodGroup: "O+", allergies: "", emergencyContact: "", notes: "",
}

export function PatientRegisterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patients, dispatch } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({})
  const [touched, setTouched] = React.useState<Partial<Record<"phone" | "emergencyContact" | "cnic", boolean>>>({})
  const [duplicate, setDuplicate] = React.useState<Patient | null>(null)
  const [duplicateCnic, setDuplicateCnic] = React.useState<Patient | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) { setForm(EMPTY); setErrors({}); setTouched({}); setDuplicate(null) }
  }, [open])

  function phoneFieldError(key: "phone" | "emergencyContact", value: string) {
    if (key === "emergencyContact" && !value.trim()) return undefined
    return isValidPhone(value) ? undefined : "Enter a valid Pakistani phone, e.g. 0301-2345678"
  }

  function updatePhoneError(key: "phone" | "emergencyContact", value: string) {
    setErrors((current) => {
      const next = { ...current }
      const error = phoneFieldError(key, value)
      if (error) next[key] = error
      else delete next[key]
      return next
    })
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === "phone") {
      const existing = patients.find((p) => normalizePakistaniPhone(p.phone) === normalizePakistaniPhone(String(value)))
      setDuplicate(existing ?? null)
      if (touched.phone) updatePhoneError("phone", String(value))
    }
    if (key === "cnic") {
      const cnic = String(value)
      setDuplicateCnic(cnic ? patients.find((p) => p.cnic?.replace(/\D/g, "") === cnic.replace(/\D/g, "")) ?? null : null)
      if (touched.cnic) {
        setErrors((current) => {
          const next = { ...current }
          if (isValidCNIC(cnic)) delete next.cnic
          else next.cnic = "Enter a valid 13-digit CNIC"
          return next
        })
      }
    }
    if (key === "emergencyContact" && touched.emergencyContact) updatePhoneError("emergencyContact", String(value))
  }

  function validate(): boolean {
    setTouched((current) => ({ ...current, phone: true, emergencyContact: true, cnic: true }))
    const next: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) next.name = "Full name is required"
    const ageValue = Number(form.age)
    if (!form.age || Number.isNaN(ageValue) || !Number.isInteger(ageValue) || ageValue < 0 || ageValue > 120) next.age = "Age must be a whole number between 0 and 120"
    if (!form.gender) next.gender = "Select a gender"
    const phoneError = phoneFieldError("phone", form.phone)
    if (phoneError) next.phone = phoneError
    if (!isValidCNIC(form.cnic)) next.cnic = "Enter a valid 13-digit CNIC"
    const emergencyContactError = phoneFieldError("emergencyContact", form.emergencyContact)
    if (emergencyContactError) next.emergencyContact = emergencyContactError
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handlePhoneBlur(key: "phone" | "emergencyContact", value: string) {
    setTouched((current) => ({ ...current, [key]: true }))
    updatePhoneError(key, value)
  }

  function handleCnicBlur(value: string) {
    setTouched((current) => ({ ...current, cnic: true }))
    setErrors((current) => {
      const next = { ...current }
      if (isValidCNIC(value)) delete next.cnic
      else next.cnic = "Enter a valid 13-digit CNIC"
      return next
    })
  }

  async function handleSave(bookAppointment: boolean) {
    if (!validate()) return
    setSaving(true)
    try {
      const [firstName, ...lastParts] = form.name.trim().split(/\s+/)
      const patient = await api.createPatient({
        firstName,
        lastName: lastParts.join(" ") || firstName,
        age: Number(form.age),
        gender: form.gender.toUpperCase(),
        phone: normalizePakistaniPhone(form.phone),
        email: form.email.trim() || undefined,
        address: form.address.trim() && form.address.trim().toLowerCase() !== "none" ? form.address.trim() : undefined,
        cnic: form.cnic.trim() ? formatPakistaniCNIC(form.cnic) : undefined,
        bloodGroup: toApiBloodGroup(form.bloodGroup),
        allergies: form.allergies.split(",").map((a) => a.trim()).filter(Boolean),
        emergencyContactPhone: form.emergencyContact.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
      const mapped = toPatient(patient)
      dispatch({ type: "ADD_PATIENT", patient: mapped })
      toast({ title: "Patient registered", description: `${mapped.name} was assigned ${mapped.mrNumber}.`, variant: "success" })
      onClose()
      if (bookAppointment) navigate(`/dashboard/appointments?mr=${mapped.mrNumber}&name=${encodeURIComponent(mapped.name)}`)
      else navigate(`/dashboard/patients/${mapped.mrNumber}`)
    } catch (error) {
      toast({ title: "Unable to register patient", description: (error as ApiError).message, variant: "error" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Register New Patient" description="MR number is generated automatically on save." size="lg">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="patient_full_name">Full Name</Label>
          <Input id="patient_full_name" name="patient_full_name" autoComplete="off" value={form.name} onChange={(e) => set("name", e.target.value)} error={!!errors.name} placeholder="e.g. Fatima Zahra" />
          {errors.name && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.name}</p>}
        </div>

        <div>
          <Label htmlFor="reg-age">Age</Label>
          <Input id="reg-age" type="number" min={0} max={120} step={1} value={form.age} onChange={(e) => set("age", e.target.value)} error={!!errors.age} placeholder="e.g. 32" />
          {errors.age && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.age}</p>}
        </div>

        <div>
          <Label htmlFor="reg-gender">Gender</Label>
          <Select id="reg-gender" value={form.gender} onChange={(e) => set("gender", e.target.value as Gender)}>
            <option value="">Select gender</option><option>Male</option><option>Female</option><option>Other</option>
          </Select>
          {errors.gender && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.gender}</p>}
        </div>

        <div>
          <Label htmlFor="patient_phone">Phone</Label>
          <Input id="patient_phone" name="patient_phone" type="tel" inputMode="numeric" autoComplete="off" value={form.phone} onChange={(e) => set("phone", formatPakistaniPhone(e.target.value))} onBlur={(e) => handlePhoneBlur("phone", e.target.value)} error={!!errors.phone} placeholder="0301-2345678" />
          {errors.phone && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.phone}</p>}
        </div>

        <div>
          <Label htmlFor="patient_email">Email (optional)</Label>
          <Input id="patient_email" name="patient_email" type="email" autoComplete="off" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" />
        </div>

        {duplicate && (
          <div className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-[var(--cp-warning)] bg-[var(--cp-warning-light)] p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cp-warning)]" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-[var(--cp-ink)]">A patient with this phone number already exists</p>
              <p className="text-[var(--cp-ink-soft)]">{duplicate.name} · {duplicate.mrNumber} · {duplicate.age} yrs, {duplicate.gender}</p>
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/dashboard/patients/${duplicate.mrNumber}`) }}
                className="mt-1 text-xs font-semibold text-[var(--cp-primary)] underline underline-offset-2"
              >
                View existing patient
              </button>
            </div>
          </div>
        )}

        {duplicateCnic && (
          <div className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-[var(--cp-warning)] bg-[var(--cp-warning-light)] p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cp-warning)]" />
            <div className="flex-1 text-sm">
              <p className="font-semibold text-[var(--cp-ink)]">A patient with this CNIC already exists</p>
              <p className="text-[var(--cp-ink-soft)]">{duplicateCnic.name} · {duplicateCnic.mrNumber}</p>
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/dashboard/patients/${duplicateCnic.mrNumber}`) }}
                className="mt-1 text-xs font-semibold text-[var(--cp-primary)] underline underline-offset-2"
              >
                View existing patient
              </button>
            </div>
          </div>
        )}

        <div className="sm:col-span-2">
          <Label htmlFor="patient_address">Address</Label>
          <Input id="patient_address" name="patient_address" autoComplete="off" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="House, Street, Area, City" />
        </div>

        <div>
          <Label htmlFor="patient_cnic">CNIC (optional)</Label>
          <Input id="patient_cnic" name="patient_cnic" type="tel" inputMode="numeric" autoComplete="off" value={form.cnic} onChange={(e) => set("cnic", formatPakistaniCNIC(e.target.value))} onBlur={(e) => handleCnicBlur(e.target.value)} error={!!errors.cnic} placeholder="13-digit CNIC" />
          {errors.cnic && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.cnic}</p>}
        </div>

        <div>
          <Label htmlFor="reg-bg">Blood Group</Label>
          <Select id="reg-bg" value={form.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value as BloodGroup)}>
            {BLOOD_GROUPS.map((bg) => <option key={bg} value={bg}>{formatBloodGroup(bg)}</option>)}
          </Select>
        </div>

        <div>
          <Label htmlFor="allergies">Allergies (comma separated)</Label>
          <Input id="allergies" name="allergies" autoComplete="off" value={form.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="Penicillin, Latex" />
        </div>

        <div>
          <Label htmlFor="emergency_contact_phone">Emergency Contact</Label>
          <Input id="emergency_contact_phone" name="emergency_contact_phone" type="tel" inputMode="numeric" autoComplete="off" value={form.emergencyContact} onChange={(e) => set("emergencyContact", formatPakistaniPhone(e.target.value))} onBlur={(e) => handlePhoneBlur("emergencyContact", e.target.value)} error={!!errors.emergencyContact} placeholder="0301-9998887" />
          {errors.emergencyContact && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.emergencyContact}</p>}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" autoComplete="off" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any additional information…" />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="outline" size="sm" onClick={() => handleSave(false)} disabled={saving}>Save Patient</Button>
        <Button size="sm" onClick={() => handleSave(true)} disabled={saving}>Save &amp; Book Appointment</Button>
      </div>
    </Modal>
  )
}
