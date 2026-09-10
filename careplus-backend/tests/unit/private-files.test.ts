import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("private file storage", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "careplus-upload-"));
    process.env.UPLOAD_DIR = directory;
    jest.resetModules();
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it("rejects a file whose content does not match its MIME type", async () => {
    const { savePrivateUpload } = await import("@common/utils/privateFiles");
    await expect(savePrivateUpload({ size: 5, mimetype: "application/pdf", buffer: Buffer.from("plain") } as Express.Multer.File, "document", "lab-reports")).rejects.toThrow("Unsupported or invalid file content");
  });

  it("rejects files over the configured document limit", async () => {
    const { savePrivateUpload } = await import("@common/utils/privateFiles");
    await expect(savePrivateUpload({ size: 10 * 1024 * 1024 + 1, mimetype: "application/pdf", buffer: Buffer.from("%PDF-") } as Express.Multer.File, "document", "lab-reports")).rejects.toThrow("10MB limit");
  });

  it("writes accepted files outside public paths with restrictive permissions", async () => {
    const { savePrivateUpload } = await import("@common/utils/privateFiles");
    const fileUrl = await savePrivateUpload({ size: 5, mimetype: "application/pdf", buffer: Buffer.from("%PDF-test") } as Express.Multer.File, "document", "lab-reports");
    const target = path.join(directory, "lab-reports", fileUrl.split("/").pop()!);
    expect(fileUrl).toMatch(/^\/api\/v1\/files\/lab-reports\/.+\.pdf$/);
    expect(await readFile(target, "utf8")).toBe("%PDF-test");
    if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
});