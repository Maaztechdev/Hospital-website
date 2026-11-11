import { describe, it, expect } from "@jest/globals";
import { savePrivateUpload } from "@common/utils/privateFiles";

function makeFile(options: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: options.originalname,
    encoding: "7bit",
    mimetype: options.mimetype,
    size: options.buffer.length,
    buffer: options.buffer,
    destination: "",
    filename: "",
    path: "",
    stream: null as any,
  };
}

describe("SVG Hardening & Bypass Rejection Suite", () => {
  const testFolder = "test-uploads";

  it("1. Rejects pure clean SVG logo upload entirely", async () => {
    const safeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="green" /></svg>`;
    const file = makeFile({ originalname: "logo.svg", mimetype: "image/svg+xml", buffer: Buffer.from(safeSvg, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("2. Rejects SVG with <script> tag", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script></svg>`;
    const file = makeFile({ originalname: "script.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("3. Rejects SVG with onerror attribute", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><image href="invalid.png" onerror="alert('onerror_xss')"/></svg>`;
    const file = makeFile({ originalname: "onerror.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("4. Rejects SVG with onclick attribute", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg" onclick="alert('onclick')"><circle cx="50" cy="50" r="40"/></svg>`;
    const file = makeFile({ originalname: "onclick.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("5. Rejects SVG with <style> tag containing css/javascript", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><style>@import 'javascript:alert(1)';</style></svg>`;
    const file = makeFile({ originalname: "style.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("6. Rejects SVG with xlink:href javascript: pseudo-protocol", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert('xlink')"><text>Click</text></a></svg>`;
    const file = makeFile({ originalname: "xlink.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("7. Rejects SVG with entity-encoded javascript: payload", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)"><text>Click</text></a></svg>`;
    const file = makeFile({ originalname: "entity.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("8. Rejects SVG with uppercase tags and handlers (<SVG ONLOAD=...>)", async () => {
    const payload = `<SVG XMLNS="http://www.w3.org/2000/svg" ONLOAD="alert('UPPER')"><CIRCLE CX="50" CY="50" R="40"/></SVG>`;
    const file = makeFile({ originalname: "upper.svg", mimetype: "image/svg+xml", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security/i
    );
  });

  it("9. Rejects SVG disguised as PNG by file extension/mimetype (fails magic byte check)", async () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>`;
    const file = makeFile({ originalname: "disguised.png", mimetype: "image/png", buffer: Buffer.from(payload, "utf8") });
    await expect(savePrivateUpload(file, "image", testFolder)).rejects.toThrow(
      /SVG uploads are rejected for security|Unsupported or invalid file content/i
    );
  });

  it("10. Accepts valid PNG file with legitimate magic bytes", async () => {
    // Valid minimal 1x1 PNG bytes
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    const file = makeFile({ originalname: "valid.png", mimetype: "image/png", buffer: pngBytes });
    const url = await savePrivateUpload(file, "image", testFolder);
    expect(url).toMatch(/^\/api\/v1\/files\/test-uploads\/[a-f0-9-]+\.png$/);
  });

  it("11. Accepts valid JPEG file with legitimate magic bytes", async () => {
    // Valid minimal JPEG SOI + EOI
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xff, 0xd9]);
    const file = makeFile({ originalname: "valid.jpg", mimetype: "image/jpeg", buffer: jpegBytes });
    const url = await savePrivateUpload(file, "image", testFolder);
    expect(url).toMatch(/^\/api\/v1\/files\/test-uploads\/[a-f0-9-]+\.jpg$/);
  });

  it("12. Accepts valid WebP file with legitimate magic bytes", async () => {
    // Minimal WebP header: 'RIFF' + 4 bytes size + 'WEBP'
    const webpBytes = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "ascii"),
      Buffer.from("VP8 ", "ascii"),
      Buffer.alloc(20),
    ]);
    const file = makeFile({ originalname: "valid.webp", mimetype: "image/webp", buffer: webpBytes });
    const url = await savePrivateUpload(file, "image", testFolder);
    expect(url).toMatch(/^\/api\/v1\/files\/test-uploads\/[a-f0-9-]+\.webp$/);
  });
});
