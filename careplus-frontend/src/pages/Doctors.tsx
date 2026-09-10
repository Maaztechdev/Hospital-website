import { useMemo, useState, useEffect } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { Search, Star, Languages, CalendarDays, Frown, Stethoscope } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/shared/EmptyState"
import { doctors } from "@/data/doctors"
import { departments } from "@/data/departments"
import { api } from "@/lib/api"

export default function Doctors() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState("")
  const [liveDoctors, setLiveDoctors] = useState(doctors)
  const [liveDepartments, setLiveDepartments] = useState(departments)
  const deptFilter = params.get("department") ?? "all"

  useEffect(() => {
    window.scrollTo({ top: 0 })
    Promise.all([api.listPublicDoctors(), api.listPublicDepartments()]).then(([apiDoctors, apiDepartments]) => {
      setLiveDoctors(apiDoctors.map((doctor) => ({ id: doctor.id, name: doctor.user.name, departmentId: doctor.department?.id || "", specialization: doctor.specialization || "Hospital specialist", qualifications: "Medical specialist", experienceYears: 0, rating: 5, languages: ["English", "Urdu"], availability: ["By appointment"], bio: "Providing thoughtful, coordinated care for every patient.", photoSeed: doctor.id })))
      setLiveDepartments(apiDepartments.map((department) => ({ id: department.id, name: department.name, icon: Stethoscope, summary: "", description: "", services: [], doctorCount: department._count.doctors, image: "general-medicine" })))
    }).catch(() => undefined)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return liveDoctors.filter((d) => {
      const matchesDept = deptFilter === "all" || d.departmentId === deptFilter
      const matchesQuery =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.specialization.toLowerCase().includes(q)
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
        {filtered.length === 0 ? (
          <EmptyState
            icon={Frown}
            title="No doctors found"
            description="Try clearing your search or choosing a different department."
            actionLabel="Reset filters"
            onAction={() => {
              setQuery("")
              setParams({})
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((doc, i) => {
              const dept = liveDepartments.find((d) => d.id === doc.departmentId)
              return (
                <Reveal key={doc.id} delay={(i % 6) * 0.05}>
                  <Card className="h-full overflow-hidden hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                    <div className="flex h-28 items-center justify-center bg-gradient-to-br from-[var(--color-primary-light)] to-[var(--color-accent-light)]">
                      <span className="font-[var(--font-display)] text-2xl font-bold text-[var(--color-primary)]">
                        {doc.name.split(" ").filter((_, idx) => idx !== 0).map((n) => n[0]).join("")}
                      </span>
                    </div>
                    <CardContent className="pt-5">
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <h3 className="font-[var(--font-display)] font-bold text-[var(--color-ink)]">{doc.name}</h3>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-ink)]">
                          <Star className="h-3.5 w-3.5 fill-[var(--color-emergency)] text-[var(--color-emergency)]" />
                          {doc.rating}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-accent-dark)]">{doc.specialization}</p>
                      {dept && <Badge variant="primary" className="mt-2">{dept.name}</Badge>}
                      <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">{doc.bio}</p>
                      <div className="mt-4 space-y-1.5 text-xs text-[var(--color-ink-faint)]">
                        <div className="flex items-center gap-1.5">
                          <Languages className="h-3.5 w-3.5" /> {doc.languages.join(", ")}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5" /> {doc.availability.join(", ")}
                        </div>
                      </div>
                      <Link to={`/appointment?doctor=${doc.id}`} className="mt-5 block">
                        <Button variant="primary" size="sm" className="w-full">Book with {doc.name.split(" ")[1]}</Button>
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
