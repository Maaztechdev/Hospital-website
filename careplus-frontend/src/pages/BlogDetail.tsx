import { useEffect } from "react"
import { Link, useParams, Navigate } from "react-router-dom"
import { ArrowLeft, Calendar, Clock, User2 } from "lucide-react"
import { Reveal } from "@/components/shared/Reveal"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { blogPosts } from "@/data/blog"
import { formatDate as formatHospitalDate } from "@/lib/dateTime"

function formatDate(iso: string) {
  return formatHospitalDate(iso)
}

export default function BlogDetail() {
  const { id } = useParams()
  const post = blogPosts.find((p) => p.id === id)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [id])

  if (!post) return <Navigate to="/blog" replace />

  const related = blogPosts.filter((p) => p.id !== post.id && p.category === post.category).slice(0, 2)

  return (
    <div>
      <section className="border-b border-[var(--color-border-soft)] bg-white">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
          <Link to="/blog" className="mb-6 flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]">
            <ArrowLeft className="h-4 w-4" /> Back to blog
          </Link>
          <Reveal>
            <Badge variant="primary" className="mb-4">{post.category}</Badge>
            <h1 className="text-balance text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">{post.title}</h1>
            <div className="mt-5 flex flex-wrap items-center gap-5 text-sm text-[var(--color-ink-faint)]">
              <span className="flex items-center gap-1.5"><User2 className="h-4 w-4" /> {post.author}</span>
              <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> {formatDate(post.date)}</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {post.readMinutes} min read</span>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <div className="space-y-5 text-base leading-relaxed text-[var(--color-ink-soft)]">
            {post.content.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="mt-10 border-l-4 border-l-[var(--color-accent)] p-5">
            <p className="text-sm text-[var(--color-ink-soft)]">
              This article is for general information only and doesn't replace a consultation.
              If you have concerns about your health, <Link to="/appointment" className="font-semibold text-[var(--color-primary)] hover:underline">book an appointment</Link> with one of our specialists.
            </p>
          </Card>
        </Reveal>

        {related.length > 0 && (
          <div className="mt-14">
            <h2 className="mb-5 font-[var(--font-display)] text-xl font-bold text-[var(--color-ink)]">Related articles</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {related.map((p) => (
                <Link key={p.id} to={`/blog/${p.id}`}>
                  <Card className="h-full p-5 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                    <h3 className="font-[var(--font-display)] font-bold text-[var(--color-ink)]">{p.title}</h3>
                    <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{p.excerpt}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
