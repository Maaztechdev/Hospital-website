import argon2 from "argon2";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Request } from "express";
import { prisma } from "@config/prisma";
import { env } from "@config/env";
import { BadRequestError, NotFoundError, UnauthorizedError } from "@common/errors/AppError";
import { writeAuditLog } from "@common/utils/auditLog";
import { beginMaintenance, endMaintenance } from "@common/middleware/maintenance";

const execFileAsync = promisify(execFile);
let restoreInProgress = false;

function backupDirectory() {
  return path.resolve(env.BACKUP_DIR);
}

function backupPath(filename: string) {
  if (!/^careplus-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sql$/.test(filename)) throw new NotFoundError("Backup not found");
  return path.join(backupDirectory(), filename);
}

async function runDump(filename: string) {
  const directory = backupDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = backupPath(filename);
  await execFileAsync("pg_dump", ["--format=plain", "--no-owner", "--no-privileges", "--clean", "--if-exists", "--file", target, env.DATABASE_URL], { windowsHide: true });
  await chmod(target, 0o600);
  return target;
}

function timestampFilename() {
  const now = new Date();
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}`;
  return `careplus-backup-${stamp}.sql`;
}

async function createBackupRecord(actorId: string, req: Request, action = "BACKUP" as const) {
  const filename = timestampFilename();
  const target = await runDump(filename);
  const fileStats = await stat(target);
  const record = await prisma.backup.create({ data: { filename, sizeBytes: BigInt(fileStats.size) } });
  await writeAuditLog({ userId: actorId, action, module: "backup", entityType: "Backup", entityId: record.id, newValues: { filename, sizeBytes: fileStats.size }, req });
  return { ...record, sizeBytes: Number(record.sizeBytes) };
}

export const backupService = {
  async list() {
    const records = await prisma.backup.findMany({ orderBy: { createdAt: "desc" } });
    const existing = await Promise.all(records.map(async (record) => {
      try {
        const fileStats = await stat(backupPath(record.filename));
        return { ...record, sizeBytes: Number(fileStats.size) };
      } catch {
        return null;
      }
    }));
    return existing.filter((record): record is NonNullable<typeof record> => record !== null);
  },

  async create(actorId: string, req: Request) {
    return createBackupRecord(actorId, req);
  },

  async download(id: string) {
    const record = await prisma.backup.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Backup not found");
    const target = backupPath(record.filename);
    try { await stat(target); } catch { throw new NotFoundError("Backup file not found"); }
    return { record, target };
  },

  async remove(id: string, actorId: string, req: Request) {
    const record = await prisma.backup.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Backup not found");
    await unlink(backupPath(record.filename)).catch(() => undefined);
    await prisma.backup.delete({ where: { id } });
    await writeAuditLog({ userId: actorId, action: "DELETE", module: "backup", entityType: "Backup", entityId: id, oldValues: { filename: record.filename }, req });
  },

  async restore(id: string, password: string, actorId: string, req: Request) {
    if (restoreInProgress) throw new BadRequestError("Another restore is already in progress");
    const record = await prisma.backup.findUnique({ where: { id } });
    if (!record) throw new NotFoundError("Backup not found");
    const admin = await prisma.user.findUnique({ where: { id: actorId } });
    if (!admin || !(await argon2.verify(admin.passwordHash, password))) throw new UnauthorizedError("Password confirmation failed");
    const target = backupPath(record.filename);
    try { await stat(target); } catch { throw new NotFoundError("Backup file not found"); }

    restoreInProgress = true;
    beginMaintenance();
    try {
      await createBackupRecord(actorId, req);
      await prisma.$disconnect();
      await execFileAsync("psql", ["--set", "ON_ERROR_STOP=1", "--single-transaction", env.DATABASE_URL, "--file", target], { windowsHide: true });
      await prisma.$connect();
      await writeAuditLog({ userId: actorId, action: "RESTORE", module: "backup", entityType: "Backup", entityId: id, newValues: { filename: record.filename }, req });
    } finally {
      restoreInProgress = false;
      endMaintenance();
      if (!prisma) return;
      try { await prisma.$connect(); } catch { /* keep the original restore error */ }
    }
  },
};

export async function reconcileBackupFiles() {
  await mkdir(backupDirectory(), { recursive: true, mode: 0o700 });
  const files = await readdir(backupDirectory());
  return files.filter((filename) => /^careplus-backup-\d{4}-\d{2}-\d{2}-\d{6}\.sql$/.test(filename));
}
