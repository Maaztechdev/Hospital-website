import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@config/env";
import { BadRequestError, NotFoundError } from "@common/errors/AppError";

export type UploadKind = "document" | "image";

const allowedTypes: Record<UploadKind, Set<string>> = {
  document: new Set(["application/pdf", "image/jpeg", "image/png"]),
  image: new Set(["image/jpeg", "image/jfif", "image/png", "image/webp", "image/x-icon", "application/dicom", "application/octet-stream"]),
};

const extensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jfif": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/dicom": ".dcm",
  "application/octet-stream": ".dcm",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
};

function rootDirectory() {
  return path.resolve(process.env.UPLOAD_DIR || env.UPLOAD_DIR);
}

function isSvgOrXmlText(buffer: Buffer): boolean {
  // Check first 1024 bytes for XML/SVG indicators
  const head = buffer.subarray(0, 1024).toString("utf8").toLowerCase();
  return head.includes("<svg") || head.includes("<?xml") || head.includes("<!doctype svg") || head.includes("xmlns=\"http://www.w3.org/2000/svg\"");
}

function hasExpectedSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (mimeType === "image/jpeg" || mimeType === "image/jfif") return buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (mimeType === "image/x-icon") return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]));
  if (mimeType === "application/dicom" || mimeType === "application/octet-stream") {
    return buffer.length >= 132 && buffer.subarray(128, 132).toString() === "DICM";
  }
  return false;
}

export async function savePrivateUpload(file: Express.Multer.File, kind: UploadKind, folder: string) {
  const maxBytes = kind === "document" ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
  if (file.size > maxBytes) throw new BadRequestError(`File exceeds the ${maxBytes / 1024 / 1024}MB limit`);

  // Explicitly reject SVG uploads in all forms
  if (file.mimetype === "image/svg+xml" || isSvgOrXmlText(file.buffer)) {
    throw new BadRequestError("SVG uploads are rejected for security. Please upload PNG, JPG, or WebP.");
  }

  if (!allowedTypes[kind].has(file.mimetype) || !hasExpectedSignature(file.buffer, file.mimetype)) {
    throw new BadRequestError("Unsupported or invalid file content. Corrupted or mismatched file signature.");
  }

  const relativePath = path.join(folder, `${randomUUID()}${extensions[file.mimetype]}`);
  const absolutePath = path.join(rootDirectory(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, file.buffer, { mode: 0o600, flag: "wx" });
  await chmod(absolutePath, 0o600);
  return `/api/v1/files/${relativePath.replace(/\\/g, "/")}`;
}

export function resolvePrivateFile(relativePath: string) {
  if (!/^[a-z-]+\/[a-f0-9-]+\.(pdf|jpg|jpeg|png|webp|dcm|svg|ico)$/.test(relativePath)) throw new NotFoundError("File not found");
  const root = rootDirectory();
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw new NotFoundError("File not found");
  return target;
}