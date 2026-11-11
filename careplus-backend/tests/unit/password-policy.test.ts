import { passwordPolicySchema } from "../../src/common/validators/passwordPolicy";
import { createUserSchema } from "../../src/modules/users/users.validators";
import { changePasswordSchema, resetPasswordSchema } from "../../src/modules/auth/auth.validators";

describe("Unit: Password Policy & Complexity", () => {
  const validPasswords = [
    "Admin@12345",
    "Doctor@12345",
    "Staff@12345",
    "Billing@12345",
    "Str0ng#Password!2026",
    "Hospital_Secure_99$",
  ];

  it.each(validPasswords)("accepts compliant password: %s", (pwd) => {
    const result = passwordPolicySchema.safeParse(pwd);
    expect(result.success).toBe(true);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = passwordPolicySchema.safeParse("Sh0rt!");
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toMatch(/at least 8 characters/);
  });

  it("rejects password with no uppercase letter", () => {
    const result = passwordPolicySchema.safeParse("lowercase123!");
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toMatch(/uppercase letter/);
  });

  it("rejects password with no lowercase letter", () => {
    const result = passwordPolicySchema.safeParse("UPPERCASE123!");
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toMatch(/lowercase letter/);
  });

  it("rejects password with no digits", () => {
    const result = passwordPolicySchema.safeParse("NoDigitsHere!");
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toMatch(/number/);
  });

  it("rejects password with no special characters", () => {
    const result = passwordPolicySchema.safeParse("NoSpecialChar123");
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toMatch(/special character/);
  });

  it("enforces password policy on createUserSchema", () => {
    const valid = createUserSchema.safeParse({
      name: "Test Doctor",
      email: "doc.test@careplus.local",
      password: "Doctor@12345",
      role: "DOCTOR",
    });
    expect(valid.success).toBe(true);

    const invalid = createUserSchema.safeParse({
      name: "Test Doctor",
      email: "doc.test@careplus.local",
      password: "weakpassword",
      role: "DOCTOR",
    });
    expect(invalid.success).toBe(false);
  });

  it("enforces password policy on resetPasswordSchema", () => {
    const valid = resetPasswordSchema.safeParse({
      token: "valid-reset-token-sample",
      newPassword: "NewSecurePassword#2026",
    });
    expect(valid.success).toBe(true);

    const invalid = resetPasswordSchema.safeParse({
      token: "valid-reset-token-sample",
      newPassword: "12345678",
    });
    expect(invalid.success).toBe(false);
  });

  it("enforces password policy on changePasswordSchema", () => {
    const valid = changePasswordSchema.safeParse({
      currentPassword: "OldPassword@12345",
      newPassword: "NewPassword@98765",
    });
    expect(valid.success).toBe(true);

    const invalid = changePasswordSchema.safeParse({
      currentPassword: "OldPassword@12345",
      newPassword: "simple",
    });
    expect(invalid.success).toBe(false);
  });
});
