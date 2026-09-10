import * as React from "react"
import { api, apiAssetUrl, getAccessToken, subscribeToSession, type ApiHospitalProfile } from "@/lib/api"

export const DEFAULT_HOSPITAL_PROFILE: ApiHospitalProfile = {
  id: "default",
  name: "Khalida Medicare Hospital",
  registrationNo: "PHC-2019-0451",
  phone: "+92 42 3587 4210",
  email: "info@khalida.pk",
  address: "12-B Gulberg III, Lahore, Pakistan",
  currency: "PKR",
  timezone: "Asia/Karachi",
}

const STORAGE_KEY = "careplus.hospitalProfile"
const PROFILE_EVENT = "careplus:hospital-profile"

function readStoredProfile() {
  try { return { ...DEFAULT_HOSPITAL_PROFILE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")} as ApiHospitalProfile } catch { return DEFAULT_HOSPITAL_PROFILE }
}

export function storeHospitalProfile(profile: ApiHospitalProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: profile }))
}

const ProfileContext = React.createContext<ApiHospitalProfile>(DEFAULT_HOSPITAL_PROFILE)

export function HospitalProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = React.useState(readStoredProfile)
  React.useEffect(() => {
    const onProfile = (event: Event) => setProfile((event as CustomEvent<ApiHospitalProfile>).detail)
    window.addEventListener(PROFILE_EVENT, onProfile)
    const load = () => api.getHospitalProfile().then((value) => { if (value) storeHospitalProfile(value || DEFAULT_HOSPITAL_PROFILE) }).catch(() => undefined)
    load()
    const unsubscribe = subscribeToSession(() => { if (getAccessToken()) load() })
    return () => { window.removeEventListener(PROFILE_EVENT, onProfile); unsubscribe() }
  }, [])
  React.useEffect(() => { if (profile.faviconUrl) { const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') || document.createElement("link"); link.rel = "icon"; link.href = apiAssetUrl(profile.faviconUrl); document.head.appendChild(link) } }, [profile.faviconUrl])
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>
}

export function useHospitalProfile() { return React.useContext(ProfileContext) }
export { apiAssetUrl }
