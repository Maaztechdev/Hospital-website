import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Search, ArrowRight, Frown, Stethoscope, HeartPulse, Bone, Baby, Brain, Pill, Syringe, Activity, Eye, Ear } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/shared/EmptyState"
import { departments } from "@/data/departments"
import { api } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

const iconMap = { HeartPulse, Bone, Baby, Brain, Pill, Syringe, Activity, Stethoscope, Eye, Ear }

export default function Departments() {
  const [query, setQuery] = useState("")
  const [liveDepartments, setLiveDepartments] = useState(departments)
  const { toast } = useToast()

  useEffect(() => {
    api.listPublicDepartments().then((items) => setLiveDepartments(items.map((item) => {
      const fallback = departments.find((department) => department.name.toLowerCase() === item.name.toLowerCase())
      return { id: item.id, name: item.name, icon: iconMap[item.icon as keyof typeof iconMap] || fallback?.icon || Stethoscope, summary: fallback?.summary || "Specialized hospital care from an experienced clinical team.", description: fallback?.description || "Our clinical team provides coordinated care for this department.", services: fallback?.services || [], doctorCount: item._count.doctors, image: fallback?.image || "general-medicine" }
    }))).catch((cause) => toast({ title: "Unable to refresh departments", description: cause instanceof Error ? cause.message : "Showing available departments.", variant: "error" }))
  }, [toast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return liveDepartments
    return liveDepartments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.summary.toLowerCase().includes(q) ||
        d.services.some((s) => s.toLowerCase().includes(q))
    )
  }, [query, liveDepartments])

  return (
    <div>
      <PageHeader
        eyebrow="Departments"
        title="Specialized care, all under one roof."
        description="Ten departments staffed by experienced specialists, working together so your care never feels fragmented."
      >
        <div className="relative mt-6 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <Input
            placeholder="Search departments or services..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
            aria-label="Search departments"
          />
        </div>
      </PageHeader>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Frown}
            title="No departments match your search"
            description="Try a different keyword, or browse the full list of departments below."
            actionLabel="Clear search"
            onAction={() => setQuery("")}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((dept, i) => (
              <Reveal key={dept.id} delay={(i % 6) * 0.05}>
                <Card id={dept.id} className="h-full scroll-mt-24 p-6 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-primary-light)]">
                      <dept.icon className="h-5 w-5 text-[var(--color-primary)]" />
                    </div>
                    {dept.doctorCount > 0 && <Badge variant="neutral">{dept.doctorCount} doctors</Badge>}
                  </div>
                  <h3 className="mb-1.5 font-[var(--font-display)] text-lg font-bold text-[var(--color-ink)]">
                    {dept.name}
                  </h3>
                  <p className="mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    {dept.description}
                  </p>
                  <div className="mb-5 flex flex-wrap gap-1.5">
                    {dept.services.map((s) => (
                      <Badge key={s} variant="accent">{s}</Badge>
                    ))}
                  </div>
                  <Link
                    to={`/doctors?department=${dept.id}`}
                    className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    See specialists <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
