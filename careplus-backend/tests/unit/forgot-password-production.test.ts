jest.mock("@config/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "user-1",
        email: "doctor@careplus.local",
        name: "Dr. Ahmed",
        deletedAt: null,
        isActive: true,
      }),
    },
  },
}));

jest.mock("@config/env", () => ({
  env: {
    NODE_ENV: "production",
    EXPOSE_DEV_RESET_TOKEN: false,
  },
}));

jest.mock("../../src/modules/auth/token.utils", () => ({
  createPasswordResetToken: jest.fn().mockResolvedValue("production-reset-token"),
}));

jest.mock("@common/utils/mailer", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ deliveryMethod: "smtp" }),
}));

import { authService } from "../../src/modules/auth/auth.service";

describe("Production forgot-password response", () => {
  it("never contains a reset token", async () => {
    const response = await authService.forgotPassword("doctor@careplus.local");

    expect(response).not.toHaveProperty("devResetToken");
    expect(JSON.stringify(response)).not.toContain("production-reset-token");
  });
});
