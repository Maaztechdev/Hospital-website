import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../../src/app";
import { prisma } from "@config/prisma";
import { redis } from "@config/redis";

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
  let createdTestId: string | null = null;
  let createdWardId: string | null = null;

  beforeAll(async () => {
    const passwordHash = await argon2.hash("ModuleContract@12345");
    await prisma.user.create({ data: { name: "Module contract admin", email: "module-contract-admin@test.local", passwordHash, role: "ADMIN" } });
    token = await login();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: "module-contract-admin@test.local" } });
    redis.disconnect();
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

  it("creates, updates, and deletes a lab test catalog entry", async () => {
    const createResponse = await request(app)
      .post(`${api}/lab/tests`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        testName: "Regression Blood Panel",
        testCode: `REG-${Date.now()}`,
        category: "Hematology",
        sampleType: "Whole Blood",
        price: 1500,
        unit: "mg/dL",
        referenceRangeMin: 70,
        referenceRangeMax: 100,
        turnaroundTimeHours: 6,
        isActive: true,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.data.testName).toBe("Regression Blood Panel");
    createdTestId = createResponse.body.data.id;

    const updateResponse = await request(app)
      .patch(`${api}/lab/tests/${createdTestId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        testName: "Regression Blood Panel Updated",
        testCode: createResponse.body.data.testCode,
        category: "Hematology",
        sampleType: "Serum",
        price: 1700,
        unit: "mg/dL",
        referenceRangeMin: 75,
        referenceRangeMax: 95,
        turnaroundTimeHours: 12,
        isActive: false,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.success).toBe(true);
    expect(updateResponse.body.data.testName).toBe("Regression Blood Panel Updated");
    expect(updateResponse.body.data.isActive).toBe(false);

    const deleteResponse = await request(app)
      .delete(`${api}/lab/tests/${createdTestId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);
  });

  it("persists catalog parameters, pathologist ranges, package membership, and soft deactivation", async () => {
    const headers = { Authorization: "Bearer " + token }
    const testCode = `CAT-${Date.now()}`;
    const createResponse = await request(app)
      .post(`${api}/lab/tests`)
      .set(headers)
      .send({
        testName: "Catalog Regression Test",
        testCode,
        category: "Biochemistry",
        sampleType: "Serum",
        price: 650,
        turnaroundTimeHours: 5,
        parameters: [{
          name: "Regression Analyte",
          unit: "mg/dL",
          displayOrder: 0,
          resultType: "NUMERIC",
          decimalPlaces: 2,
          ranges: [{ gender: "ANY", ageMinDays: 0, ageMaxDays: 36500, low: 2, high: 8, criticalLow: 1, criticalHigh: 12, notes: "Pathologist review required" }],
        }],
      });
    expect(createResponse.status).toBe(201);
    const testId = createResponse.body.data.id as string;
    const parameter = createResponse.body.data.parameters[0];
    expect(parameter).toMatchObject({ name: "Regression Analyte", unit: "mg/dL", resultType: "NUMERIC" });
    expect(parameter.ranges[0].gender).toBe("ANY");
    expect(Number(parameter.ranges[0].low)).toBe(2);
    expect(Number(parameter.ranges[0].high)).toBe(8);

    const invalidRangeResponse = await request(app)
      .post(`${api}/lab/tests`)
      .set(headers)
      .send({
        testName: "Invalid Range Regression",
        testCode: `BAD-${Date.now()}`,
        price: 0,
        parameters: [{
          name: "Invalid",
          displayOrder: 0,
          resultType: "NUMERIC",
          decimalPlaces: 0,
          ranges: [{ gender: "ANY", ageMinDays: 20, ageMaxDays: 10 }],
        }],
      });
    expect(invalidRangeResponse.status).toBe(400);

    const packageResponse = await request(app)
      .post(`${api}/lab/packages`)
      .set(headers)
      .send({ name: `Regression Package ${Date.now()}`, price: 600, testIds: [testId] });
    expect(packageResponse.status).toBe(201);
    expect(packageResponse.body.data.tests.map((item: { testId: string }) => item.testId)).toEqual([testId]);

    const deactivateResponse = await request(app).delete(`${api}/lab/tests/${testId}`).set(headers);
    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.data.isActive).toBe(false);
    const catalogResponse = await request(app).get(`${api}/lab/tests?includeInactive=true`).set(headers);
    expect(catalogResponse.body.data.find((item: { id: string }) => item.id === testId).parameters[0].id).toBe(parameter.id);
    const packageDeactivateResponse = await request(app).delete(`/api/v1/lab/packages/${packageResponse.body.data.id}`).set(headers);
    expect(packageDeactivateResponse.status).toBe(200);
    expect(packageDeactivateResponse.body.data.isActive).toBe(false);
  });

  it("propagates an updated ward rate to new beds used for admissions and billing", async () => {
    const wardResponse = await request(app)
      .post(`${api}/wards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ wardName: `Regression Ward ${Date.now()}`, wardType: "GENERAL", dailyRate: 2500, capacity: 2, amenities: ["AC"], isActive: true });
    expect(wardResponse.status).toBe(201);
    createdWardId = wardResponse.body.data.id;

    const roomResponse = await request(app).post(`${api}/wards/rooms`).set("Authorization", `Bearer ${token}`).send({ wardId: createdWardId, roomNumber: `REG-${Date.now()}` });
    expect(roomResponse.status).toBe(201);
    const bedResponse = await request(app).post(`${api}/wards/beds`).set("Authorization", `Bearer ${token}`).send({ roomId: roomResponse.body.data.id, bedNumber: "REG-01" });
    expect(bedResponse.status).toBe(201);
    expect(Number(bedResponse.body.data.dailyRate)).toBe(2500);

    const updateResponse = await request(app).patch(`${api}/wards/${createdWardId}`).set("Authorization", `Bearer ${token}`).send({ wardName: wardResponse.body.data.wardName, wardType: "GENERAL", dailyRate: 3100, capacity: 2, amenities: ["AC", "TV"], isActive: true });
    expect(updateResponse.status).toBe(200);
    const availability = await request(app).get(`${api}/wards/beds/availability`).set("Authorization", `Bearer ${token}`);
    const updatedBed = availability.body.data.find((bed: { id: string }) => bed.id === bedResponse.body.data.id);
    expect(Number(updatedBed.dailyRate)).toBe(3100);
  });

  it("bulk-adds five beds and exposes them in Ward Board availability", async () => {
    const wardResponse = await request(app)
      .post(`${api}/wards`)
      .set("Authorization", `Bearer ${token}`)
      .send({ wardName: `Bulk Ward ${Date.now()}`, wardType: "GENERAL", dailyRate: 2800, capacity: 5, amenities: [], isActive: true });
    expect(wardResponse.status).toBe(201);
    createdWardId = wardResponse.body.data.id;

    const batchResponse = await request(app)
      .post(`${api}/wards/rooms-beds/batch`)
      .set("Authorization", `Bearer ${token}`)
      .send({ roomUpdates: [], bedUpdates: [], deleteBedIds: [], addBeds: [{ wardId: createdWardId, roomNumber: "BULK-101", bedNumbers: ["A", "B", "C", "D", "E"] }] });
    expect(batchResponse.status).toBe(200);
    expect(batchResponse.body.success).toBe(true);

    const availabilityResponse = await request(app).get(`${api}/wards/beds/availability`).set("Authorization", `Bearer ${token}`);
    const beds = availabilityResponse.body.data.filter((bed: { room: { ward: { id: string } } }) => bed.room.ward.id === createdWardId);
    expect(beds.map((bed: { bedNumber: string }) => bed.bedNumber).sort()).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("creates, updates, persists, and removes an OT room", async () => {
    const name = `Regression OT ${Date.now()}`;
    const createResponse = await request(app).post(`${api}/ot/rooms`).set("Authorization", `Bearer ${token}`).send({ name, isActive: true });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.name).toBe(name);
    const roomId = createResponse.body.data.id;

    const updateResponse = await request(app).patch(`${api}/ot/rooms/${roomId}`).set("Authorization", `Bearer ${token}`).send({ name: `${name} Updated`, isActive: false });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.name).toBe(`${name} Updated`);
    expect(updateResponse.body.data.isActive).toBe(false);

    const persistedResponse = await request(app).get(`${api}/ot/rooms?includeInactive=true`).set("Authorization", `Bearer ${token}`);
    expect(persistedResponse.body.data.find((room: { id: string }) => room.id === roomId)).toMatchObject({ name: `${name} Updated`, isActive: false });

    const deleteResponse = await request(app).delete(`${api}/ot/rooms/${roomId}`).set("Authorization", `Bearer ${token}`);
    expect(deleteResponse.status).toBe(200);
  });

  it("persists medicine category, invoice settings, and role permission changes", async () => {
    const categoryName = `Regression Category ${Date.now()}`;
    const categoryResponse = await request(app).post(`${api}/settings/medicine-categories`).set("Authorization", `Bearer ${token}`).send({ name: categoryName, description: "Regression category", isActive: true });
    expect(categoryResponse.status).toBe(201);
    const categoryId = categoryResponse.body.data.id;
    const categoryUpdate = await request(app).patch(`${api}/settings/medicine-categories/${categoryId}`).set("Authorization", `Bearer ${token}`).send({ name: `${categoryName} Updated`, description: "Updated description", isActive: true });
    expect(categoryUpdate.status).toBe(200);
    expect(categoryUpdate.body.data).toMatchObject({ description: "Updated description", isActive: true });

    const pharmacyCategories = await request(app).get(`${api}/pharmacy/categories`).set("Authorization", `Bearer ${token}`);
    expect(pharmacyCategories.status).toBe(200);
    expect(pharmacyCategories.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: categoryId, name: `${categoryName} Updated` })]));
    const medicineResponse = await request(app).post(`${api}/pharmacy/medicines`).set("Authorization", `Bearer ${token}`).send({ name: `Category-linked medicine ${Date.now()}`, categoryId });
    expect(medicineResponse.status).toBe(201);
    expect(medicineResponse.body.data.categoryId).toBe(categoryId);

    const invoiceSetting = await request(app).put(`${api}/settings/invoice_invoicePrefix`).set("Authorization", `Bearer ${token}`).send({ value: "TEST" });
    expect(invoiceSetting.status).toBe(200);
    const invoiceSettingReload = await request(app).get(`${api}/settings/invoice_invoicePrefix`).set("Authorization", `Bearer ${token}`);
    expect(invoiceSettingReload.body.data.value).toBe("TEST");

    const permission = await request(app).put(`${api}/settings/role-permissions`).set("Authorization", `Bearer ${token}`).send({ role: "ADMIN", module: "billing", allowedActions: ["view", "create", "edit", "delete", "export"] });
    expect(permission.status).toBe(200);
    const permissionReload = await request(app).get(`${api}/settings/role-permissions`).set("Authorization", `Bearer ${token}`);
    expect(permissionReload.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ role: "ADMIN", module: "billing", allowedActions: expect.arrayContaining(["export"]) })]));

    const categoryDelete = await request(app).delete(`${api}/settings/medicine-categories/${categoryId}`).set("Authorization", `Bearer ${token}`);
    expect(categoryDelete.status).toBe(409);
  });
});
