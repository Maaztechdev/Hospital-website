import { prisma } from "@config/prisma";
import { checkCnicDuplicates } from "../../scripts/check-cnic-duplicates";

describe("Pre-deploy CNIC duplicate checker", () => {
  const testCnic = "35201-9999999-1";
  const normCnic = "3520199999991";
  const createdPatientIds: string[] = [];
  let adminUserId: string;

  beforeAll(async () => {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!admin) throw new Error("Admin user required for test");
    adminUserId = admin.id;
  });

  afterEach(async () => {
    if (createdPatientIds.length > 0) {
      await prisma.patient.deleteMany({ where: { id: { in: createdPatientIds } } });
      createdPatientIds.length = 0;
    }
  });

  it("detects seeded duplicate CNICs and reports MR numbers and counts", async () => {
    // Clean any prior conflict
    await prisma.patient.deleteMany({ where: { normalizedCnic: normCnic } });

    // Seed duplicate patient 1
    const p1 = await prisma.patient.create({
      data: {
        mrNumber: `MR-DUP1-${Date.now()}`,
        firstName: "Duplicate",
        lastName: "One",
        phone: "03001234567",
        gender: "MALE",
        age: 30,
        cnic: testCnic,
        normalizedCnic: null, // Simulate legacy unindexed record
        creator: { connect: { id: adminUserId } },
      },
    });
    createdPatientIds.push(p1.id);

    // Seed duplicate patient 2 with different formatting but same digits
    const p2 = await prisma.patient.create({
      data: {
        mrNumber: `MR-DUP2-${Date.now()}`,
        firstName: "Duplicate",
        lastName: "Two",
        phone: "03007654321",
        gender: "FEMALE",
        age: 28,
        cnic: "3520199999991", // No hyphens
        normalizedCnic: null,
        creator: { connect: { id: adminUserId } },
      },
    });
    createdPatientIds.push(p2.id);

    const report = await checkCnicDuplicates();
    expect(report.hasDuplicates).toBe(true);

    const matchingGroup = report.duplicates.find((d) => d.norm_cnic === normCnic);
    expect(matchingGroup).toBeDefined();
    expect(matchingGroup!.count).toBeGreaterThanOrEqual(2);
    expect(matchingGroup!.mrs).toContain(p1.mrNumber);
    expect(matchingGroup!.mrs).toContain(p2.mrNumber);
  });

  it("returns hasDuplicates = false when all CNICs are unique", async () => {
    // Ensure clean state
    await prisma.patient.deleteMany({ where: { normalizedCnic: normCnic } });

    const p = await prisma.patient.create({
      data: {
        mrNumber: `MR-UNIQ-${Date.now()}`,
        firstName: "Unique",
        lastName: "Patient",
        phone: "03005555555",
        gender: "MALE",
        age: 40,
        cnic: "35202-8888888-2",
        normalizedCnic: "3520288888882",
        creator: { connect: { id: adminUserId } },
      },
    });
    createdPatientIds.push(p.id);

    const report = await checkCnicDuplicates();
    const group = report.duplicates.find((d) => d.norm_cnic === "3520288888882");
    expect(group).toBeUndefined();
  });

  it("ignores soft-deleted patients when checking duplicates, matching partial unique index", async () => {
    const activePatient = await prisma.patient.create({
      data: {
        mrNumber: `MR-ACT-${Date.now()}`,
        firstName: "Active",
        lastName: "Patient",
        phone: "03001112233",
        gender: "MALE",
        age: 32,
        cnic: "35203-7777777-3",
        normalizedCnic: "3520377777773",
        creator: { connect: { id: adminUserId } },
      },
    });
    createdPatientIds.push(activePatient.id);

    const softDeletedPatient = await prisma.patient.create({
      data: {
        mrNumber: `MR-DEL-${Date.now()}`,
        firstName: "Deleted",
        lastName: "Patient",
        phone: "03004445566",
        gender: "FEMALE",
        age: 33,
        cnic: "35203-7777777-3",
        normalizedCnic: "3520377777773",
        deletedAt: new Date(),
        creator: { connect: { id: adminUserId } },
      },
    });
    createdPatientIds.push(softDeletedPatient.id);

    const report = await checkCnicDuplicates();
    const group = report.duplicates.find((d) => d.norm_cnic === "3520377777773");
    expect(group).toBeUndefined();
  });
});
