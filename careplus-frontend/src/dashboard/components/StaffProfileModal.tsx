import * as React from "react"
import { FileImage, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/dashboard/components/Primitives"
import { api, apiAssetUrl, type ApiError, type ApiStaffProfile, type ApiUser } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

type ProfileUser = Pick<ApiUser, "id" | "name" | "role" | "profilePictureUrl">
type ProfileForm = { fullName: string; qualification: string; specialization: string; registrationNumber: string; pmdcRegistrationNo: string; phcRegistrationNo: string; consultationFee: string }

const ROLE_LABELS: Record<string, string> = {
  DOCTOR: "Doctor",
  PHARMACIST: "Pharmacist",
  LAB_TECHNICIAN: "Lab technician",
  PATHOLOGIST: "Pathologist",
  NURSE: "Nurse",
  RECEPTIONIST: "Receptionist",
  BILLING_MANAGER: "Billing Manager",
  ADMIN: "Administrator",
}

function registrationLabel(role: string) {
  if (role === "DOCTOR") return "PM&DC Registration Number"
  if (role === "PHARMACIST") return "License/Registration Number"
  if (role === "LAB_TECHNICIAN") return "Certification/License Number"
  if (role === "PATHOLOGIST") return "Pathologist Registration/License Number"
  return "License Number"
}

function profileForm(user: ProfileUser, profile?: ApiStaffProfile | null): ProfileForm {
  return {
    fullName: user.name,
    qualification: profile?.qualification ?? "",
    specialization: profile?.specialization ?? "",
    registrationNumber: profile?.registrationNumber ?? "",
    pmdcRegistrationNo: profile?.pmdcRegistrationNo ?? profile?.registrationNumber ?? "",
    phcRegistrationNo: profile?.phcRegistrationNo ?? "",
    consultationFee: profile?.consultationFee == null ? "" : String(profile.consultationFee),
  }
}

export function StaffProfileModal({ user, open, onClose, onSaved, self = false }: { user: ProfileUser | null; open: boolean; onClose: () => void; onSaved?: (result: { user: ApiUser; profile: ApiStaffProfile }) => void; self?: boolean }) {
  const { toast } = useToast()
  const [form, setForm] = React.useState<ProfileForm>({ fullName: "", qualification: "", specialization: "", registrationNumber: "", pmdcRegistrationNo: "", phcRegistrationNo: "", consultationFee: "" })
  const [profile, setProfile] = React.useState<ApiStaffProfile | null>(null)
  const [profilePicture, setProfilePicture] = React.useState<File | null>(null)
  const [signature, setSignature] = React.useState<File | null>(null)
  const [stamp, setStamp] = React.useState<File | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!open || !user) return
    setLoading(true)
    setProfilePicture(null)
    setSignature(null)
    setStamp(null)
    setErrors({})
    const request = self ? api.getMyStaffProfile() : api.getStaffProfile(user.id)
    request.then((result) => { setProfile(result.profile); setForm(profileForm(user, result.profile)) }).catch((error) => toast({ title: "Unable to load profile", description: (error as ApiError).message, variant: "error" })).finally(() => setLoading(false))
  }, [open, user, self, toast])

  if (!user) return null
  const isDoctor = user.role === "DOCTOR"
  const hasRegistration = ["DOCTOR", "PHARMACIST", "LAB_TECHNICIAN", "PATHOLOGIST", "NURSE"].includes(user.role)

  function update(key: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [key]: value, ...(key === "pmdcRegistrationNo" ? { registrationNumber: value } : {}) }))
    setErrors((current) => { const next = { ...current }; delete next[key]; return next })
  }

  async function save() {
    const nextErrors: Record<string, string> = {}
    if (form.fullName.trim().length < 2) nextErrors.fullName = "Full name is required"
    if (isDoctor && !form.qualification.trim()) nextErrors.qualification = "Qualification is required for doctors"
    if (isDoctor && !form.specialization.trim()) nextErrors.specialization = "Specialization is required for doctors"
    if (hasRegistration && !(isDoctor ? form.pmdcRegistrationNo : form.registrationNumber).trim()) {
      const field = isDoctor ? "pmdcRegistrationNo" : "registrationNumber"
      nextErrors[field] = "This field is required for this role"
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSaving(true)
    try {
      const body = new FormData()
      Object.entries(form).forEach(([key, value]) => body.append(key, value))
      if (profilePicture) body.append("profilePicture", profilePicture)
      if (signature) body.append("signature", signature)
      if (stamp) body.append("stamp", stamp)
      const result = self ? await api.updateMyStaffProfile(body) : await api.updateStaffProfile(user!.id, body)
      setProfile(result.profile)
      onSaved?.(result)
      toast({ title: "Staff profile saved", variant: "success" })
      onClose()
    } catch (error) {
      const details = (error as ApiError).details
      const fieldErrors = details && typeof details === "object" ? Object.fromEntries(Object.entries(details as Record<string, unknown>).map(([key, value]) => [key, Array.isArray(value) ? String(value[0]) : String(value)])) : {}
      setErrors(fieldErrors)
      toast({ title: "Profile save failed", description: (error as ApiError).message, variant: "error" })
    } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title={`${ROLE_LABELS[user.role] ?? user.role} Staff Profile`}>
    {loading ? <p className="py-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading profile...</p> : <>
      <div className="mb-4 rounded-lg bg-[var(--cp-bg)] px-3 py-2 text-xs text-[var(--cp-ink-soft)]">Profile details are used on clinical and operational documents.</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="staff-full-name">Full Name</Label><Input id="staff-full-name" value={form.fullName} error={!!errors.fullName} onChange={(event) => update("fullName", event.target.value)} />{errors.fullName && <p className="mt-1 text-xs text-[var(--cp-critical)]">{errors.fullName}</p>}</div>
        {isDoctor && <>
          <div><Label htmlFor="staff-qualification">Qualification</Label><Input id="staff-qualification" placeholder="e.g., MBBS, FCPS" value={form.qualification} error={!!errors.qualification} onChange={(event) => update("qualification", event.target.value)} />{errors.qualification && <p className="mt-1 text-xs text-[var(--cp-critical)]">{errors.qualification}</p>}</div>
          <div><Label htmlFor="staff-specialization">Specialization</Label><Input id="staff-specialization" placeholder="e.g., Cardiologist" value={form.specialization} error={!!errors.specialization} onChange={(event) => update("specialization", event.target.value)} />{errors.specialization && <p className="mt-1 text-xs text-[var(--cp-critical)]">{errors.specialization}</p>}</div>
        </>}
        {isDoctor ? <>
          <div><Label htmlFor="staff-pmdc">PM&amp;DC Registration Number</Label><Input id="staff-pmdc" autoComplete="off" value={form.pmdcRegistrationNo} error={!!errors.pmdcRegistrationNo} onChange={(event) => update("pmdcRegistrationNo", event.target.value)} />{errors.pmdcRegistrationNo && <p className="mt-1 text-xs text-[var(--cp-critical)]">{errors.pmdcRegistrationNo}</p>}</div>
          <div><Label htmlFor="staff-phc">PHC Registration Number (optional)</Label><Input id="staff-phc" autoComplete="off" value={form.phcRegistrationNo} onChange={(event) => update("phcRegistrationNo", event.target.value)} /></div>
        </> : hasRegistration && <div><Label htmlFor="staff-registration">{registrationLabel(user.role)}</Label><Input id="staff-registration" value={form.registrationNumber} error={!!errors.registrationNumber} onChange={(event) => update("registrationNumber", event.target.value)} />{errors.registrationNumber && <p className="mt-1 text-xs text-[var(--cp-critical)]">{errors.registrationNumber}</p>}</div>}
        {isDoctor && <div><Label htmlFor="staff-fee">Consultation Fee (optional)</Label><Input id="staff-fee" type="number" min="0" step="0.01" value={form.consultationFee} onChange={(event) => update("consultationFee", event.target.value)} /></div>}
        <ImageField label="Profile picture" currentUrl={user.profilePictureUrl} file={profilePicture} onChange={setProfilePicture} />
        <ImageField label="Signature image" currentUrl={profile?.signatureUrl} file={signature} onChange={setSignature} />
        {(isDoctor || user.role === "PHARMACIST" || user.role === "LAB_TECHNICIAN") && <ImageField label="Stamp image" currentUrl={profile?.stampUrl} file={stamp} onChange={setStamp} />}
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save Profile"}</Button></div>
    </>}
  </Modal>
}

function ImageField({ label, currentUrl, file, onChange }: { label: string; currentUrl?: string | null; file: File | null; onChange: (file: File | null) => void }) {
  const inputId = `staff-${label.replace(/\W/g, "-").toLowerCase()}`
  return <div><Label htmlFor={inputId}>{label}</Label><label htmlFor={inputId} className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--cp-border)] px-3 py-2 text-sm text-[var(--cp-ink-soft)] hover:border-[var(--cp-primary)]"><Upload className="h-4 w-4" />{file?.name ?? (currentUrl ? "Replace image" : "Choose PNG or JPG")}</label><input id={inputId} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />{currentUrl && !file && <img src={apiAssetUrl(currentUrl)} alt="" className="mt-2 h-12 max-w-32 rounded border border-[var(--cp-border)] object-contain" />}<FileImage className="mt-1 h-3.5 w-3.5 text-[var(--cp-ink-faint)]" /></div>
}