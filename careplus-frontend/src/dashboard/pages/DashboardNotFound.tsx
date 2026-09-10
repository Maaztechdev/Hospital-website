import { Link } from "react-router-dom"
import { Compass } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--cp-primary-light)] text-[var(--cp-primary)]">
        <Compass className="h-6 w-6" />
      </span>
      <h2 className="mb-1.5 text-lg font-bold text-[var(--cp-ink)]">Page not found</h2>
      <p className="mb-5 max-w-sm text-sm text-[var(--cp-ink-soft)]">This dashboard page doesn't exist or may have moved.</p>
      <Link to="/dashboard/login"><Button variant="outline" size="sm">Back to login</Button></Link>
    </div>
  )
}
