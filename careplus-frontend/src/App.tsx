import { Routes, Route } from "react-router-dom"
import { Layout } from "@/components/layout/Layout"
import { ToastProvider } from "@/hooks/use-toast"
import Home from "@/pages/Home"
import About from "@/pages/About"
import Departments from "@/pages/Departments"
import Doctors from "@/pages/Doctors"
import Services from "@/pages/Services"
import Appointment from "@/pages/Appointment"
import Blog from "@/pages/Blog"
import BlogDetail from "@/pages/BlogDetail"
import Contact from "@/pages/Contact"
import NotFound from "@/pages/NotFound"
import DashboardApp from "@/dashboard/DashboardApp"
import { ErrorBoundary } from "@/components/shared/ErrorBoundary"
import { HospitalProfileProvider } from "@/lib/hospitalProfile"
import PrintDocuments from "@/print/PrintDocuments"
import LabReportVerification from "@/pages/LabReportVerification"

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
      <HospitalProfileProvider>
      <Routes>
        <Route path="/print/*" element={<PrintDocuments />} />
        <Route path="/lab-report-verification/:orderNumber" element={<LabReportVerification />} />
        {/* Phase 2: Admin & Staff Management System — separate shell, no public nav/footer */}
        <Route path="/dashboard/*" element={<DashboardApp />} />

        {/* Phase 1: existing public website, unchanged */}
        <Route
          path="*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about" element={<About />} />
                <Route path="/departments" element={<Departments />} />
                <Route path="/doctors" element={<Doctors />} />
                <Route path="/services" element={<Services />} />
                <Route path="/appointment" element={<Appointment />} />
                <Route path="/blog" element={<Blog />} />
                <Route path="/blog/:id" element={<BlogDetail />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
      </HospitalProfileProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
