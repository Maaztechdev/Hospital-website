import { describe, it, expect, beforeAll } from "@jest/globals";
import { prisma } from "@config/prisma";
import { patientsService } from "@modules/patients/patients.service";

describe("Patient CNIC Normalization, Partial Unique Index & Concurrency", () => {
  let adminUser: any;

  beforeAll(async () => {
    adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true } });
  });

  it("1. Correctly normalizes CNIC by removing hyphens and whitespace", async () => {
    const rawCnic = "35201-1234567-9";
    const patient = await patientsService.create(
      adminUser.id,
      {
        firstName: "CNIC",
        lastName: "Normalizer",
        gender: "MALE",
        phone: "03009998877",
        cnic: rawCnic,
        age: 30,
      }
    );

    expect(patient.cnic).toBe("35201-1234567-9");
    const dbRecord = await prisma.patient.findUnique({ where: { id: patient.id } });
    expect(dbRecord?.normalizedCnic).toBe("3520112345679");

    // Clean up
    await prisma.patient.delete({ where: { id: patient.id } });
  });

  it("2. Allows multiple patients with NULL cnic (partial unique index ignores null)", async () => {
    const p1 = await patientsService.create(
      adminUser.id,
      {
        firstName: "Null",
        lastName: "CNIC1",
        gender: "FEMALE",
        phone: "03001112233",
        age: 25,
      }
    );

    const p2 = await patientsService.create(
      adminUser.id,
      {
        firstName: "Null",
        lastName: "CNIC2",
        gender: "MALE",
        phone: "03002223344",
        age: 28,
      }
    );

    expect(p1.id).toBeDefined();
    expect(p2.id).toBeDefined();

    // Clean up
    await prisma.patient.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
  });

  it("3. Rejects duplicate CNIC with 409 Conflict even if formatted differently", async () => {
    const p1 = await patientsService.create(
      adminUser.id,
      {
        firstName: "First",
        lastName: "Patient",
        gender: "MALE",
        phone: "03005556677",
        cnic: "42101-9876543-1",
        age: 40,
      }
    );

    // Attempt registration with same numbers but different formatting or no hyphens
    await expect(
      patientsService.create(
        adminUser.id,
        {
          firstName: "Second",
          lastName: "Patient",
          gender: "FEMALE",
          phone: "03006667788",
          cnic: "4210198765431",
          age: 35,
        }
      )
    ).rejects.toThrow(/already registered/i);

    // Clean up
    await prisma.patient.delete({ where: { id: p1.id } });
  });

  it("4. Concurrent registration race: two simultaneous requests with same CNIC", async () => {
    const raceCnic = "61101-7778889-3";

    const results = await Promise.allSettled([
      patientsService.create(
        adminUser.id,
        {
          firstName: "Racer",
          lastName: "One",
          gender: "MALE",
          phone: "03004441122",
          cnic: raceCnic,
          age: 29,
        }
      ),
      patientsService.create(
        adminUser.id,
        {
          firstName: "Racer",
          lastName: "Two",
          gender: "FEMALE",
          phone: "03004442233",
          cnic: raceCnic,
          age: 31,
        }
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one should succeed, and exactly one should fail with 409 Conflict
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already registered/i);

    // Clean up
    const createdPatient = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    await prisma.patient.delete({ where: { id: createdPatient.id } });
  });
});
