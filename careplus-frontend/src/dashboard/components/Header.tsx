import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Menu, Search, Bell, HelpCircle, ChevronDown, LogOut, UserCircle2, User, Stethoscope, BedDouble } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { ROLE_LABELS, type AppNotification } from "@/dashboard/types"
import { api, clearSession, type ApiNotification } from "@/lib/api"
import { formatTimeAgo } from "@/dashboard/lib/format"
import { MobileSidebarDrawer } from "@/dashboard/components/Sidebar"
import { useHospitalProfile } from "@/lib/hospitalProfile"

function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = React.useRef<T>(null)
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onOutside])
  return ref
}

const URGENCY_GROUPS: { key: AppNotification["urgency"] & string; label: string; tone: string }[] = [
  { key: "Critical", label: "Critical", tone: "text-[var(--cp-critical)]" },
  { key: "Actionable", label: "Actionable", tone: "text-[var(--cp-warning)]" },
  { key: "Informational", label: "Informational", tone: "text-[var(--cp-ink-soft)]" },
]

function toDashboardNotification(notification: ApiNotification): AppNotification {
  const urgency: AppNotification["urgency"] = notification.notificationType.includes("CRITICAL") || notification.notificationType.includes("DISCHARGE")
    ? "Critical"
    : notification.notificationType.includes("PENDING") || notification.notificationType.includes("LOW_STOCK") || notification.notificationType.includes("EXPIRY") || notification.notificationType.includes("INCOMPLETE")
      ? "Actionable"
      : "Informational"
  return {
    id: notification.id,
    title: notification.title,
    description: notification.message,
    time: notification.createdAt,
    read: notification.isRead,
    urgency,
  }
}

