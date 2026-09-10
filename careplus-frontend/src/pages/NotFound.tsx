import { Link } from "react-router-dom"
import { HeartCrack } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <HeartCrack className="mb-5 h-12 w-12 text-[var(--color-accent)]" />
      <h1 className="mb-2 font-[var(--font-display)] text-3xl font-bold text-[var(--color-ink)]">Page not found</h1>
      <p className="mb-8 text-[var(--color-ink-soft)]">
        The page you're looking for doesn't exist or may have moved. Let's get you back on track.
      </p>
      <Link to="/">
        <Button variant="primary">Return home</Button>
      </Link>
    </div>
  )
}
