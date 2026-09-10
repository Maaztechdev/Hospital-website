import * as React from "react"
import { UserPlus, Users, UserX } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { DataTable } from "@/dashboard/components/DataTable"
import { FilterBar } from "@/dashboard/components/Primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Modal } from "@/dashboard/components/Primitives"
import { api, type ApiError, type ApiUser } from "@/lib/api"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { useToast } from "@/hooks/use-toast"

const ROLES = ["ADMIN", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN", "PHARMACIST", "NURSE"] as const
type Department = { id: string; name: string }

export default function UsersPage() {
  const { currentUser } = useDashboard()
  const { toast } = useToast()
  const [users, setUsers] = React.useState<ApiUser[]>([])
  const [departments, setDepartments] = React.useState<Department[]>([])
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [editing, setEditing] = React.useState<ApiUser | null>(null)
  const [form, setForm] = React.useState({ name: "", email: "", password: "", phone: "", role: "RECEPTIONIST", departmentId: "" })

  async function load() {
    setLoading(true)
    try {
      const [nextUsers, nextDepartments] = await Promise.all([api.listUsers(search), api.listDepartments("ACTIVE")])
      setUsers(nextUsers)
      setDepartments(nextDepartments.map((department) => ({ id: department.id, name: department.name })))
      setError(null)
    } catch (requestError) {
      setError((requestError as ApiError).message || "Unable to load users")
    } finally { setLoading(false) }
  }

  React.useEffect(() => { void load() }, [search])

  function openCreate() {
    setEditing(null)
    setForm({ name: "", email: "", password: "", phone: "", role: "RECEPTIONIST", departmentId: "" })
    setOpen(true)
  }

  function openEdit(user: ApiUser) {
    setEditing(user)
    setForm({ name: user.name, email: user.email, password: "", phone: user.phone ?? "", role: user.role, departmentId: user.departmentId ?? "" })
    setOpen(true)
  }

  async function save() {
    setSaving(true)
    try {
      if (editing) {
        await api.updateUser(editing.id, { name: form.name, phone: form.phone || undefined, role: form.role, departmentId: form.departmentId || null })
        toast({ title: "User updated", variant: "success" })
      } else {
        await api.createUser({ name: form.name, email: form.email, password: form.password, phone: form.phone || undefined, role: form.role, departmentId: form.departmentId || undefined })
        toast({ title: "User created", variant: "success" })
      }
      setOpen(false)
      await load()
    } catch (requestError) {
      toast({ title: "User save failed", description: (requestError as ApiError).message, variant: "error" })
    } finally { setSaving(false) }
  }

  async function deactivate(user: ApiUser) {
    if (user.id === currentUser?.id) return
    try {
      await api.deactivateUser(user.id)
      toast({ title: "User deactivated", variant: "success" })
      await load()
    } catch (requestError) {
      toast({ title: "Deactivation failed", description: (requestError as ApiError).message, variant: "error" })
    }
  }

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Users" action={<Button size="sm" onClick={openCreate}><UserPlus className="h-4 w-4" /> Add User</Button>} />
    <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search users by name or email…" />
    {error && <p role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] px-4 py-3 text-sm text-[var(--cp-critical)]">{error}</p>}
    <DataTable rows={users} loading={loading} getRowKey={(user) => user.id} emptyIcon={Users} emptyTitle="No users found" columns={[
      { key: "name", header: "Name", render: (user) => <button className="font-semibold text-[var(--cp-primary)]" onClick={() => openEdit(user)}>{user.name}</button>, sortValue: (user) => user.name },
      { key: "email", header: "Email", render: (user) => user.email },
      { key: "role", header: "Role", render: (user) => user.role },
      { key: "status", header: "Status", render: (user) => user.isActive ? "Active" : "Inactive" },
      { key: "actions", header: "Actions", render: (user) => <Button variant="ghost" size="sm" disabled={!user.isActive || user.id === currentUser?.id} onClick={() => void deactivate(user)}><UserX className="h-4 w-4" /> Deactivate</Button> },
    ]} />
    <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit User" : "Create User"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="user-name">Name</Label><Input id="user-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        {!editing && <div><Label htmlFor="user-email">Email</Label><Input id="user-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>}
        {!editing && <div><Label htmlFor="user-password">Password</Label><Input id="user-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></div>}
        <div><Label htmlFor="user-phone">Phone</Label><Input id="user-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
        <div><Label htmlFor="user-role">Role</Label><Select id="user-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{ROLES.map((role) => <option key={role}>{role}</option>)}</Select></div>
        <div><Label htmlFor="user-department">Department</Label><Select id="user-department" value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}><option value="">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</Select></div>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save User"}</Button></div>
    </Modal>
  </div>
}