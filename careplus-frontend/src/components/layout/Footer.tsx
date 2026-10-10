import { Link } from "react-router-dom"
import { HeartPulse, MapPin, Phone, Mail } from "lucide-react"
import { useHospitalProfile } from "@/lib/hospitalProfile"
import { siteContact } from "@/lib/siteConfig"

const SOCIAL_PATHS = [
  // Facebook
  "M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z",
  // Instagram
  "M12 2c2.7 0 3.1 0 4.1.1 1 .1 1.7.2 2.3.5.6.2 1.1.6 1.6 1.1.5.5.8.9 1.1 1.6.3.6.4 1.3.5 2.3.1 1 .1 1.4.1 4.1s0 3.1-.1 4.1c-.1 1-.2 1.7-.5 2.3-.2.6-.6 1.1-1.1 1.6-.5.5-.9.8-1.6 1.1-.6.3-1.3.4-2.3.5-1 .1-1.4.1-4.1.1s-3.1 0-4.1-.1c-1-.1-1.7-.2-2.3-.5-.6-.2-1.1-.6-1.6-1.1-.5-.5-.8-.9-1.1-1.6-.3-.6-.4-1.3-.5-2.3C2 15.1 2 14.7 2 12s0-3.1.1-4.1c.1-1 .2-1.7.5-2.3.2-.6.6-1.1 1.1-1.6.5-.5.9-.8 1.6-1.1.6-.3 1.3-.4 2.3-.5C8.9 2 9.3 2 12 2Zm0 2.9a5.1 5.1 0 1 0 0 10.2 5.1 5.1 0 0 0 0-10.2Zm0 8.4a3.3 3.3 0 1 1 0-6.6 3.3 3.3 0 0 1 0 6.6Zm5.3-8.6a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Z",
  // X / Twitter
  "M18.3 2H21l-6.4 7.3L22 22h-6.9l-5.4-6.9L3.5 22H1l6.9-7.8L1 2h7l4.9 6.4L18.3 2Zm-1.2 18h1.9L7 4h-2l12.1 16Z",
]

export function Footer() {
  const year = new Date().getFullYear()
  const profile = useHospitalProfile()

  return (
    <footer className="no-print border-t border-[var(--color-border-soft)] bg-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link to="/" className="mb-4 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-primary)]">
                <HeartPulse className="h-5 w-5 text-white" />
              </span>
              <span className="font-[var(--font-display)] text-lg font-bold text-[var(--color-ink)]">
                {profile.name}
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Compassionate care and modern medicine, serving families across Pakistan since 2008.
            </p>
            <div className="mt-4 flex gap-3">
              {SOCIAL_PATHS.map((d, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="Social media link"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)] hover:text-white"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d={d} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Quick Links</h4>
            <ul className="space-y-2.5 text-sm text-[var(--color-ink-soft)]">
              {[
                ["/about", "About Us"],
                ["/departments", "Departments"],
                ["/doctors", "Our Doctors"],
                ["/services", "Services"],
                ["/appointment", "Book Appointment"],
              ].map(([to, label]) => (
                <li key={to}>
                  <Link to={to} className="transition-colors hover:text-[var(--color-primary)]">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Resources</h4>
            <ul className="space-y-2.5 text-sm text-[var(--color-ink-soft)]">
              {[
                ["/blog", "Health Blog"],
                ["/contact", "Contact Us"],
                ["/contact#emergency", "Emergency Care"],
                ["/appointment", "Patient Portal"],
              ].map(([to, label]) => (
                <li key={to}>
                  <Link to={to} className="transition-colors hover:text-[var(--color-primary)]">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">Contact</h4>
            <ul className="space-y-3 text-sm text-[var(--color-ink-soft)]">
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                {profile.address || siteContact.address}
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                <a href={`tel:${profile.phone ?? ""}`} className="hover:text-[var(--color-primary)]">{profile.phone || "Contact hospital"}</a>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                <a href={`mailto:${profile.email ?? siteContact.email}`} className="hover:text-[var(--color-primary)]">{profile.email || siteContact.email}</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-border-soft)] pt-6 text-xs text-[var(--color-ink-faint)] sm:flex-row">
          <p>© {year} {profile.name}. All rights reserved.</p>
          <div className="flex gap-5">
            <Link to="#" className="hover:text-[var(--color-primary)]">Privacy Policy</Link>
            <Link to="#" className="hover:text-[var(--color-primary)]">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
