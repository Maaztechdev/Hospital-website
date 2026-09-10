import * as React from "react"
import { DashboardContext } from "./dashboard-context"

export function useDashboard() {
  const ctx = React.useContext(DashboardContext)
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}