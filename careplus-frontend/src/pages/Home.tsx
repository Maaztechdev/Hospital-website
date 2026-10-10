import { Link } from "react-router-dom"
import { useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import {
  ArrowRight, ShieldCheck, Clock, Award, Quote, CalendarCheck, Stethoscope, HeartPulse, Brain, Bone, Baby, Pill, Syringe, Activity, Ear,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Reveal } from "@/components/shared/Reveal"
import { StatCounter } from "@/components/shared/StatCounter"
import { PulseDivider } from "@/components/shared/PulseDivider"
import { BedAvailabilityWidget } from "@/components/shared/BedAvailabilityWidget"
import { departments } from "../data/departments"
import { hospitalStats, testimonials } from "../data/beds"
import { blogPosts } from "@/data/blog"
import { api, apiAssetUrl } from "@/lib/api"
import { usePublicDoctors } from "@/hooks/use-public-doctors"
import { useToast } from "@/hooks/use-toast"

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
}
const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}

function getDoctorInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export default function Home() {
  const [liveDepartments, setLiveDepartments] = useState(departments)
  const [testimonialIndex, setTestimonialIndex] = useState(0)
  const [isMobileView, setIsMobileView] = useState(false)
  const [paused, setPaused] = useState(false)
  const { doctors: publicDoctors, loading: doctorsLoading, error: doctorsError } = usePublicDoctors()
  const { toast } = useToast()
  const reduceMotion = useReducedMotion()
  const previewDoctors = publicDoctors.slice(0, 4)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)")
    const sync = () => setIsMobileView(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener("change", sync)
    return () => mediaQuery.removeEventListener("change", sync)
  }, [])

  useEffect(() => {
    if (reduceMotion || paused) return
    const visibleItems = isMobileView ? 1 : 3
    const slideCount = Math.max(1, testimonials.length - visibleItems + 1)
    const timer = window.setInterval(() => {
      setTestimonialIndex((current) => (current + 1) % slideCount)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [isMobileView, paused, reduceMotion])

  const testimonialSlides = useMemo(() => {
    const visibleItems = isMobileView ? 1 : 3
    const slides: typeof testimonials[] = []
    for (let i = 0; i < testimonials.length; i += visibleItems) {
      slides.push(testimonials.slice(i, i + visibleItems))
    }
    return slides
  }, [isMobileView])

  useEffect(() => {
    api.listPublicDepartments().then((items) => setLiveDepartments(items.map((item) => {
      const fallback = departments.find((department) => department.name.toLowerCase() === item.name.toLowerCase())
      const icons = { Stethoscope, HeartPulse, Brain, Bone, Baby, Pill, Syringe, Activity, Ear }
      return { id: item.id, name: item.name, icon: icons[item.icon as keyof typeof icons] || fallback?.icon || Stethoscope, summary: fallback?.summary || "Specialized care from an experienced clinical team.", description: fallback?.description || "Coordinated care from our experienced clinical team.", services: fallback?.services || [], doctorCount: item._count.doctors, image: fallback?.image || "general-medicine" }
    }))).catch((cause) => toast({ title: "Unable to refresh departments", description: cause instanceof Error ? cause.message : "Showing available departments.", variant: "error" }))
  }, [toast])

  return (
    <div>
      <section className="border-b border-[var(--color-border-soft)] bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:px-8 lg:py-20">
          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div variants={item}>
              <Badge variant="accent">Trusted care since 2008</Badge>
            </motion.div>
            <motion.h1
              variants={container}
              initial="hidden"
              animate="show"
              className="mt-5 text-balance text-4xl font-bold leading-[1.1] text-[var(--color-ink)] sm:text-5xl lg:text-6xl"
            >
              {[
                "Modern medicine,",
                "delivered with",
                "genuine care.",
              ].map((line, index) => (
                <motion.span
                  key={line}
                  variants={item}
                  className="mb-1 block"
                  transition={{ delay: index * 0.12 }}
                >
                  {line}
                </motion.span>
              ))}
            </motion.h1>
            <motion.p
              variants={item}
              initial="hidden"
              animate="show"
              className="mt-5 max-w-xl text-base leading-relaxed text-[var(--color-ink-soft)] sm:text-lg"
            >
              Khalida Medicare Hospital pairs experienced specialists with modern diagnostics, so your family
              gets clear answers and steady care — from routine checkups to emergencies.
            </motion.p>
            <motion.div variants={item} initial="hidden" animate="show" className="mt-8 flex flex-wrap gap-3">
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
            <motion.div variants={item} initial="hidden" animate="show" className="mt-10 flex flex-wrap gap-6">
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
            animate={reduceMotion ? { opacity: 1, x: 0 } : { opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <BedAvailabilityWidget />
          </motion.div>
        </div>
      </section>

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
              <Link to={`/departments#${dept.id}`} className="block h-full">
                <Card className="group h-full p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-primary-light)] transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 group-hover:bg-[var(--color-primary)]">
                    <dept.icon className="h-5 w-5 text-[var(--color-primary)] transition-colors duration-300 group-hover:text-white" />
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

        {doctorsLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-[290px] animate-pulse rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-ink-faint)]/10" />
            ))}
          </div>
        ) : previewDoctors.length === 0 || doctorsError ? (
          <div className="rounded-2xl border border-dashed border-[var(--color-border-soft)] bg-white px-6 py-10 text-center text-sm text-[var(--color-ink-soft)]">
            {doctorsError ? "Doctor profiles are temporarily unavailable." : "Doctor profiles coming soon."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {previewDoctors.map((doc, i: number) => {
              const initials = getDoctorInitials(doc.user.name)
              const profilePhotoUrl = doc.user.profilePictureUrl
              const hasPhoto = Boolean(profilePhotoUrl)
              const departmentName = doc.department?.name
              const specialization = doc.specialization || "Hospital specialist"
              const bio = (doc as { bio?: string }).bio?.trim()

              return (
                <Reveal key={doc.id} delay={i * 0.05}>
                  <Card className="h-full overflow-hidden hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-care-hover">
                    <div className="relative flex h-32 items-center justify-center overflow-hidden bg-gradient-to-br from-[var(--color-primary-light)] to-[var(--color-accent-light)]">
                      {hasPhoto ? (
                        <img
                          src={apiAssetUrl(profilePhotoUrl)}
                          alt={doc.user.name}
                          className="h-full w-full object-cover"
                          onError={(event) => {
                            const img = event.currentTarget
                            img.style.display = "none"
                          }}
                        />
                      ) : (
                        <span className="font-[var(--font-display)] text-3xl font-bold text-[var(--color-primary)]">
                          {initials}
                        </span>
                      )}
                    </div>
                    <CardContent className="flex h-[calc(100%-8rem)] flex-col justify-center pt-5">
                      <h3 className="font-[var(--font-display)] font-bold text-[var(--color-ink)]">{doc.user.name}</h3>
                      <p className="mt-0.5 text-sm text-[var(--color-accent-dark)]">{specialization}</p>
                      {departmentName && <p className="mt-1 text-xs text-[var(--color-ink-soft)]">{departmentName}</p>}
                      {bio && <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">{bio}</p>}
                    </CardContent>
                  </Card>
                </Reveal>
              )
            })}
          </div>
        )}
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="mb-10 text-center text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">
              Stories from our patients
            </h2>
          </Reveal>
          <div
            className="overflow-hidden"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onTouchStart={() => setPaused(true)}
            onTouchEnd={() => setPaused(false)}
          >
            <motion.div
              className="flex"
              animate={reduceMotion ? { x: 0 } : { x: `-${testimonialIndex * 100}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {testimonialSlides.map((slide, slideIndex) => (
                <div key={slideIndex} className="w-full shrink-0 pr-0">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    {slide.map((t, itemIndex) => (
                      <Card key={`${slideIndex}-${t.name}`} className="h-full p-6">
                        <Quote className="mb-3 h-6 w-6 text-[var(--color-accent)]" />
                        <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">{t.text}</p>
                        <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">{t.name}</p>
                        <p className="text-xs text-[var(--color-ink-faint)]">{t.role}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2">
            {testimonialSlides.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`View testimonial slide ${index + 1}`}
                onClick={() => setTestimonialIndex(index)}
                className={`h-2.5 rounded-full transition-all duration-200 ${
                  testimonialIndex === index ? "w-7 bg-[var(--color-primary)]" : "w-2.5 bg-[var(--color-border-soft)]"
                }`}
              />
            ))}
          </div>
        </div>
      </section>

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

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <Reveal>
          <div className="cta-gradient flex flex-col items-center gap-6 rounded-2xl px-8 py-14 text-center shadow-care-hover">
            <div className="heartbeat-icon flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
              <Stethoscope className="h-8 w-8 text-white" />
            </div>
            <h2 className="max-w-xl text-balance text-3xl font-bold text-white sm:text-4xl">
              Your health deserves a plan, not just an appointment.
            </h2>
            <Link to="/appointment">
              <Button size="lg" variant="accent" className="shadow-lg hover:-translate-y-1 hover:shadow-xl">
                <CalendarCheck className="h-4 w-4" /> Book Your Visit
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  )
}
