import * as React from "react"
import type { DashboardContextValue } from "./DashboardContext"

export const DashboardContext = React.createContext<DashboardContextValue | undefined>(undefined)
