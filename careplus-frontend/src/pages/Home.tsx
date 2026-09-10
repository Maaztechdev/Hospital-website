import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { motion, type Variants } from "framer-motion"
import {
  ArrowRight, ShieldCheck, Clock, Award, Quote, CalendarCheck, Stethoscope, HeartPulse, Brain, Bone, Baby, Pill, Syringe, Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Reveal } from "@/components/shared/Reveal"
import { StatCounter } from "@/components/shared/StatCounter"
import { PulseDivider } from "@/components/shared/PulseDivider"
import { BedAvailabilityWidget } from "@/components/shared/BedAvailabilityWidget"
import { departments } from "@/data/departments"
import { doctors } from "@/data/doctors"
import { hospitalStats, testimonials } from "@/data/beds"
import { blogPosts } from "@/data/blog"
import { api } from "@/lib/api"

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}

export default function Home() {
  const [liveDepartments, setLiveDepartments] = useState(departments)

  useEffect(() => {
    api.listPublicDepartments().then((items) => setLiveDepartments(items.map((item) => {
      const fallback = departments.find((department) => department.name.toLowerCase() === item.name.toLowerCase())
      const icons = { Stethoscope, HeartPulse, Brain, Bone, Baby, Pill, Syringe, Activity }
      return { id: item.id, name: item.name, icon: icons[item.icon as keyof typeof icons] || fallback?.icon || Stethoscope, summary: fallback?.summary || "Specialized care from an experienced clinical team.", description: fallback?.description || "Coordinated care from our experienced clinical team.", services: fallback?.services || [], doctorCount: item._count.doctors, image: fallback?.image || "general-medicine" }
    }))).catch(() => undefined)
  }, [])

  return (
    <div>
      {/* HERO — asymmetric 60/40 split */}
      <section className="border-b border-[var(--color-border-soft)] bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:px-8 lg:py-20">
          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div variants={item}>
              <Badge variant="accent">Trusted care since 2008</Badge>
            </motion.div>
            <motion.h1
              variants={item}
              className="mt-5 text-balance text-4xl font-bold leading-[1.1] text-[var(--color-ink)] sm:text-5xl lg:text-6xl"
            >
              Modern medicine, delivered with genuine care.
            </motion.h1>
            <motion.p
              variants={item}
              className="mt-5 max-w-xl text-base leading-relaxed text-[var(--color-ink-soft)] sm:text-lg"
            >
              Khalida Medicare Hospital pairs experienced specialists with modern diagnostics, so your family
              gets clear answers and steady care — from routine checkups to emergencies.
            </motion.p>
            <motion.div variants={item} className="mt-8 flex flex-wrap gap-3">
              <Link to="/appointment">
                <Button size="lg" variant="primary">
                  Book an Appointment <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/contact#emergency">
                <Button size="lg" variant="outline">
                  24/7 Emergency Line
                </Button>
              </Link>
            </motion.div>
            <motion.div variants={item} className="mt-10 flex flex-wrap gap-6">
              {[
                [ShieldCheck, "JCI-aligned safety standards"],
                [Clock, "24/7 emergency response"],
                [Award, "18 years of trusted care"],
              ].map(([Icon, label], i) => {
                const IconComp = Icon as typeof ShieldCheck
                return (
                  <div key={i} className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
                    <IconComp className="h-4 w-4 text-[var(--color-accent)]" />
                    {label as string}
                  </div>
                )
              })}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <BedAvailabilityWidget />
          </motion.div>
        </div>
      </section>

      {/* STATS */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <div className="grid grid-cols-2 gap-8 rounded-2xl border border-[var(--color-border-soft)] bg-white p-8 shadow-care sm:grid-cols-4">
            {hospitalStats.map((s) => (
              <StatCounter key={s.label} value={s.value} suffix={s.suffix} label={s.label} />
            ))}
          </div>
        </Reveal>
      </section>

      <PulseDivider />

      {/* DEPARTMENTS PREVIEW */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="mb-2 inline-block font-[var(--font-data)] text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)]">
                Departments
              </span>
              <h2 className="text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">
                Care organized around you
              </h2>
            </div>
            <Link to="/departments" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline">
              View all departments <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {liveDepartments.slice(0, 8).map((dept, i) => (
            <Reveal key={dept.id} delay={i * 0.05}>
              <Link to={`/departments#${dept.id}`}>
                <Card className="group h-full p-6 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-light)] transition-transform duration-200 group-hover:scale-110">
                    <dept.icon className="h-5 w-5 text-[var(--color-primary)]" />
                  </div>
                  <h3 className="mb-1.5 font-[var(--font-display)] font-bold text-[var(--color-ink)]">{dept.name}</h3>
                  <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">{dept.summary}</p>
                </Card>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <PulseDivider />

      {/* DOCTORS PREVIEW */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="mb-2 inline-block font-[var(--font-data)] text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)]">
                Our Specialists
              </span>
              <h2 className="text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">
                Meet a few of our doctors
              </h2>
            </div>
            <Link to="/doctors" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline">
              View all doctors <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {doctors.slice(0, 4).map((doc, i) => (
            <Reveal key={doc.id} delay={i * 0.05}>
              <Card className="h-full overflow-hidden hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                <div className="flex h-32 items-center justify-center bg-gradient-to-br from-[var(--color-primary-light)] to-[var(--color-accent-light)]">
                  <span className="font-[var(--font-display)] text-3xl font-bold text-[var(--color-primary)]">
                    {doc.name.split(" ").map((n) => n[0]).slice(1).join("")}
                  </span>
                </div>
                <CardContent className="pt-5">
                  <h3 className="font-[var(--font-display)] font-bold text-[var(--color-ink)]">{doc.name}</h3>
                  <p className="mt-0.5 text-sm text-[var(--color-accent-dark)]">{doc.specialization}</p>
                  <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{doc.experienceYears} yrs experience</p>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="mb-10 text-center text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">
              Stories from our patients
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.08}>
                <Card className="h-full p-6">
                  <Quote className="mb-3 h-6 w-6 text-[var(--color-accent)]" />
                  <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">{t.text}</p>
                  <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">{t.name}</p>
                  <p className="text-xs text-[var(--color-ink-faint)]">{t.role}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* BLOG PREVIEW */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Reveal>
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="mb-2 inline-block font-[var(--font-data)] text-xs font-semibold uppercase tracking-widest text-[var(--color-accent)]">
                Health Blog
              </span>
              <h2 className="text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">Recent articles</h2>
            </div>
            <Link to="/blog" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline">
              Read the blog <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {blogPosts.slice(0, 3).map((post, i) => (
            <Reveal key={post.id} delay={i * 0.06}>
              <Link to={`/blog/${post.id}`}>
                <Card className="h-full p-6 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                  <Badge variant="primary">{post.category}</Badge>
                  <h3 className="mt-3 font-[var(--font-display)] font-bold leading-snug text-[var(--color-ink)]">
                    {post.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{post.excerpt}</p>
                </Card>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <Reveal>
          <div className="flex flex-col items-center gap-6 rounded-2xl bg-[var(--color-primary)] px-8 py-14 text-center">
            <Stethoscope className="h-8 w-8 text-white/80" />
            <h2 className="max-w-xl text-balance text-3xl font-bold text-white sm:text-4xl">
              Your health deserves a plan, not just an appointment.
            </h2>
            <Link to="/appointment">
              <Button size="lg" variant="accent">
                <CalendarCheck className="h-4 w-4" /> Book Your Visit
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  )
}
