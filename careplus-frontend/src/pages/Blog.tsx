import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Search, Calendar, Clock, Frown } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/shared/EmptyState"
import { blogPosts } from "@/data/blog"
import { formatDate as formatHospitalDate } from "@/lib/dateTime"

function formatDate(iso: string) {
  return formatHospitalDate(iso)
}

export default function Blog() {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return blogPosts
    return blogPosts.filter(
      (p) => p.title.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <div>
      <PageHeader
        eyebrow="Health Blog"
        title="Health guidance from our own specialists."
        description="Practical, doctor-written articles to help you understand conditions before and after your visit."
      >
        <div className="relative mt-6 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <Input placeholder="Search articles..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" aria-label="Search articles" />
        </div>
      </PageHeader>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        {filtered.length === 0 ? (
          <EmptyState icon={Frown} title="No articles found" description="Try a different search term." actionLabel="Clear search" onAction={() => setQuery("")} />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((post, i) => (
              <Reveal key={post.id} delay={(i % 6) * 0.05}>
                <Link to={`/blog/${post.id}`}>
                  <Card className="flex h-full flex-col p-6 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                    <Badge variant="primary" className="mb-3 w-fit">{post.category}</Badge>
                    <h3 className="mb-2 font-[var(--font-display)] font-bold leading-snug text-[var(--color-ink)]">{post.title}</h3>
                    <p className="mb-4 flex-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{post.excerpt}</p>
                    <div className="flex items-center gap-4 border-t border-[var(--color-border-soft)] pt-4 text-xs text-[var(--color-ink-faint)]">
                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {formatDate(post.date)}</span>
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {post.readMinutes} min read</span>
                    </div>
                  </Card>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
