import { prisma } from "@config/prisma";
import { usersService } from "../../src/modules/users/users.service";

describe("User profile picture support", () => {
  it("stores and exposes a profile picture URL on the user record", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Profile Picture Doctor",
        email: `profile-picture-${Date.now()}@test.local`,
        passwordHash: "hash",
        role: "DOCTOR",
        profilePictureUrl: "/api/v1/files/profile-pictures/test.jpg",
      },
    });

    const updated = await usersService.updateProfile(user.id, user.id, {
      fullName: user.name,
      qualification: "MBBS",
      specialization: "General Medicine",
      registrationNumber: "PMDC-123",
    }, {});

    expect(updated.user.profilePictureUrl).toBe("/api/v1/files/profile-pictures/test.jpg");
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.profilePictureUrl).toBe("/api/v1/files/profile-pictures/test.jpg");
  });
});
