import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";

const app = createApp();
const api = "/api/v1";
const admin = { email: "module-contract-admin@test.local", password: "ModuleContract@12345" };

async function login() {
  const response = await request(app).post(`${api}/auth/login`).send(admin);
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

describe("Integration: newly wired clinical modules", () => {
  let token: string;

  beforeAll(async () => {
    const passwordHash = await argon2.hash("ModuleContract@12345");
    await prisma.user.create({ data: { name: "Module contract admin", email: "module-contract-admin@test.local", passwordHash, role: "ADMIN" } });
    token = await login();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: "module-contract-admin@test.local" } });
  });

  it.each([
    ["pharmacy medicine catalog", "/pharmacy/medicines"],
    ["lab test catalog", "/lab/tests"],
    ["lab orders", "/lab/orders"],
    ["billing invoices", "/billing/invoices"],
    ["wards", "/wards/"],
    ["bed availability", "/wards/beds/availability"],
    ["nursing assignments", "/nursing/assignments"],
    ["prescriptions", "/prescriptions"],
  ])("lists %s through the API", async (_name, path) => {
    const response = await request(app).get(`${api}${path}`).set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
  });
});
