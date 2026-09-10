import type { ReactNode } from "react"
import { Navbar } from "./Navbar"
import { Footer } from "./Footer"
import { WhatsAppButton } from "./WhatsAppButton"
import { Toaster } from "@/components/shared/Toaster"
import { ScrollToTop } from "./ScrollToTop"

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppButton />
      <Toaster />
    </div>
  )
}
