jest.mock("@config/prisma", () => ({
  prisma: {
    doctor: { findUnique: jest.fn() },
  },
}));

import { ForbiddenError } from "../../src/common/errors/AppError";
import { getActorDoctorId, assertDoctorOwns } from "../../src/common/utils/recordAuthorization";
import { prisma } from "@config/prisma";

const mockFindDoctor = prisma.doctor.findUnique as jest.Mock;

describe("Integration: record-level authorization", () => {
  const doctorA = { sub: "user-a", role: "DOCTOR" as const, email: "a@example.com" };
  const doctorB = { sub: "user-b", role: "DOCTOR" as const, email: "b@example.com" };

  beforeEach(() => {
    mockFindDoctor.mockReset();
  });

  it("resolves a doctor actor to their own doctor profile", async () => {
    mockFindDoctor.mockResolvedValue({ id: "doctor-a" });

    await expect(getActorDoctorId(doctorA)).resolves.toBe("doctor-a");
    expect(mockFindDoctor).toHaveBeenCalledWith({ where: { userId: "user-a" }, select: { id: true } });
  });

  it("does not treat another doctor profile as the authenticated doctor", async () => {
    mockFindDoctor.mockResolvedValue({ id: "doctor-a" });

    await expect(getActorDoctorId(doctorB)).resolves.not.toBe("doctor-b");
  });

  it("rejects a cross-record doctor ownership check", async () => {
    mockFindDoctor.mockResolvedValue({ id: "doctor-a" });
    await expect(assertDoctorOwns(doctorA, "doctor-b")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertDoctorOwns(doctorA, "doctor-a")).resolves.toBeUndefined();
  });

  it("keeps non-doctor operational roles compatible with shared records", async () => {
    await expect(assertDoctorOwns({ sub: "nurse", role: "NURSE", email: "nurse@example.com" }, "doctor-b")).resolves.toBeUndefined();
  });
});
