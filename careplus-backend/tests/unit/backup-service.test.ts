jest.mock("node:child_process", () => ({
  execFile: jest.fn((_command: string, _args: string[], _options: unknown, callback: (error: null, result: { stdout: string; stderr: string }) => void) => callback(null, { stdout: "", stderr: "" })),
}));
jest.mock("node:fs/promises", () => ({
  chmod: jest.fn(),
  cp: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn(),
  readdir: jest.fn(),
  readFile: jest.fn().mockImplementation((filePath: string) => {
    const sql = Buffer.from("test SQL");
    if (filePath.endsWith("manifest.json")) {
      const checksum = require("node:crypto").createHash("sha256").update(sql).digest("hex");
      return Promise.resolve(
        JSON.stringify({
          version: "1.0",
          schemaVersion: "20261023000000",
          databaseChecksumSha256: checksum,
        })
      );
    }
    return Promise.resolve(sql);
  }),
  rm: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 42 }),
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("argon2", () => ({ verify: jest.fn().mockResolvedValue(true) }));
jest.mock("@config/env", () => ({
  env: {
    BACKUP_DIR: "./backups",
    UPLOAD_DIR: "./uploads",
    DATABASE_URL: "postgresql://test",
    BACKUP_RETENTION_DAYS: 30,
    NODE_ENV: "test",
  },
}));
jest.mock("@config/prisma", () => ({
  prisma: {
    patient: { count: jest.fn().mockResolvedValue(0) },
    appointment: { count: jest.fn().mockResolvedValue(0) },
    prescription: { count: jest.fn().mockResolvedValue(0) },
    doctor: { count: jest.fn().mockResolvedValue(0) },
    medicine: { count: jest.fn().mockResolvedValue(0) },
    medicineBatch: { count: jest.fn().mockResolvedValue(0) },
    pharmacySale: { count: jest.fn().mockResolvedValue(0) },
    labTest: { count: jest.fn().mockResolvedValue(0) },
    labOrder: { count: jest.fn().mockResolvedValue(0) },
    ultrasoundOrder: { count: jest.fn().mockResolvedValue(0) },
    invoice: { count: jest.fn().mockResolvedValue(0) },
    payment: { count: jest.fn().mockResolvedValue(0) },
    admission: { count: jest.fn().mockResolvedValue(0) },
    ward: { count: jest.fn().mockResolvedValue(0) },
    bed: { count: jest.fn().mockResolvedValue(0) },
    setting: { count: jest.fn().mockResolvedValue(0) },
    backup: {
      findUnique: jest.fn().mockResolvedValue({ id: "backup-id", filename: "careplus-backup-2026-08-25-120000.sql", sizeBytes: BigInt(42) }),
      create: jest.fn().mockResolvedValue({ id: "safety-id", filename: "careplus-backup-2026-08-25-130000.sql", sizeBytes: BigInt(42) }),
      findMany: jest.fn().mockResolvedValue([{ id: "old-backup-id", filename: "careplus-backup-2026-08-01-120000.sql" }]),
      delete: jest.fn().mockResolvedValue({ id: "old-backup-id" }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ passwordHash: "hash" }),
      findFirst: jest.fn().mockResolvedValue({ id: "admin-id" }),
      count: jest.fn().mockResolvedValue(0),
    },
    $disconnect: jest.fn(),
    $connect: jest.fn(),
  },
}));
jest.mock("@common/utils/auditLog", () => ({ writeAuditLog: jest.fn() }));

import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { prisma } from "@config/prisma";
import { writeAuditLog } from "@common/utils/auditLog";
import { backupService } from "@modules/backup/backup.service";
import { isMaintenanceMode } from "@common/middleware/maintenance";

const request = { ip: "127.0.0.1", headers: {} } as never;

