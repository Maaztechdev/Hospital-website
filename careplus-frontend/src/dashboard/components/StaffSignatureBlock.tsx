import * as React from "react"
import { api, loadAuthenticatedImage, type ApiStaffProfile } from "@/lib/api"

export function StaffSignatureBlock({ userId, title = "Issued by", showStamp = false, className = "" }: { userId?: string | null; title?: string; showStamp?: boolean; className?: string }) {
  const [staff, setStaff] = React.useState<{ name: string; role: string; profile: ApiStaffProfile | null } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [images, setImages] = React.useState<{ signature: string | null; stamp: string | null } | null>(null)

  React.useEffect(() => {
    if (!userId) { setStaff(null); return }
    let active = true
    setError(null)
    api.getStaffProfile(userId).then((result) => { if (active) setStaff({ name: result.user.name, role: result.user.role, profile: result.profile }) }).catch((cause) => { if (active) { setStaff(null); setError(cause instanceof Error ? cause.message : "Unable to load staff signature") } })
    return () => { active = false }
  }, [userId])

  React.useEffect(() => {
    if (!staff?.profile) { setImages({ signature: null, stamp: null }); return }
    let active = true
    let urls: Array<string | null> = []
    Promise.all([
      loadAuthenticatedImage(staff.profile.signatureUrl),
      loadAuthenticatedImage(staff.profile.stampUrl),
    ]).then(([signature, stamp]) => {
      urls = [signature, stamp]
      if (active) setImages({ signature, stamp })
      else urls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    })
    return () => {
      active = false
      urls.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    }
  }, [staff?.profile])

  if (!userId) return <div className={`text-xs text-[var(--cp-ink-soft)] ${className}`}><div className="h-12 border-b border-dashed border-[var(--cp-border-strong)]" /><p className="mt-1">{title}</p></div>
  if (error) return <div role="alert" className={`text-xs text-[var(--cp-critical)] ${className}`}>{error}</div>
  if (!staff) return <div className={`text-xs text-[var(--cp-ink-soft)] ${className}`}>Loading staff signature...</div>

  const profile = staff.profile
  return <div className={`flex flex-wrap items-end gap-5 text-xs text-[var(--cp-ink-soft)] ${className}`}>
    <div className="min-w-36 text-center"><div className="flex h-14 items-end justify-center border-b border-[var(--cp-border-strong)]">{images?.signature && <img src={images.signature} alt={`${staff.name} signature`} className="max-h-12 max-w-32 object-contain" />}</div><p className="mt-1 font-semibold text-[var(--cp-ink)]">{staff.name}</p><p>{title}</p><p>{profile?.qualification ?? ""}{profile?.specialization ? ` · ${profile.specialization}` : ""}</p>{profile?.registrationNumber && <p>Reg. No.: {profile.registrationNumber}</p>}</div>
    {showStamp && <div className="min-w-24 text-center"><div className="flex h-14 items-end justify-center">{images?.stamp && <img src={images.stamp} alt={`${staff.name} stamp`} className="max-h-12 max-w-24 object-contain" />}</div><p className="mt-1">Stamp</p></div>}
  </div>
}