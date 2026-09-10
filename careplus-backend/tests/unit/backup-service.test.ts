jest.mock("node:child_process", () => ({
  execFile: jest.fn((_command: string, _args: string[], _options: unknown, callback: (error: null, result: { stdout: string; stderr: string }) => void) => callback(null, { stdout: "", stderr: "" })),
}));
jest.mock("node:fs/promises", () => ({
  chmod: jest.fn(),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn().mockResolvedValue({ size: 42 }),
  unlink: jest.fn(),
}));
jest.mock("argon2", () => ({ verify: jest.fn().mockResolvedValue(true) }));
jest.mock("@config/env", () => ({ env: { BACKUP_DIR: "./backups", DATABASE_URL: "postgresql://test" } }));
jest.mock("@config/prisma", () => ({
  prisma: {
    backup: {
      findUnique: jest.fn().mockResolvedValue({ id: "backup-id", filename: "careplus-backup-2026-08-25-120000.sql", sizeBytes: BigInt(42) }),
      create: jest.fn().mockResolvedValue({ id: "safety-id", filename: "careplus-backup-2026-08-25-130000.sql", sizeBytes: BigInt(42) }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: "hash" }) },
    $disconnect: jest.fn(),
    $connect: jest.fn(),
  },
}));
jest.mock("@common/utils/auditLog", () => ({ writeAuditLog: jest.fn() }));

import { execFile } from "node:child_process";
import { prisma } from "@config/prisma";
import { writeAuditLog } from "@common/utils/auditLog";
import { backupService } from "@modules/backup/backup.service";
import { isMaintenanceMode } from "@common/middleware/maintenance";

const request = { ip: "127.0.0.1", headers: {} } as never;

describe("Backup service restore safety", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires password confirmation", async () => {
    const argon2 = jest.requireMock("argon2") as { verify: jest.Mock };
    argon2.verify.mockResolvedValueOnce(false);
    await expect(backupService.restore("backup-id", "wrong", "admin-id", request)).rejects.toThrow("Password confirmation failed");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("creates a safety backup and maintains the system during restore", async () => {
    await backupService.restore("backup-id", "correct", "admin-id", request);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect((execFile as unknown as jest.Mock).mock.calls[0][0]).toBe("pg_dump");
    expect((execFile as unknown as jest.Mock).mock.calls[1][0]).toBe("psql");
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(prisma.$connect).toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "RESTORE" }));
    expect(isMaintenanceMode()).toBe(false);
  });
});