describe("Backup service restore safety & retention", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires password confirmation", async () => {
    const argon2 = jest.requireMock("argon2") as { verify: jest.Mock };
    argon2.verify.mockResolvedValueOnce(false);
    await expect(backupService.restore("backup-id", "wrong", "admin-id", request)).rejects.toThrow("Password confirmation failed");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("creates a safety backup and maintains the system during restore", async () => {
    await backupService.restore("backup-id", "correct", "admin-id", request);
    expect(execFile).toHaveBeenCalledTimes(4);
    expect((execFile as unknown as jest.Mock).mock.calls[0][0]).toBe("pg_dump");
    expect((execFile as unknown as jest.Mock).mock.calls[1][0]).toBe("tar");
    expect((execFile as unknown as jest.Mock).mock.calls[2][0]).toBe("tar");
    expect((execFile as unknown as jest.Mock).mock.calls[3][0]).toBe("psql");
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(prisma.$connect).toHaveBeenCalled();
    expect((jest.requireMock("node:fs/promises") as { rm: jest.Mock }).rm).toHaveBeenCalledWith(
      expect.stringContaining("restore-staging-"),
      { recursive: true, force: true }
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "RESTORE" }));
    expect(isMaintenanceMode()).toBe(false);
  });

  it("prunes expired backups beyond retention period", async () => {
    const result = await backupService.pruneOldBackups(30);
    expect(result.prunedCount).toBe(1);
    expect(unlink).toHaveBeenCalled();
    expect(prisma.backup.delete).toHaveBeenCalledWith({ where: { id: "old-backup-id" } });
  });

  it("aborts restore and protects DB when database checksum does not match manifest (corrupted/truncated archive)", async () => {
    (prisma.backup.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "backup-id",
      filename: "careplus-backup-2026-08-25-120000.tar.gz",
      sizeBytes: BigInt(42),
    });
    const fsPromises = jest.requireMock("node:fs/promises");
    fsPromises.readFile.mockImplementation((filePath: string) => {
      if (filePath.endsWith("manifest.json")) {
        return Promise.resolve(
          JSON.stringify({
            version: "1.0",
            schemaVersion: "20261023000000",
            databaseChecksumSha256: "tampered-corrupted-hash-does-not-match",
          })
        );
      }
      return Promise.resolve(Buffer.from("test SQL"));
    });

    await expect(backupService.restore("backup-id", "correct", "admin-id", request)).rejects.toThrow(
      "database dump checksum mismatch"
    );
    // Verified: psql was NEVER invoked to protect database integrity!
    const calls = (execFile as unknown as jest.Mock).mock.calls;
    const psqlCalled = calls.some((c) => c[0] === "psql");
    expect(psqlCalled).toBe(false);
  });

  it("aborts restore when manifest version is incompatible", async () => {
    (prisma.backup.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "backup-id",
      filename: "careplus-backup-2026-08-25-120000.tar.gz",
      sizeBytes: BigInt(42),
    });
    const fsPromises = jest.requireMock("node:fs/promises");
    fsPromises.readFile.mockImplementation((filePath: string) => {
      if (filePath.endsWith("manifest.json")) {
        return Promise.resolve(
          JSON.stringify({
            version: "99.0",
            schemaVersion: "20990101000000",
            databaseChecksumSha256: "some-hash",
          })
        );
      }
      return Promise.resolve(Buffer.from("test SQL"));
    });

    await expect(backupService.restore("backup-id", "correct", "admin-id", request)).rejects.toThrow(
      "Incompatible backup format version"
    );
    const psqlCalled = (execFile as unknown as jest.Mock).mock.calls.some((c) => c[0] === "psql");
    expect(psqlCalled).toBe(false);
  });

  it("aborts restore when SQL file is empty (truncated to 0 bytes)", async () => {
    const fsPromises = jest.requireMock("node:fs/promises");
    fsPromises.stat.mockImplementation((filePath: string) => {
      if (filePath.endsWith(".sql")) return Promise.resolve({ size: 0 });
      return Promise.resolve({ size: 42 });
    });

    await expect(backupService.restore("backup-id", "correct", "admin-id", request)).rejects.toThrow(
      /SQL file is empty|dump failed/i
    );
    const psqlCalled = (execFile as unknown as jest.Mock).mock.calls.some((c) => c[0] === "psql");
    expect(psqlCalled).toBe(false);
  });
});
