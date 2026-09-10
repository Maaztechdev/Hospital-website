import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@config/env";
import { BadRequestError, NotFoundError } from "@common/errors/AppError";

export type UploadKind = "document" | "image";

const allowedTypes: Record<UploadKind, Set<string>> = {
  document: new Set(["application/pdf", "image/jpeg", "image/png"]),
  image: new Set(["image/jpeg", "image/png", "image/svg+xml", "image/x-icon", "application/dicom", "application/octet-stream"]),
};

const extensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/dicom": ".dcm",
  "application/octet-stream": ".dcm",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
};

function rootDirectory() {
  return path.resolve(env.UPLOAD_DIR);
}

function hasExpectedSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (mimeType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/svg+xml") return buffer.toString("utf8", 0, 1000).includes("<svg");
  if (mimeType === "image/x-icon") return buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
  return buffer.length >= 132 && buffer.subarray(128, 132).toString() === "DICM";
}

export async function savePrivateUpload(file: Express.Multer.File, kind: UploadKind, folder: string) {
  const maxBytes = kind === "document" ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
  if (file.size > maxBytes) throw new BadRequestError(`File exceeds the ${maxBytes / 1024 / 1024}MB limit`);
  if (!allowedTypes[kind].has(file.mimetype) || !hasExpectedSignature(file.buffer, file.mimetype)) {
    throw new BadRequestError("Unsupported or invalid file content");
  }

  const relativePath = path.join(folder, `${randomUUID()}${extensions[file.mimetype]}`);
  const absolutePath = path.join(rootDirectory(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, file.buffer, { mode: 0o600, flag: "wx" });
  await chmod(absolutePath, 0o600);
  return `/api/v1/files/${relativePath.replace(/\\/g, "/")}`;
}

export function resolvePrivateFile(relativePath: string) {
  if (!/^[a-z-]+\/[a-f0-9-]+\.(pdf|jpg|png|dcm|svg|ico)$/.test(relativePath)) throw new NotFoundError("File not found");
  const root = rootDirectory();
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw new NotFoundError("File not found");
  return target;
}