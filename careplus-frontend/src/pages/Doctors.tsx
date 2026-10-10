import { useMemo, useState, useEffect } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { Search, Star, Languages, CalendarDays, Frown, Stethoscope } from "lucide-react"

function getDoctorInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/EmptyState"
import { departments } from "../data/departments"
import { api, apiAssetUrl } from "@/lib/api"
import { usePublicDoctors } from "@/hooks/use-public-doctors"
import { useToast } from "@/hooks/use-toast"

export default function Doctors() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState("")
  const [liveDepartments, setLiveDepartments] = useState(departments)
  const { doctors: liveDoctors, loading: doctorsLoading, error: doctorsError } = usePublicDoctors()
  const { toast } = useToast()
  const deptFilter = params.get("department") ?? "all"

  useEffect(() => {
    window.scrollTo({ top: 0 })
    api.listPublicDepartments().then((apiDepartments) => {
      setLiveDepartments(apiDepartments.map((department) => ({ id: department.id, name: department.name, icon: Stethoscope, summary: "", description: "", services: [], doctorCount: department._count.doctors, image: "general-medicine" })))
    }).catch((cause) => toast({ title: "Unable to refresh doctors", description: cause instanceof Error ? cause.message : "Showing available doctors.", variant: "error" }))
  }, [toast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return liveDoctors.filter((doctor) => {
      const departmentId = doctor.department?.id ?? ""
      const matchesDept = deptFilter === "all" || departmentId === deptFilter
      const specialization = doctor.specialization?.toLowerCase() ?? ""
      const matchesQuery =
        !q ||
        doctor.user.name.toLowerCase().includes(q) ||
        specialization.includes(q)
      return matchesDept && matchesQuery
    })
  }, [query, deptFilter, liveDoctors])

  return (
    <div>
      <PageHeader
        eyebrow="Our Doctors"
        title="Specialists who take the time to listen."
        description="Filter by department to find the right specialist, then book an appointment in a few clicks."
      >
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <Input
              placeholder="Search doctor or specialty..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
              aria-label="Search doctors"
            />
          </div>
          <Select
            value={deptFilter}
            onChange={(e) => setParams(e.target.value === "all" ? {} : { department: e.target.value })}
            className="sm:max-w-[220px]"
            aria-label="Filter by department"
          >
            <option value="all">All departments</option>
            {liveDepartments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        {doctorsLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-[360px] animate-pulse rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-ink-faint)]/10" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Frown}
            title={doctorsError ? "Unable to load doctors" : "No doctors found"}
            description={doctorsError ? "Please try again in a moment." : "Try clearing your search or choosing a different department."}
            actionLabel={doctorsError ? "Refresh" : "Reset filters"}
            onAction={() => {
              if (doctorsError) window.location.reload()
              else {
                setQuery("")
                setParams({})
              }
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((doc, i: number) => {
              const dept = liveDepartments.find((d) => d.id === doc.department?.id)
              const initials = getDoctorInitials(doc.user.name)
              const profilePhotoUrl = doc.user.profilePictureUrl
              const imageError = false
              const displayBio = (doc as { bio?: string }).bio?.trim()
              const languages = (doc as { languages?: string[] }).languages?.filter(Boolean) ?? []
              const availability = (doc as { availability?: string[] }).availability?.filter(Boolean) ?? []
              const rating = (doc as { rating?: number }).rating ?? 5
              const doctorNameParts = doc.user.name.split(" ")
              const shortName = doctorNameParts.length > 1 ? doctorNameParts[1] : doctorNameParts[0]

              return (
                <Reveal key={doc.id} delay={(i % 6) * 0.05}>
                  <Card className="h-full overflow-hidden hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                    <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-[var(--color-primary-light)] to-[var(--color-accent-light)]">
                      {profilePhotoUrl && !imageError ? (
                        <img src={apiAssetUrl(profilePhotoUrl)} alt={doc.user.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="font-[var(--font-display)] text-2xl font-bold text-[var(--color-primary)]">{initials}</span>
                      )}
                    </div>
                    <CardContent className="pt-5">
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <h3 className="font-[var(--font-display)] font-bold text-[var(--color-ink)]">{doc.user.name}</h3>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-ink)]">
                          <Star className="h-3.5 w-3.5 fill-[var(--color-emergency)] text-[var(--color-emergency)]" />
                          {rating}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-accent-dark)]">{doc.specialization || "Hospital specialist"}</p>
                      {dept && <Badge variant="primary" className="mt-2">{dept.name}</Badge>}
                      {displayBio && <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">{displayBio}</p>}
                      <div className="mt-4 space-y-1.5 text-xs text-[var(--color-ink-faint)]">
                        {languages.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Languages className="h-3.5 w-3.5" /> {languages.join(", ")}
                          </div>
                        )}
                        {availability.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5" /> {availability.join(", ")}
                          </div>
                        )}
                      </div>
                      <Link to={`/appointment?doctor=${doc.id}`} className="mt-5 block">
                        <Button variant="primary" size="sm" className="w-full">Book with {shortName}</Button>
                      </Link>
                    </CardContent>
                  </Card>
                </Reveal>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
