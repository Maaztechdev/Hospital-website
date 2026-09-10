import { NavLink } from "react-router-dom"
import { ChevronsLeft, ChevronsRight, Cross, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { NAV_BY_ROLE } from "@/dashboard/nav"
import { useHospitalProfile } from "@/lib/hospitalProfile"

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const { currentUser } = useDashboard()
  const items = currentUser ? NAV_BY_ROLE[currentUser.role] : []

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-4 cp-scrollbar">
      {items.map((item) => {
        const Icon = item.icon
        if (item.disabled) {
          return (
            <div
              key={item.path}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/35 cursor-not-allowed",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? `${item.label} — ${item.badge}` : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && (
                <span className="flex flex-1 items-center justify-between">
                  {item.label}
                  {item.badge && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold">{item.badge}</span>}
                </span>
              )}
            </div>
          )
        }
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-[var(--cp-sidebar-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
                isActive && "bg-[var(--cp-sidebar-active)] text-white",
                collapsed && "justify-center px-2"
              )
            }
            title={collapsed ? item.label : undefined}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  const { sidebarCollapsed, dispatch } = useDashboard()
  const profile = useHospitalProfile()

  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col bg-[var(--cp-sidebar)] transition-[width] duration-200 ease-out sm:flex",
        sidebarCollapsed ? "w-[68px]" : "w-64"
      )}
    >
      <div className={cn("flex h-16 items-center gap-2.5 border-b border-white/10 px-4", sidebarCollapsed && "justify-center px-2")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
          <Cross className="h-5 w-5" />
        </span>
        {!sidebarCollapsed && (
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">{profile.name}</p>
            <p className="text-[11px] text-white/50">Hospital</p>
          </div>
        )}
      </div>
      <SidebarContent collapsed={sidebarCollapsed} />
      <button
        onClick={() => dispatch({ type: "TOGGLE_SIDEBAR" })}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="flex items-center justify-center gap-2 border-t border-white/10 py-3 text-xs font-medium text-white/60 hover:bg-[var(--cp-sidebar-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {sidebarCollapsed ? <ChevronsRight className="h-4 w-4" /> : (<><ChevronsLeft className="h-4 w-4" /> Collapse</>)}
      </button>
    </aside>
  )
}

export function MobileSidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useHospitalProfile()
  if (!open) return null
  return (
    <div className="no-print fixed inset-0 z-[80] flex sm:hidden">
      <div className="animate-[cp-fade-in_0.18s_ease-out] fixed inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="animate-[cp-slide-in_0.22s_cubic-bezier(0.16,1,0.3,1)] relative flex h-full w-72 flex-col bg-[var(--cp-sidebar)]">
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white">
              <Cross className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-white">{profile.name}</p>
              <p className="text-[11px] text-white/50">Hospital</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="text-white/70 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div onClick={onClose}>
          <SidebarContent collapsed={false} />
        </div>
      </div>
    </div>
  )
}
