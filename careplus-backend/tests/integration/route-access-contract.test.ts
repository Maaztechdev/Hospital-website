import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

const app = createApp();
const uuid = "00000000-0000-4000-8000-000000000001";
const api = "/api/v1";

type Role = "ADMIN" | "BILLING_MANAGER" | "RECEPTIONIST" | "DOCTOR" | "NURSE" | "PHARMACIST" | "LAB_TECHNICIAN";
type Method = "get" | "post" | "patch" | "put" | "delete";
type RouteContract = { method: Method; path: string; roles?: Role[] };

const credentials: Record<Role, { email: string; password: string }> = {
  ADMIN: { email: "admin@careplus.local", password: "Admin@12345" },
  BILLING_MANAGER: { email: "billing-manager@careplus.local", password: "Billing@12345" },
  RECEPTIONIST: { email: "reception@careplus.local", password: "Staff@12345" },
  DOCTOR: { email: "dr.ahmed@careplus.local", password: "Doctor@12345" },
  NURSE: { email: "nurse@careplus.local", password: "Staff@12345" },
  PHARMACIST: { email: "pharmacist@careplus.local", password: "Staff@12345" },
  LAB_TECHNICIAN: { email: "labtech@careplus.local", password: "Staff@12345" },
};

const contracts: RouteContract[] = [
  { method: "get", path: "/users", roles: ["ADMIN"] }, { method: "get", path: "/users/:id", roles: ["ADMIN"] },
  { method: "post", path: "/users", roles: ["ADMIN"] }, { method: "patch", path: "/users/:id", roles: ["ADMIN"] }, { method: "post", path: "/users/:id/deactivate", roles: ["ADMIN"] },
  { method: "get", path: "/patients", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "PHARMACIST", "LAB_TECHNICIAN"] }, { method: "get", path: "/patients/:id", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "PHARMACIST", "LAB_TECHNICIAN"] }, { method: "get", path: "/patients/:id/print-summary", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "PHARMACIST", "LAB_TECHNICIAN"] },
  { method: "post", path: "/patients", roles: ["ADMIN", "RECEPTIONIST"] }, { method: "patch", path: "/patients/:id", roles: ["ADMIN", "RECEPTIONIST"] }, { method: "delete", path: "/patients/:id", roles: ["ADMIN"] }, { method: "post", path: "/patients/merge", roles: ["ADMIN"] },
  { method: "get", path: "/appointments/doctors", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "LAB_TECHNICIAN", "PHARMACIST", "NURSE"] }, { method: "get", path: "/appointments/doctors/:id/slots", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "get", path: "/appointments", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  { method: "get", path: "/appointments/:id", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "post", path: "/appointments", roles: ["ADMIN", "RECEPTIONIST"] }, { method: "post", path: "/appointments/:id/approve", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  { method: "post", path: "/appointments/:id/reject", roles: ["ADMIN", "RECEPTIONIST"] }, { method: "post", path: "/appointments/:id/reschedule", roles: ["ADMIN", "RECEPTIONIST"] }, { method: "post", path: "/appointments/:id/cancel", roles: ["ADMIN", "RECEPTIONIST"] }, { method: "post", path: "/appointments/:id/mark-done", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/appointments/:id/mark-no-show", roles: ["ADMIN", "RECEPTIONIST"] },
  { method: "get", path: "/opd-queue", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "post", path: "/opd-queue/:id/call-next", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "post", path: "/opd-queue/:id/start-consultation", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/opd-queue/:id/requeue", roles: ["ADMIN", "RECEPTIONIST", "NURSE"] },
  { method: "get", path: "/consultations", roles: ["ADMIN", "DOCTOR", "NURSE"] }, { method: "get", path: "/consultations/:id", roles: ["ADMIN", "DOCTOR", "NURSE"] }, { method: "post", path: "/consultations", roles: ["ADMIN", "DOCTOR"] }, { method: "patch", path: "/consultations/:id", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/consultations/:id/sign", roles: ["ADMIN", "DOCTOR"] },
  { method: "get", path: "/prescriptions", roles: ["ADMIN", "DOCTOR", "PHARMACIST", "NURSE"] }, { method: "get", path: "/prescriptions/:id", roles: ["ADMIN", "DOCTOR", "PHARMACIST", "NURSE"] }, { method: "get", path: "/prescriptions/consultations/:consultationId/print", roles: ["ADMIN", "DOCTOR", "PHARMACIST"] }, { method: "post", path: "/prescriptions", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/prescriptions/:id/sign", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/prescriptions/:id/void", roles: ["ADMIN", "DOCTOR"] }, { method: "get", path: "/prescriptions/:id/print", roles: ["ADMIN", "DOCTOR", "PHARMACIST"] },
  { method: "get", path: "/lab/tests", roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"] }, { method: "post", path: "/lab/tests", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "patch", path: "/lab/tests/:id", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "delete", path: "/lab/tests/:id", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "get", path: "/lab/packages", roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"] }, { method: "post", path: "/lab/packages", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "patch", path: "/lab/packages/:id", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "delete", path: "/lab/packages/:id", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "get", path: "/lab/orders", roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"] }, { method: "get", path: "/lab/orders/:id", roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "LAB_TECHNICIAN", "NURSE"] }, { method: "post", path: "/lab/orders", roles: ["ADMIN", "DOCTOR", "RECEPTIONIST"] },
  { method: "patch", path: "/lab/orders/:id/sample-status", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "post", path: "/lab/orders/:id/results", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "post", path: "/lab/orders/:id/results/amend", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "post", path: "/lab/orders/:id/verify", roles: ["ADMIN", "LAB_TECHNICIAN"] }, { method: "post", path: "/lab/orders/:id/attachments", roles: ["ADMIN", "LAB_TECHNICIAN"] },
  { method: "get", path: "/lab/ledger/accounts", roles: ["ADMIN", "BILLING_MANAGER"] },
  { method: "post", path: "/lab/ledger/accounts", roles: ["ADMIN", "BILLING_MANAGER"] },
  { method: "get", path: "/lab/ledger/accounts/:accountId", roles: ["ADMIN", "BILLING_MANAGER"] },
  { method: "post", path: "/lab/ledger/accounts/:accountId/payments", roles: ["ADMIN", "BILLING_MANAGER"] },
  { method: "get", path: "/lab/ledger/referring-clinics", roles: ["ADMIN", "BILLING_MANAGER", "DOCTOR", "RECEPTIONIST"] },
  { method: "get", path: "/lab/ledger/reference-labs", roles: ["ADMIN", "BILLING_MANAGER", "LAB_TECHNICIAN"] },
  { method: "get", path: "/pharmacy/settings", roles: ["ADMIN", "PHARMACIST"] }, { method: "put", path: "/pharmacy/settings", roles: ["ADMIN"] }, { method: "put", path: "/pharmacy/settings/admin-pin", roles: ["ADMIN"] }, { method: "post", path: "/pharmacy/settings/logo", roles: ["ADMIN"] },
  { method: "get", path: "/pharmacy/medicines", roles: ["ADMIN", "PHARMACIST", "DOCTOR"] }, { method: "post", path: "/pharmacy/medicines", roles: ["ADMIN", "PHARMACIST"] }, { method: "patch", path: "/pharmacy/medicines/:id", roles: ["ADMIN", "PHARMACIST"] }, { method: "delete", path: "/pharmacy/medicines/:id", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/batches", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/stock-in", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/dispense", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/discount-audits", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/invoices", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/invoices/:invoiceId", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/invoices/:invoiceId/void", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/invoices/:invoiceId/returns", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/sale-adjustments", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/return", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/adjust", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/write-off", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/stock-movements", roles: ["ADMIN", "PHARMACIST"] },
  { method: "get", path: "/pharmacy/overview", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/reports", roles: ["ADMIN", "PHARMACIST"] },
  { method: "get", path: "/pharmacy/khata/accounts", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/khata/accounts", roles: ["ADMIN", "PHARMACIST"] }, { method: "get", path: "/pharmacy/khata/accounts/:accountId", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/khata/accounts/:accountId/payments", roles: ["ADMIN", "PHARMACIST"] }, { method: "post", path: "/pharmacy/khata/accounts/:accountId/adjustments", roles: ["ADMIN", "PHARMACIST"] },
  { method: "get", path: "/billing/invoices", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"] }, { method: "get", path: "/billing/invoices/:id", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"] }, { method: "post", path: "/billing/invoices", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"] }, { method: "post", path: "/billing/invoices/:id/payments", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"] }, { method: "post", path: "/billing/invoices/:id/void", roles: ["ADMIN", "BILLING_MANAGER"] },
  { method: "get", path: "/wards/", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "post", path: "/wards/", roles: ["ADMIN"] }, { method: "post", path: "/wards/rooms", roles: ["ADMIN"] }, { method: "post", path: "/wards/beds", roles: ["ADMIN"] }, { method: "get", path: "/wards/beds/availability", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "patch", path: "/wards/beds/:id/status", roles: ["ADMIN", "NURSE"] }, { method: "get", path: "/wards/admissions", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "get", path: "/wards/admissions/:id/print", roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "get", path: "/wards/admissions/:id", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "post", path: "/wards/admissions", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST", "DOCTOR", "NURSE"] }, { method: "post", path: "/wards/admissions/:id/deposits", roles: ["ADMIN", "BILLING_MANAGER", "RECEPTIONIST"] }, { method: "post", path: "/wards/admissions/:id/transfer", roles: ["ADMIN", "NURSE", "DOCTOR"] }, { method: "post", path: "/wards/admissions/:id/discharge", roles: ["ADMIN", "DOCTOR"] },
  { method: "post", path: "/nursing/assignments", roles: ["ADMIN"] }, { method: "get", path: "/nursing/assignments" }, { method: "post", path: "/nursing/vitals", roles: ["ADMIN", "NURSE", "DOCTOR"] }, { method: "get", path: "/nursing/vitals/:id", roles: ["ADMIN", "NURSE", "DOCTOR"] }, { method: "post", path: "/nursing/tasks", roles: ["ADMIN", "NURSE", "DOCTOR"] }, { method: "post", path: "/nursing/tasks/:id/complete", roles: ["ADMIN", "NURSE"] }, { method: "get", path: "/nursing/tasks/:id", roles: ["ADMIN", "NURSE", "DOCTOR"] },
  { method: "get", path: "/ot/rooms" }, { method: "get", path: "/ot/surgeries", roles: ["ADMIN", "DOCTOR", "NURSE"] }, { method: "get", path: "/ot/surgeries/:id", roles: ["ADMIN", "DOCTOR", "NURSE"] }, { method: "post", path: "/ot/surgeries", roles: ["ADMIN", "DOCTOR"] }, { method: "patch", path: "/ot/surgeries/:id/checklist", roles: ["ADMIN", "DOCTOR", "NURSE"] }, { method: "post", path: "/ot/surgeries/:id/start", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/ot/surgeries/:id/recovery", roles: ["ADMIN", "DOCTOR", "NURSE"] }, { method: "post", path: "/ot/surgeries/:id/complete", roles: ["ADMIN", "DOCTOR"] }, { method: "post", path: "/ot/surgeries/:id/cancel", roles: ["ADMIN", "DOCTOR"] },
  { method: "get", path: "/notifications" }, { method: "get", path: "/notifications/unread-count" }, { method: "post", path: "/notifications/:id/read" }, { method: "post", path: "/notifications/mark-all-read" },
  { method: "get", path: "/reports/revenue-summary", roles: ["ADMIN"] }, { method: "get", path: "/reports/appointment-stats", roles: ["ADMIN"] }, { method: "get", path: "/reports/bed-occupancy", roles: ["ADMIN"] }, { method: "get", path: "/reports/surgery-stats", roles: ["ADMIN"] }, { method: "get", path: "/reports/low-stock-medicines", roles: ["ADMIN"] }, { method: "get", path: "/reports/near-expiry-medicines", roles: ["ADMIN"] }, { method: "get", path: "/reports/lab-turnaround", roles: ["ADMIN"] }, { method: "get", path: "/reports/doctor-productivity", roles: ["ADMIN"] },
  { method: "get", path: "/settings" }, { method: "get", path: "/settings/:id" }, { method: "put", path: "/settings/:id", roles: ["ADMIN"] }, { method: "get", path: "/audit-logs", roles: ["ADMIN"] },
  { method: "get", path: "/admin/backup", roles: ["ADMIN"] }, { method: "post", path: "/admin/backup", roles: ["ADMIN"] }, { method: "get", path: "/admin/backup/:id/download", roles: ["ADMIN"] }, { method: "delete", path: "/admin/backup/:id", roles: ["ADMIN"] }, { method: "post", path: "/admin/backup/:id/restore", roles: ["ADMIN"] },
];

function materialize(path: string) { return `${api}${path.replaceAll(":id", uuid).replaceAll(":doctorId", uuid)}`; }
function send(method: Method, path: string, token?: string) {
  const req = request(app)[method](path);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

const tokens = new Map<Role, string>();
const fixtureSuffix = Date.now().toString();
async function tokenFor(role: Role) {
  const existing = tokens.get(role);
  if (existing) return existing;
  const response = await request(app).post(`${api}/auth/login`).send(credentials[role]);
  expect(response.status).toBe(200);
  const token = response.body.data.accessToken as string;
  tokens.set(role, token);
  return token;
}

describe("Integration: complete protected route access contract", () => {
  beforeAll(async () => {
    const passwordHash = await argon2.hash("RouteContract@12345");
    await Promise.all((Object.entries(credentials) as [Role, { email: string; password: string }][]).map(([role, value]) => {
      value.email = `${role.toLowerCase()}-${fixtureSuffix}@route-contract.test`;
      value.password = "RouteContract@12345";
      return prisma.user.create({ data: { name: `Route contract ${role}`, email: value.email, passwordHash, role } });
    }));
    await Promise.all((Object.keys(credentials) as Role[]).map(tokenFor));
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@route-contract.test" } } });
    redis.disconnect();
  });

  it.each(contracts)("$method $path is protected by its declared access policy", async (contract) => {
    if (!contract.roles) {
      const response = await send(contract.method, materialize(contract.path));
      expect(response.status).toBe(401);
      return;
    }

    const deniedRole = (Object.keys(credentials) as Role[]).find((role) => !contract.roles?.includes(role));
    if (!deniedRole) {
      const response = await send(contract.method, materialize(contract.path), await tokenFor("ADMIN"));
      expect(response.status).not.toBe(401);
      return;
    }
    const response = await send(contract.method, materialize(contract.path), await tokenFor(deniedRole!));
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it("allows receptionists to read the OPD queue", async () => {
    const response = await request(app)
      .get(`${api}/opd-queue`)
      .set("Authorization", `Bearer ${await tokenFor("RECEPTIONIST")}`);

    expect(response.status).toBe(200);
  });

  it("keeps nurse assignment creation admin-only", async () => {
    const response = await request(app)
      .post(`${api}/nursing/assignments`)
      .set("Authorization", `Bearer ${await tokenFor("NURSE")}`)
      .send({ nurseUserId: uuid, wardId: uuid, shiftDate: "2026-09-16", shiftType: "MORNING" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});
