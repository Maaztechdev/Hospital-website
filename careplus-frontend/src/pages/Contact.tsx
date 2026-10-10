import { useState } from "react"
import { motion } from "framer-motion"
import { Phone, MapPin, Mail, Clock, Ambulance, Send } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader"
import { Reveal } from "@/components/shared/Reveal"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useHospitalProfile } from "@/lib/hospitalProfile"
import { siteContact } from "@/lib/siteConfig"
import { useToast } from "@/hooks/use-toast"

interface ContactForm {
  name: string
  phone: string
  subject: string
  message: string
}

export default function Contact() {
  const profile = useHospitalProfile()
  const { toast } = useToast()
  const [form, setForm] = useState<ContactForm>({ name: "", phone: "", subject: "general", message: "" })
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const [shakeKey, setShakeKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  function update<K extends keyof ContactForm>(key: K, value: ContactForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: false }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, boolean> = {}
    if (!form.name.trim()) newErrors.name = true
    if (!/^\+?\d[\d\s-]{8,}$/.test(form.phone.trim())) newErrors.phone = true
    if (!form.message.trim()) newErrors.message = true
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) {
      setShakeKey((k) => k + 1)
      return
    }
    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      setForm({ name: "", phone: "", subject: "general", message: "" })
      toast({ title: "Message sent", description: "Our team will get back to you within one business day.", variant: "success" })
    }, 900)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Contact"
        title="We're here whenever you need us."
        description="Reach out for general questions, or use the emergency line below for urgent care."
      />

      <section id="emergency" className="scroll-mt-24 bg-[var(--color-emergency)] py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 text-white">
            <Ambulance className="h-7 w-7 shrink-0" />
            <div>
              <p className="font-[var(--font-display)] font-bold">24/7 Emergency Line</p>
              <p className="text-sm text-white/85">For life-threatening emergencies, call immediately</p>
            </div>
          </div>
          <a href={`tel:${profile.emergencyContact || profile.phone || ""}`}>
            <Button variant="outline" className="border-white bg-white text-[var(--color-emergency)] hover:bg-white/90">
              <Phone className="h-4 w-4" /> {profile.emergencyContact || profile.phone || "Contact hospital"}
            </Button>
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.2fr]">
          <Reveal>
            <div className="space-y-5">
              {[
                { icon: MapPin, title: "Address", lines: [profile.address || siteContact.address] },
                { icon: Phone, title: "Phone", lines: [profile.phone || "Contact hospital", "Mon–Sat, 8am–8pm"] },
                { icon: Mail, title: "Email", lines: [profile.email || siteContact.email, "We reply within 1 business day"] },
                { icon: Clock, title: "Visiting Hours", lines: ["Outpatient: 8am – 8pm daily", "Emergency: 24/7"] },
              ].map((c) => (
                <Card key={c.title} className="flex items-start gap-4 p-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-light)]">
                    <c.icon className="h-5 w-5 text-[var(--color-primary)]" />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--color-ink)]">{c.title}</p>
                    {c.lines.map((l) => (
                      <p key={l} className="text-sm text-[var(--color-ink-soft)]">{l}</p>
                    ))}
                  </div>
                </Card>
              ))}
              <div className="overflow-hidden rounded-2xl border border-[var(--color-border-soft)]">
                <div className="flex h-48 items-center justify-center bg-[var(--color-primary-light)] text-sm text-[var(--color-ink-faint)]">
                  Map preview — {profile.address || siteContact.address}
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <motion.div key={shakeKey} animate={Object.keys(errors).length ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
              <Card className="p-6 sm:p-8">
                <h2 className="mb-6 font-[var(--font-display)] text-xl font-bold text-[var(--color-ink)]">Send us a message</h2>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="name">Full name {errors.name && <span className="text-[var(--color-emergency)]">— required</span>}</Label>
                      <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} error={errors.name} placeholder="Your name" />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone {errors.phone && <span className="text-[var(--color-emergency)]">— invalid</span>}</Label>
                      <Input id="phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} error={errors.phone} placeholder="0300 1234567" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="subject">Subject</Label>
                    <Select id="subject" value={form.subject} onChange={(e) => update("subject", e.target.value)}>
                      <option value="general">General inquiry</option>
                      <option value="billing">Billing question</option>
                      <option value="feedback">Feedback</option>
                      <option value="records">Medical records request</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="message">Message {errors.message && <span className="text-[var(--color-emergency)]">— required</span>}</Label>
                    <Textarea id="message" value={form.message} onChange={(e) => update("message", e.target.value)} error={errors.message} placeholder="How can we help?" />
                  </div>
                  <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                    {submitting ? "Sending..." : <>Send Message <Send className="h-4 w-4" /></>}
                  </Button>
                </form>
              </Card>
            </motion.div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
