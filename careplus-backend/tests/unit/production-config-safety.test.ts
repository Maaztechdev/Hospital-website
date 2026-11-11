import { assertProductionConfigSafe, envBoolean, ProductionConfigError } from "../../src/config/env";

describe("Unit: Production Config Safety Guard", () => {
  const validProductionConfig = {
    NODE_ENV: "production",
    JWT_ACCESS_SECRET: "a-super-long-secure-and-random-jwt-access-secret-32-chars-minimum",
    JWT_REFRESH_SECRET: "a-super-long-secure-and-random-jwt-refresh-secret-32-chars-minimum",
    PASSWORD_RESET_SECRET: "a-super-long-secure-and-random-password-reset-secret-32-chars-min",
    DATABASE_URL: "postgresql://careplus_prod_user:StrongRandomDbPassword123!@db-host:5432/careplus_prod?schema=public",
  };

  it("allows valid, strong secrets in production", () => {
    expect(() => assertProductionConfigSafe(validProductionConfig)).not.toThrow();
  });

  it.each([
    ["false", false],
    ["true", true],
    [undefined, false],
  ])("parses %s as %s", (value, expected) => {
    expect(envBoolean().parse(value)).toBe(expected);
  });

  it.each(["yes", "1", ""])("rejects invalid boolean value %s", (value) => {
    expect(() => envBoolean().parse(value)).toThrow();
  });

  it("rejects exposing development reset tokens in production", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        EXPOSE_DEV_RESET_TOKEN: true,
      })
    ).toThrow("EXPOSE_DEV_RESET_TOKEN must be false in production");
  });

  it("does not enforce production rules in development or test", () => {
    expect(() =>
      assertProductionConfigSafe({
        NODE_ENV: "development",
        JWT_ACCESS_SECRET: "short",
        JWT_REFRESH_SECRET: "change_me",
        PASSWORD_RESET_SECRET: "careplus-super-secret",
        DATABASE_URL: "postgresql://careplus:carepluspass123@localhost:5432/careplus?schema=public",
      })
    ).not.toThrow();

    expect(() =>
      assertProductionConfigSafe({
        NODE_ENV: "test",
        JWT_ACCESS_SECRET: "short",
        JWT_REFRESH_SECRET: "change_me",
        PASSWORD_RESET_SECRET: "careplus-super-secret",
        DATABASE_URL: "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public",
      })
    ).not.toThrow();
  });

  it("throws ProductionConfigError if JWT_ACCESS_SECRET is under 32 characters in production", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        JWT_ACCESS_SECRET: "too-short-secret-under-32-chars",
      })
    ).toThrow(ProductionConfigError);
  });

  it("throws ProductionConfigError if any JWT secret contains placeholder 'change_me'", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        JWT_REFRESH_SECRET: "please_change_me_to_a_real_secret_value_in_production_now",
      })
    ).toThrow(ProductionConfigError);
  });

  it("throws ProductionConfigError if secret contains 'careplus-super-secret'", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        PASSWORD_RESET_SECRET: "careplus-super-secret-key-that-was-checked-in-by-mistake",
      })
    ).toThrow(ProductionConfigError);
  });

  it("throws ProductionConfigError if DATABASE_URL contains placeholder password 'carepluspass123'", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        DATABASE_URL: "postgresql://careplus:carepluspass123@prod-db.internal:5432/careplus?schema=public",
      })
    ).toThrow(ProductionConfigError);
  });

  it("throws ProductionConfigError if DATABASE_URL contains placeholder '<db-password>'", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        DATABASE_URL: "postgresql://user:<db-password>@prod-db.internal:5432/careplus?schema=public",
      })
    ).toThrow(ProductionConfigError);
  });

  it("throws ProductionConfigError if BOOTSTRAP_ADMIN_PASSWORD is a demo password", () => {
    expect(() =>
      assertProductionConfigSafe({
        ...validProductionConfig,
        BOOTSTRAP_ADMIN_PASSWORD: "Admin@12345",
      })
    ).toThrow(ProductionConfigError);
  });
});
