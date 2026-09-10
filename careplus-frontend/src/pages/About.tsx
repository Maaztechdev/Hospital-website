import { Target, Eye, HeartHandshake, Building2, Users, ShieldCheck } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card, CardContent } from "@/components/ui/card"
import { PulseDivider } from "@/components/shared/PulseDivider"

const values = [
  { icon: HeartHandshake, title: "Compassion", text: "Every patient is treated as family — with patience, dignity and clear communication." },
  { icon: ShieldCheck, title: "Integrity", text: "Honest guidance and transparent pricing, even when it isn't the easy answer." },
  { icon: Users, title: "Collaboration", text: "Our specialists consult across departments so no diagnosis happens in isolation." },
  { icon: Building2, title: "Excellence", text: "Continuous investment in equipment, training and process improvement." },
]

const timeline = [
  { year: "2008", text: "Khalida Medicare Hospital opens with 40 beds and three founding departments." },
  { year: "2013", text: "Cardiology wing and dedicated cath lab open to the public." },
  { year: "2017", text: "Pediatric NICU launched alongside 24/7 emergency services." },
  { year: "2022", text: "Digital patient records and online appointment booking introduced." },
  { year: "2026", text: "Now serving over 40,000 patients annually across 10+ departments." },
]

export default function About() {
  return (
    <div>
      <PageHeader
        eyebrow="About Khalida Medicare"
        title="Built around one belief: care should feel personal."
        description="Since 2008, Khalida Medicare Hospital has grown from a 40-bed facility into a multi-specialty hospital — without losing the personal attention patients came to expect on day one."
      />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Reveal>
            <Card className="h-full p-8">
              <Target className="mb-4 h-8 w-8 text-[var(--color-primary)]" />
              <h2 className="mb-2 font-[var(--font-display)] text-xl font-bold text-[var(--color-ink)]">Our Mission</h2>
              <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
                To deliver accessible, evidence-based healthcare with clear communication — so every
                patient understands their diagnosis, their options, and their next step.
              </p>
            </Card>
          </Reveal>
          <Reveal delay={0.08}>
            <Card className="h-full p-8">
              <Eye className="mb-4 h-8 w-8 text-[var(--color-accent)]" />
              <h2 className="mb-2 font-[var(--font-display)] text-xl font-bold text-[var(--color-ink)]">Our Vision</h2>
              <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
                To be the region's most trusted multi-specialty hospital — recognized as much for how
                we treat people as for our clinical outcomes.
              </p>
            </Card>
          </Reveal>
        </div>
      </section>

      <PulseDivider />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="mb-10 text-center text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">
            What guides our team
          </h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v, i) => (
            <Reveal key={v.title} delay={i * 0.06}>
              <Card className="h-full p-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)]">
                  <v.icon className="h-5 w-5 text-[var(--color-accent-dark)]" />
                </div>
                <h3 className="mb-1.5 font-[var(--font-display)] font-bold text-[var(--color-ink)]">{v.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">{v.text}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="mb-10 text-center text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">
              Our journey
            </h2>
          </Reveal>
          <div className="space-y-8 border-l-2 border-[var(--color-border-soft)] pl-6">
            {timeline.map((t, i) => (
              <Reveal key={t.year} delay={i * 0.05}>
                <div className="relative">
                  <div className="absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-[var(--color-accent)]" />
                  <span className="font-[var(--font-data)] text-sm font-bold text-[var(--color-primary)]">{t.year}</span>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal>
          <Card className="overflow-hidden">
            <CardContent className="grid grid-cols-1 gap-8 p-8 sm:grid-cols-3 sm:p-10">
              <div className="text-center">
                <div className="font-[var(--font-data)] text-3xl font-bold text-[var(--color-primary)]">150+</div>
                <div className="mt-1 text-sm text-[var(--color-ink-soft)]">Beds across departments</div>
              </div>
              <div className="text-center">
                <div className="font-[var(--font-data)] text-3xl font-bold text-[var(--color-primary)]">24/7</div>
                <div className="mt-1 text-sm text-[var(--color-ink-soft)]">Emergency availability</div>
              </div>
              <div className="text-center">
                <div className="font-[var(--font-data)] text-3xl font-bold text-[var(--color-primary)]">18</div>
                <div className="mt-1 text-sm text-[var(--color-ink-soft)]">Years serving Pakistan</div>
              </div>
            </CardContent>
          </Card>
        </Reveal>
      </section>
    </div>
  )
}
