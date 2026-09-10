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
import { calcAge, isValidCNIC, isValidPhone } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, toPatient, type ApiError } from "@/lib/api"

const BLOOD_GROUPS: BloodGroup[] = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]

interface FormState {
  name: string
  dob: string
  gender: Gender
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
  name: "", dob: "", gender: "Male", phone: "", email: "", address: "",
  cnic: "", bloodGroup: "O+", allergies: "", emergencyContact: "", notes: "",
}

export function PatientRegisterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { patients, dispatch } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({})
  const [duplicate, setDuplicate] = React.useState<Patient | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) { setForm(EMPTY); setErrors({}); setDuplicate(null) }
  }, [open])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === "phone") {
      const existing = patients.find((p) => p.phone === value)
      setDuplicate(existing ?? null)
    }
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) next.name = "Full name is required"
    if (!form.dob) next.dob = "Date of birth is required"
    if (!isValidPhone(form.phone)) next.phone = "Enter a valid phone, e.g. 0301-2345678"
    if (!isValidCNIC(form.cnic)) next.cnic = "Format: 34101-1234567-1"
    if (!form.emergencyContact.trim()) next.emergencyContact = "Emergency contact is required"
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave(bookAppointment: boolean) {
    if (!validate()) return
    setSaving(true)
    try {
      const [firstName, ...lastParts] = form.name.trim().split(/\s+/)
      const patient = await api.createPatient({
        firstName,
        lastName: lastParts.join(" ") || firstName,
        dateOfBirth: form.dob,
        gender: form.gender.toUpperCase(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        cnic: form.cnic.trim() || undefined,
        bloodGroup: form.bloodGroup.replace("+", "_POS").replace("-", "_NEG"),
        allergies: form.allergies.split(",").map((a) => a.trim()).filter(Boolean),
        emergencyContactPhone: form.emergencyContact.trim(),
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
          <Label htmlFor="reg-name">Full Name</Label>
          <Input id="reg-name" value={form.name} onChange={(e) => set("name", e.target.value)} error={!!errors.name} placeholder="e.g. Fatima Zahra" />
          {errors.name && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.name}</p>}
        </div>

        <div>
          <Label htmlFor="reg-dob">Date of Birth</Label>
          <Input id="reg-dob" type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} error={!!errors.dob} />
          {errors.dob && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.dob}</p>}
          {form.dob && <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Age: {calcAge(form.dob)} years</p>}
        </div>

        <div>
          <Label htmlFor="reg-gender">Gender</Label>
          <Select id="reg-gender" value={form.gender} onChange={(e) => set("gender", e.target.value as Gender)}>
            <option>Male</option><option>Female</option><option>Other</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="reg-phone">Phone</Label>
          <Input id="reg-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} error={!!errors.phone} placeholder="0301-2345678" />
          {errors.phone && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.phone}</p>}
        </div>

        <div>
          <Label htmlFor="reg-email">Email (optional)</Label>
          <Input id="reg-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@example.com" />
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

        <div className="sm:col-span-2">
          <Label htmlFor="reg-address">Address</Label>
          <Input id="reg-address" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="House, Street, Area, City" />
        </div>

        <div>
          <Label htmlFor="reg-cnic">CNIC (optional)</Label>
          <Input id="reg-cnic" value={form.cnic} onChange={(e) => set("cnic", e.target.value)} error={!!errors.cnic} placeholder="34101-1234567-1" />
          {errors.cnic && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.cnic}</p>}
        </div>

        <div>
          <Label htmlFor="reg-bg">Blood Group</Label>
          <Select id="reg-bg" value={form.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value as BloodGroup)}>
            {BLOOD_GROUPS.map((bg) => <option key={bg}>{bg}</option>)}
          </Select>
        </div>

        <div>
          <Label htmlFor="reg-allergies">Allergies (comma separated)</Label>
          <Input id="reg-allergies" value={form.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="Penicillin, Latex" />
        </div>

        <div>
          <Label htmlFor="reg-emergency">Emergency Contact</Label>
          <Input id="reg-emergency" value={form.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} error={!!errors.emergencyContact} placeholder="0301-9998887" />
          {errors.emergencyContact && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.emergencyContact}</p>}
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="reg-notes">Notes</Label>
          <Textarea id="reg-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any additional information…" />
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
