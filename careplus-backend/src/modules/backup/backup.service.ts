import argon2 from "argon2";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, cp, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { BadRequestError, NotFoundError, UnauthorizedError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { beginMaintenance, endMaintenance } from "@common/middleware/maintenance";
import { logger } from "@config/logger";

const execFileAsync = promisify(execFile);
let restoreInProgress = false;

export interface BackupManifest {
  version: string;
  app: string;
  schemaVersion: string;
  createdAt: string;
  environment: string;
  databaseChecksumSha256: string;
  tableCounts: Record<string, number>;
  uploadedFilesCount: number;
}

function backupDirectory() {
  return path.resolve(env.BACKUP_DIR);
}

function backupPath(filename: string) {
  if (!/^careplus-(?:backup|safety-backup)-\d{4}-\d{2}-\d{2}-\d{6}\.(?:tar\.gz|sql)$/.test(filename)) {
    throw new NotFoundError("Backup not found");
  }
  return path.join(backupDirectory(), filename);
}

function timestampFilename(prefix = "backup", extension = "tar.gz") {
  const now = new Date();
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}`;
  return `careplus-${prefix}-${stamp}.${extension}`;
}

async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function collectTableCounts(): Promise<Record<string, number>> {
  const [
    patients,
    appointments,
    prescriptions,
    doctors,
    pharmacyMedicines,
    pharmacyBatches,
    pharmacySales,
    labTests,
    labOrders,
    ultrasoundOrders,
    invoices,
    payments,
    admissions,
    wards,
    beds,
    settings,
    users,
  ] = await Promise.all([
    prisma.patient.count({ where: { deletedAt: null } }).catch(() => 0),
    prisma.appointment.count().catch(() => 0),
    prisma.prescription.count().catch(() => 0),
    prisma.doctor.count().catch(() => 0),
    prisma.medicine.count().catch(() => 0),
    prisma.medicineBatch.count().catch(() => 0),
    prisma.pharmacySale.count().catch(() => 0),
    prisma.labTest.count().catch(() => 0),
    prisma.labOrder.count().catch(() => 0),
    prisma.ultrasoundOrder.count().catch(() => 0),
    prisma.invoice.count().catch(() => 0),
    prisma.payment.count().catch(() => 0),
    prisma.admission.count().catch(() => 0),
    prisma.ward.count().catch(() => 0),
    prisma.bed.count().catch(() => 0),
    prisma.setting.count().catch(() => 0),
    prisma.user.count({ where: { deletedAt: null } }).catch(() => 0),
  ]);

  return {
    patients,
    appointments,
    prescriptions,
    doctors,
    pharmacyMedicines,
    pharmacyBatches,
    pharmacySales,
    labTests,
    labOrders,
    ultrasoundOrders,
    invoices,
    payments,
    admissions,
    wards,
    beds,
    settings,
    users,
  };
}

async function countFilesInDir(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await countFilesInDir(path.join(dirPath, entry.name));
      } else {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function cleanDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0];
  }
}

async function runDumpAndPackage(filename: string, customDbUrl?: string): Promise<{ target: string; manifest: BackupManifest }> {
  const dbUrl = cleanDatabaseUrl(customDbUrl || env.DATABASE_URL);
  const directory = backupDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const stagingDir = path.join(directory, `staging-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(stagingDir, { recursive: true, mode: 0o700 });

  const sqlFile = path.join(stagingDir, "database.sql");
  const target = path.join(directory, filename);

  try {
    // 1. Collect table counts for integrity manifest
    const tableCounts = await collectTableCounts();

    // 2. Run pg_dump into staging
    await execFileAsync(
      "pg_dump",
      ["--format=plain", "--no-owner", "--no-privileges", "--clean", "--if-exists", "--file", sqlFile, dbUrl],
      { windowsHide: true }
    );

    // 3. Validate SQL dump integrity
    const sqlStats = await stat(sqlFile);
    if (sqlStats.size === 0) {
      throw new Error("Database dump failed: output file is empty.");
    }
    const sqlChecksum = await sha256File(sqlFile);

    // 4. Copy uploaded files if present
    let uploadedFilesCount = 0;
    const uploadDirPath = path.resolve(env.UPLOAD_DIR);
    const stagingUploads = path.join(stagingDir, "uploads");
    try {
      await stat(uploadDirPath);
      uploadedFilesCount = await countFilesInDir(uploadDirPath);
      if (uploadedFilesCount > 0) {
        await cp(uploadDirPath, stagingUploads, { recursive: true });
      }
    } catch {
      // Upload directory not present or empty; proceed without uploads
    }

    // 5. Generate and write manifest.json
    const manifest: BackupManifest = {
      version: "1.0",
      app: "CarePlus Hospital Management System",
      schemaVersion: "20261023000000",
      createdAt: new Date().toISOString(),
      environment: env.NODE_ENV,
      databaseChecksumSha256: sqlChecksum,
      tableCounts,
      uploadedFilesCount,
    };
    await writeFile(path.join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    // 6. Create compressed archive bundle (.tar.gz)
    const itemsToArchive = ["manifest.json", "database.sql"];
    if (uploadedFilesCount > 0) {
      itemsToArchive.push("uploads");
    }

    await execFileAsync("tar", ["-czf", target, "-C", stagingDir, ...itemsToArchive], { windowsHide: true });
    await chmod(target, 0o600);

    // 7. Verify tarball integrity
    await execFileAsync("tar", ["-tzf", target], { windowsHide: true });

    return { target, manifest };
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractManifestFromBackup(target: string): Promise<BackupManifest | null> {
  try {
    if (target.endsWith(".tar.gz")) {
      const { stdout } = await execFileAsync("tar", ["-xOf", target, "manifest.json"], {
        encoding: "utf8",
        windowsHide: true,
      });
      return JSON.parse(stdout) as BackupManifest;
    }
    return null;
  } catch {
    return null;
  }
}

async function createBackupRecord(
  actorId: string,
  req: Request,
  action = "BACKUP" as const,
  typePrefix = "backup",
  customDbUrl?: string
) {
  const filename = timestampFilename(typePrefix, "tar.gz");
  try {
    const { target, manifest } = await runDumpAndPackage(filename, customDbUrl);
    const fileStats = await stat(target);
    const record = await prisma.backup.create({
      data: { filename, sizeBytes: BigInt(fileStats.size), status: "SUCCESS" },
    });
    await writeAuditLog({
      userId: actorId,
      action,
      module: "backup",
      entityType: "Backup",
      entityId: record.id,
      newValues: {
        filename,
        sizeBytes: fileStats.size,
        status: record.status,
        tableCounts: manifest.tableCounts,
        uploadedFilesCount: manifest.uploadedFilesCount,
      },
      req,
    });
    return { ...record, sizeBytes: Number(record.sizeBytes), manifest };
  } catch (error) {
    const record = await prisma.backup
      .create({ data: { filename, sizeBytes: 0, status: "FAILED" } })
      .catch(() => null);
    if (record) {
      await writeAuditLog({
        userId: actorId,
        action,
        module: "backup",
        entityType: "Backup",
        entityId: record.id,
        newValues: { filename, sizeBytes: 0, status: record.status, error: String(error) },
        req,
      });
    }
    throw error;
  }
}

export const backupService = {
  async list() {
    const records = await prisma.backup.findMany({ orderBy: { createdAt: "desc" } });
    return Promise.all(
      records.map(async (record) => {
        try {
          const target = backupPath(record.filename);
          const fileStats = await stat(target);
          const manifest = await extractManifestFromBackup(target);
          return { ...record, sizeBytes: Number(fileStats.size), manifest };
        } catch {
          return { ...record, sizeBytes: Number(record.sizeBytes), manifest: null };
        }
      })
    );
  },

  async create(actorId: string, req: Request, customDbUrl?: string) {
    return createBackupRecord(actorId, req, "BACKUP", "backup", customDbUrl);
  },

  async download(id: string) {
    const record = await prisma.backup.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Backup not found");
    if (record.status === "FAILED") throw new BadRequestError("This backup was not created successfully");
    const target = backupPath(record.filename);
    try {
      await stat(target);
    } catch {
      throw new NotFoundError("Backup file not found");
    }
    return { record, target };
  },

  async remove(id: string, actorId: string, req: Request) {
    const record = await prisma.backup.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Backup not found");
    await unlink(backupPath(record.filename)).catch(() => undefined);
    await prisma.backup.delete({ where: { id } });
    await writeAuditLog({
      userId: actorId,
      action: "DELETE",
      module: "backup",
      entityType: "Backup",
      entityId: id,
      oldValues: { filename: record.filename },
      req,
    });
  },

  async restore(id: string, password: string, actorId: string, req: Request, customDbUrl?: string) {
    if (restoreInProgress) throw new BadRequestError("Another restore is already in progress");
    const record = await prisma.backup.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Backup not found");
    if (record.status === "FAILED") throw new BadRequestError("This backup was not created successfully");

    const admin = await prisma.user.findUnique({ where: { id: actorId } });
    if (!admin || !(await argon2.verify(admin.passwordHash, password))) {
      throw new UnauthorizedError("Password confirmation failed");
    }

    const target = backupPath(record.filename);
    try {
      await stat(target);
    } catch {
      throw new NotFoundError("Backup file not found on disk");
    }

    restoreInProgress = true;
    beginMaintenance();

    const directory = backupDirectory();
    const extractStaging = path.join(
      directory,
      `restore-staging-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    await mkdir(extractStaging, { recursive: true, mode: 0o700 });

    try {
      // 1. Auto-create safety backup of CURRENT data first
      logger.info("Creating automatic safety backup before restoring snapshot...");
      await createBackupRecord(actorId, req, "BACKUP", "safety-backup", customDbUrl);

      let sqlPathToRestore: string;
      let manifest: BackupManifest | null = null;

      if (record.filename.endsWith(".tar.gz")) {
        // Extract archive to staging directory
        await execFileAsync("tar", ["-xzf", target, "-C", extractStaging], { windowsHide: true });
        sqlPathToRestore = path.join(extractStaging, "database.sql");

        // Validate manifest & structure
        const manifestPath = path.join(extractStaging, "manifest.json");
        try {
          const manifestRaw = await readFile(manifestPath, "utf8");
          manifest = JSON.parse(manifestRaw) as BackupManifest;
        } catch {
          throw new BadRequestError("Backup validation failed: manifest.json is missing or corrupt.");
        }

        // Validate schema version compatibility
        if (!manifest.schemaVersion || manifest.version !== "1.0") {
          throw new BadRequestError(
            `Incompatible backup format version: ${manifest.version || "unknown"}. Supported version is 1.0.`
          );
        }

        // Validate database.sql integrity via sha256 checksum
        const actualChecksum = await sha256File(sqlPathToRestore);
        if (actualChecksum !== manifest.databaseChecksumSha256) {
          throw new BadRequestError(
            "Backup integrity verification failed: database dump checksum mismatch. Restore aborted."
          );
        }
      } else {
        // Legacy .sql backup
        sqlPathToRestore = target;
      }

      // Check SQL file size
      const sqlStats = await stat(sqlPathToRestore);
      if (sqlStats.size === 0) {
        throw new BadRequestError("Backup validation failed: SQL file is empty.");
      }

      // 2. Disconnect Prisma pool and restore using single-transaction psql
      const targetDbUrl = cleanDatabaseUrl(customDbUrl || env.DATABASE_URL);
      await prisma.$disconnect();

      await execFileAsync(
        "psql",
        ["--set", "ON_ERROR_STOP=1", "--single-transaction", targetDbUrl, "--file", sqlPathToRestore],
        { windowsHide: true }
      );

      // Reconnect Prisma
      await prisma.$connect();

      // 3. Restore uploaded files if present in the bundle
      const extractedUploads = path.join(extractStaging, "uploads");
      try {
        await stat(extractedUploads);
        const destinationUploads = path.resolve(env.UPLOAD_DIR);
        await mkdir(destinationUploads, { recursive: true });
        await cp(extractedUploads, destinationUploads, { recursive: true });
        logger.info("Restored uploaded files from backup bundle.");
      } catch {
        // No uploads in bundle
      }

      // 4. Post-restore data verification: ensure critical records are retrievable
      const restoredAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
      if (!restoredAdmin) {
        throw new Error("Post-restore verification failed: no admin user found in restored database.");
      }

      await writeAuditLog({
        userId: actorId,
        action: "RESTORE",
        module: "backup",
        entityType: "Backup",
        entityId: id,
        newValues: {
          filename: record.filename,
          tableCounts: manifest?.tableCounts,
          verified: true,
        },
        req,
      });

      return {
        message: "Database and files restored successfully",
        manifest,
        verified: true,
      };
    } finally {
      restoreInProgress = false;
      endMaintenance();
      await rm(extractStaging, { recursive: true, force: true }).catch(() => undefined);
      try {
        await prisma.$connect();
      } catch {
        /* retain original error */
      }
    }
  },

  async pruneOldBackups(retentionDays = env.BACKUP_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expired = await prisma.backup.findMany({
      where: { createdAt: { lt: cutoff } },
    });
    let prunedCount = 0;
    for (const record of expired) {
      await unlink(backupPath(record.filename)).catch(() => undefined);
      await prisma.backup.delete({ where: { id: record.id } }).catch(() => undefined);
      prunedCount++;
    }
    return { prunedCount, cutoff };
  },

  async runAutomatedNightlyBackup() {
    if (!env.AUTO_BACKUP_ENABLED) return null;
    const dummyReq = { ip: "127.0.0.1", headers: {} } as Request;
    const backup = await createBackupRecord("system-backup-scheduler", dummyReq, "BACKUP");
    const pruneResult = await this.pruneOldBackups(env.BACKUP_RETENTION_DAYS);
    return { backup, pruneResult };
  },
};

export async function reconcileBackupFiles() {
  await mkdir(backupDirectory(), { recursive: true, mode: 0o700 });
  const files = await readdir(backupDirectory());
  return files.filter((filename) =>
    /^careplus-(?:backup|safety-backup)-\d{4}-\d{2}-\d{2}-\d{6}\.(?:tar\.gz|sql)$/.test(filename)
  );
}