export function Header() {
  const profile = useHospitalProfile()
  const { currentUser, dispatch, patients, doctors, beds } = useDashboard()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [notifOpen, setNotifOpen] = React.useState(false)
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [notifications, setNotifications] = React.useState<AppNotification[]>([])
  const [unread, setUnread] = React.useState(0)

  const notifRef = useClickOutside<HTMLDivElement>(() => setNotifOpen(false))
  const profileRef = useClickOutside<HTMLDivElement>(() => setProfileOpen(false))
  const searchRef = useClickOutside<HTMLFormElement>(() => setSearchOpen(false))

  const refreshNotifications = React.useCallback(async () => {
    if (!currentUser) return
    try {
      const [items, unreadResponse] = await Promise.all([api.listNotifications(), api.getUnreadNotificationCount()])
      setNotifications(items.map(toDashboardNotification))
      setUnread(unreadResponse.count)
    } catch { }
  }, [currentUser])

  React.useEffect(() => {
    void refreshNotifications()
    const interval = window.setInterval(() => void refreshNotifications(), 30_000)
    return () => window.clearInterval(interval)
  }, [refreshNotifications])

  async function markNotificationRead(notification: AppNotification) {
    if (notification.read) return
    try {
      await api.markNotificationRead(notification.id)
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item))
      setUnread((count) => Math.max(0, count - 1))
    } catch { }
  }

  async function markAllNotificationsRead() {
    if (unread === 0) return
    try {
      await api.markAllNotificationsRead()
      setNotifications((current) => current.map((notification) => ({ ...notification, read: true })))
      setUnread(0)
    } catch { }
  }

  const q = search.trim().toLowerCase()
  const searchResults = q.length === 0 ? null : {
    patients: patients.filter((p) => p.name.toLowerCase().includes(q) || p.mrNumber.toLowerCase().includes(q)).slice(0, 4),
    doctors: doctors.filter((d) => d.name.toLowerCase().includes(q) || d.department.toLowerCase().includes(q)).slice(0, 3),
    beds: beds.filter((b) => b.bedNumber.toLowerCase().includes(q) || b.patientName?.toLowerCase().includes(q)).slice(0, 3),
  }
  const hasResults = !!searchResults && (searchResults.patients.length + searchResults.doctors.length + searchResults.beds.length > 0)

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (search.trim()) navigate(`/dashboard/patients?q=${encodeURIComponent(search.trim())}`)
    setSearchOpen(false)
  }

  return (
    <header className="no-print sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-[var(--cp-border)] bg-[var(--cp-surface)]/95 px-4 backdrop-blur sm:px-6">
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)] sm:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <MobileSidebarDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="hidden leading-tight sm:block">
        <p className="text-sm font-bold text-[var(--cp-ink)]">{profile.name}</p>
      </div>

      <form onSubmit={onSearchSubmit} className="relative ml-2 hidden max-w-sm flex-1 md:block" ref={searchRef}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSearchOpen(true) }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search patients, doctors, beds…"
          className="h-9 w-full rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] pl-9 pr-3 text-sm text-[var(--cp-ink)] placeholder:text-[var(--cp-ink-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
        />
        {searchOpen && q.length > 0 && (
          <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-xl">
            {!hasResults ? (
              <p className="px-4 py-4 text-center text-xs text-[var(--cp-ink-soft)]">No matches for "{search}"</p>
            ) : (
              <div className="max-h-80 overflow-y-auto cp-scrollbar">
                {searchResults!.patients.length > 0 && (
                  <div>
                    <p className="px-3 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--cp-ink-faint)]">Patients</p>
                    {searchResults!.patients.map((p) => (
                      <button key={p.mrNumber} onClick={() => { navigate(`/dashboard/patients/${p.mrNumber}`); setSearchOpen(false); setSearch("") }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--cp-bg)]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-primary-light)] text-[var(--cp-primary)]"><User className="h-3.5 w-3.5" /></span>
                        <span><span className="block text-sm text-[var(--cp-ink)]">{p.name}</span><span className="cp-tabular block text-xs text-[var(--cp-ink-soft)]">{p.mrNumber}</span></span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults!.doctors.length > 0 && (
                  <div>
                    <p className="px-3 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--cp-ink-faint)]">Doctors</p>
                    {searchResults!.doctors.map((d) => (
                      <button key={d.id} onClick={() => { navigate(`/dashboard/appointments?doctor=${d.id}`); setSearchOpen(false); setSearch("") }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--cp-bg)]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-info-light)] text-[var(--cp-info)]"><Stethoscope className="h-3.5 w-3.5" /></span>
                        <span><span className="block text-sm text-[var(--cp-ink)]">{d.name}</span><span className="block text-xs text-[var(--cp-ink-soft)]">{d.department}</span></span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults!.beds.length > 0 && (
                  <div>
                    <p className="px-3 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--cp-ink-faint)]">Beds</p>
                    {searchResults!.beds.map((b) => (
                      <button key={b.id} onClick={() => { navigate(`/dashboard/ward`); setSearchOpen(false); setSearch("") }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--cp-bg)]">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cp-warning-light)] text-[var(--cp-warning)]"><BedDouble className="h-3.5 w-3.5" /></span>
                        <span><span className="cp-tabular block text-sm text-[var(--cp-ink)]">{b.bedNumber}</span><span className="block text-xs text-[var(--cp-ink-soft)]">{b.ward} · {b.status}{b.patientName ? ` · ${b.patientName}` : ""}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </form>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) void refreshNotifications() }}
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--cp-critical)] text-[9px] font-bold text-white">
                {unread}
              </span>
            )}
          </button>
          {notifOpen && (
            <div role="region" aria-live="polite" className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-xl sm:w-96">
              <div className="border-b border-[var(--cp-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-[var(--cp-ink)]">Notifications</p>
                  {unread > 0 && <button onClick={() => void markAllNotificationsRead()} className="text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">Mark all read</button>}
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto cp-scrollbar">
                {URGENCY_GROUPS.map((group) => {
                  const items = notifications.filter((n) => (n.urgency ?? "Informational") === group.key)
                  if (items.length === 0) return null
                  return (
                    <div key={group.key}>
                      <p className={cn("sticky top-0 bg-[var(--cp-surface-warm)] px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide", group.tone)}>{group.label}</p>
                      {items.map((n) => (
                        <div
                          key={n.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => void markNotificationRead(n)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void markNotificationRead(n) }}
                          className={cn("border-b border-[var(--cp-border)] px-4 py-3 last:border-0 hover:bg-[var(--cp-bg)]", !n.read && "bg-[var(--cp-primary-light)]/30")}
                        >
                          <p className="text-sm font-semibold text-[var(--cp-ink)]">{n.title}</p>
                          <p className="mt-0.5 text-xs text-[var(--cp-ink-soft)]">{n.description}</p>
                          <div className="mt-1.5 flex items-center justify-between">
                            <p className="text-[11px] text-[var(--cp-ink-faint)]">{formatTimeAgo(n.time)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Help */}
        <button
          aria-label="Help"
          className="hidden h-9 w-9 items-center justify-center rounded-lg text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] sm:flex"
        >
          <HelpCircle className="h-5 w-5" />
        </button>

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 hover:bg-[var(--cp-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cp-primary-light)] text-[var(--cp-primary)]">
              <UserCircle2 className="h-5 w-5" />
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-xs font-semibold text-[var(--cp-ink)]">{currentUser?.name}</span>
              <span className="block text-[10px] text-[var(--cp-ink-soft)]">{currentUser ? ROLE_LABELS[currentUser.role] : ""}</span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-[var(--cp-ink-faint)] sm:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1 shadow-xl">
              <button
                onClick={async () => { try { await api.logout() } finally { clearSession(); dispatch({ type: "LOGOUT" }); navigate("/dashboard/login") } }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
