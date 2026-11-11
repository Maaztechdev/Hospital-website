import nodemailer from "nodemailer";
import { env } from "../../src/config/env";
import { logger } from "../../src/config/logger";
import { sendPasswordResetEmail, setTransporterForTesting } from "../../src/common/utils/mailer";

describe("Password Reset Mailer Unit Test", () => {
  afterEach(() => {
    setTransporterForTesting(null);
  });

  it("should send password reset email using stub JSON transport", async () => {
    const stubTransporter = nodemailer.createTransport({
      jsonTransport: true,
    });

    setTransporterForTesting(stubTransporter);

    const result = await sendPasswordResetEmail("doctor@careplus.local", "sample-reset-token-12345", "Dr. Ahmed");

    expect(result.sent).toBe(true);
    expect(result.deliveryMethod).toBe("smtp");
    expect(result.resetUrl).toContain("token=sample-reset-token-12345");
  });

  it("should handle transport errors gracefully without crashing", async () => {
    const failingTransporter = {
      sendMail: jest.fn().mockRejectedValue(new Error("Connection refused")),
    } as unknown as ReturnType<typeof nodemailer.createTransport>;

    setTransporterForTesting(failingTransporter);

    const result = await sendPasswordResetEmail("nurse@careplus.local", "token-fail-999");

    expect(result.sent).toBe(false);
    expect(result.deliveryMethod).toBe("smtp");
    expect(result.resetUrl).toContain("token=token-fail-999");
  });

  it("should fallback to logged_dev when no SMTP transporter is configured", async () => {
    setTransporterForTesting(null);

    const result = await sendPasswordResetEmail("admin@careplus.local", "dev-token-abc");

    expect(result.sent).toBe(true);
    expect(result.deliveryMethod).toBe("logged_dev");
    expect(result.resetUrl).toContain("token=dev-token-abc");
  });

  it("does not log reset URLs or tokens when SMTP is unavailable in production", async () => {
    const originalNodeEnv = env.NODE_ENV;
    const originalSmtpHost = env.SMTP_HOST;
    const warnSpy = jest.spyOn(logger, "warn");
    env.NODE_ENV = "production";
    env.SMTP_HOST = undefined;

    try {
      setTransporterForTesting(null);
      await sendPasswordResetEmail("admin@careplus.local", "production-reset-token");

      expect(warnSpy).toHaveBeenCalledWith("SMTP not configured, reset email not sent");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("production-reset-token");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("/dashboard/reset-password");
    } finally {
      env.NODE_ENV = originalNodeEnv;
      env.SMTP_HOST = originalSmtpHost;
      warnSpy.mockRestore();
    }
  });
});
