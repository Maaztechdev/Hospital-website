import { useEffect, useState } from "react"
import { NavLink, Link } from "react-router-dom"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Menu, X, PhoneCall, HeartPulse, LayoutDashboard, AlertCircle, Home, Info, Stethoscope, Users, Zap, BookOpen, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { apiAssetUrl, useHospitalProfile } from "@/lib/hospitalProfile"

const NAV_LINKS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/about", label: "About", icon: Info },
  { to: "/departments", label: "Departments", icon: Stethoscope },
  { to: "/doctors", label: "Doctors", icon: Users },
  { to: "/services", label: "Services", icon: Zap },
  { to: "/blog", label: "Health Blog", icon: BookOpen },
  { to: "/contact", label: "Contact", icon: Mail },
]

export function Navbar() {
  const profile = useHospitalProfile()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener("scroll", onScroll)
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  return (
    <motion.header
      initial={false}
      animate={
        reduceMotion
          ? {}
          : scrolled
            ? {
                backgroundColor: "rgba(255,255,255,0.94)",
                boxShadow: "0 1px 18px rgba(23, 105, 170, 0.08)",
              }
            : {
                backgroundColor: "rgba(255,255,255,0.8)",
                boxShadow: "0 0 0 rgba(0,0,0,0)",
              }
      }
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="no-print sticky top-0 z-40 w-full border-b border-[var(--color-border-soft)]/50 backdrop-blur-md"
    >
      <div className="mx-auto w-full max-w-[1600px] overflow-x-hidden px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center gap-2 sm:gap-3">
          <Link to="/" className="group flex shrink-0 items-center gap-2.5" onClick={() => setOpen(false)}>
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] shadow-md shadow-[var(--color-primary)]/20 transition-shadow duration-300 group-hover:shadow-lg group-hover:shadow-[var(--color-primary)]/30">
              {profile.logoUrl ? (
                <img src={apiAssetUrl(profile.logoUrl)} alt="" className="h-7 w-7 object-contain" />
              ) : (
                <HeartPulse className="h-4.5 w-4.5 text-white" />
              )}
            </div>
            <div className="flex max-w-[112px] items-center xl:max-w-none">
              <div className="truncate text-sm font-bold leading-tight text-[var(--color-ink)]">{profile.name}</div>
            </div>
          </Link>

          <nav className="hidden min-w-0 flex-1 flex-nowrap items-center justify-center gap-0.5 xl:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => {
              const IconComp = link.icon as typeof Home
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === "/"}
                  className={({ isActive }) =>
                    `nav-link-underline group relative flex shrink-0 items-center gap-1 rounded-md px-1 py-1.5 text-xs font-medium transition-colors duration-200 xl:px-2 xl:text-sm ${
                      isActive
                        ? "text-[var(--color-primary)]"
                        : "text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <IconComp className="hidden h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110 min-[1600px]:block" />
                      <span>{link.label}</span>
                      {isActive && (
                        <div className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-[var(--color-primary)]" />
                      )}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>

          <div className="hidden shrink-0 items-center gap-1.5 lg:flex xl:gap-2">
            <a
              href={`tel:${profile.phone ?? ""}`}
              className="group hidden items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-[var(--color-ink-soft)] transition-all duration-200 hover:bg-blue-50/60 hover:text-[var(--color-primary)] min-[1280px]:flex min-[1280px]:px-3"
            >
              <PhoneCall className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
              <span className="whitespace-nowrap font-semibold text-[var(--color-ink)]">{profile.phone || "Contact hospital"}</span>
            </a>

            <a
              href={`tel:${profile.phone ?? ""}`}
              aria-label={profile.phone ? `Call ${profile.phone}` : "Call hospital"}
              title={profile.phone || "Call hospital"}
              className="flex items-center rounded-md p-2 text-[var(--color-ink-soft)] transition-all duration-200 hover:bg-blue-50/60 hover:text-[var(--color-primary)] min-[1280px]:hidden"
            >
              <PhoneCall className="h-4 w-4" />
            </a>

            <div className="hidden h-5 w-px bg-[var(--color-border-soft)] min-[1280px]:block" />

            <Link to="/dashboard" aria-label="Dashboard" title="Dashboard" className="hidden min-[1280px]:inline-flex">
              <Button
                variant="outline"
                size="sm"
                className="flex shrink-0 items-center gap-1.5 rounded-full border-[var(--color-border-soft)] text-[var(--color-ink-soft)] transition-all duration-200 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] hover:bg-blue-50"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span className="whitespace-nowrap">Dashboard</span>
              </Button>
            </Link>

            <Link to="/contact#emergency" className="shrink-0">
              <Button
                variant="emergency"
                size="sm"
                className="flex items-center gap-1.5 rounded-full px-3 text-white shadow-sm transition-all duration-200 hover:shadow-md"
              >
                <AlertCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Emergency</span>
              </Button>
            </Link>

            <Link to="/appointment" className="shrink-0">
              <Button
                variant="primary"
                size="sm"
                className="flex items-center gap-1.5 rounded-full px-3 text-white shadow-sm transition-all duration-200 hover:shadow-md"
              >
                <span>Book</span>
              </Button>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <Link to="/contact#emergency" aria-label="Emergency" title="Emergency">
              <Button variant="emergency" size="sm" className="rounded-full px-2.5 text-white shadow-sm">
                <AlertCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Emergency</span>
              </Button>
            </Link>
            <Link to="/appointment" aria-label="Book an appointment" title="Book an appointment">
              <Button variant="primary" size="sm" className="rounded-full px-2.5 text-white shadow-sm">
                <span>Book</span>
              </Button>
            </Link>
          </div>

          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-2 transition-colors duration-200 hover:bg-blue-50 lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="fixed inset-y-0 right-0 top-0 z-[70] flex h-screen w-[84vw] max-w-sm flex-col overflow-y-auto bg-white shadow-2xl lg:hidden"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4">
                <span className="font-bold text-[var(--color-ink)]">Menu</span>
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 -mr-2 rounded-md hover:bg-blue-50 transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="flex flex-col gap-1 px-3 py-4" aria-label="Mobile">
                {NAV_LINKS.map((link) => {
                  const IconComp = link.icon as typeof Home
                  return (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.to === "/"}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                          isActive
                            ? "bg-blue-100/60 text-[var(--color-primary)]"
                            : "text-[var(--color-ink-soft)] hover:text-[var(--color-primary)] hover:bg-blue-50"
                        }`
                      }
                    >
                      <IconComp className="h-4 w-4 shrink-0" />
                      <span>{link.label}</span>
                    </NavLink>
                  )
                })}
              </nav>

              <div className="h-px bg-[var(--color-border-soft)] mx-6" />

              <div className="flex flex-col gap-3 px-6 py-4">
                <a
                  href="tel:+924211234567"
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-primary)] hover:bg-blue-50 transition-all duration-200"
                >
                  <PhoneCall className="h-4 w-4 shrink-0" />
                  <span>{profile.phone || "Contact hospital"}</span>
                </a>

                <Link to="/dashboard" onClick={() => setOpen(false)}>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 rounded-lg border-[var(--color-border-soft)]"
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                  </Button>
                </Link>

                <Link to="/appointment" onClick={() => setOpen(false)}>
                  <Button variant="primary" className="w-full justify-center rounded-lg">
                    Book Appointment
                  </Button>
                </Link>

                <Link to="/contact#emergency" onClick={() => setOpen(false)}>
                  <Button variant="emergency" className="w-full justify-center gap-2 rounded-lg">
                    <AlertCircle className="h-4 w-4" />
                    Emergency
                  </Button>
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
