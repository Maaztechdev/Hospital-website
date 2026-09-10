import { Link } from "react-router-dom"
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { services } from "@/data/services"

export default function Services() {
  return (
    <div>
      <PageHeader
        eyebrow="Services"
        title="Care services, transparent from the start."
        description="Indicative pricing in PKR so you know roughly what to expect before you arrive. Final cost depends on your specific case."
      />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((svc, i) => (
            <Reveal key={svc.id} delay={(i % 6) * 0.05}>
              <Card className="flex h-full flex-col p-6 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-light)]">
                  <svc.icon className="h-5 w-5 text-[var(--color-accent-dark)]" />
                </div>
                <h3 className="mb-1.5 font-[var(--font-display)] font-bold text-[var(--color-ink)]">{svc.name}</h3>
                <p className="mb-4 flex-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{svc.description}</p>
                <div className="mb-4 flex items-center justify-between border-t border-[var(--color-border-soft)] pt-4 text-sm">
                  <div>
                    <div className="font-[var(--font-data)] font-bold text-[var(--color-primary)]">{svc.priceFrom}</div>
                    <div className="text-xs text-[var(--color-ink-faint)]">starting from</div>
                  </div>
                  <div className="text-right text-xs text-[var(--color-ink-faint)]">{svc.duration}</div>
                </div>
                <Link to={`/appointment?service=${svc.id}`}>
                  <Button variant="outline" size="sm" className="w-full">Book this service</Button>
                </Link>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  )
}
