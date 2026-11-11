with open("careplus-backend/src/modules/backup/backup.service.ts", "r", encoding="utf-8") as f:
    c = f.read()

target = """function cleanDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("schema");
    return parsed.toString();
  } catch {
    return rawUrl.replace(/\\?schema=[^&]+/, "").replace(/\\?$/, "");
  }
}"""

replacement = """function cleanDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0];
  }
}"""

if target in c:
    c = c.replace(target, replacement, 1)
    with open("careplus-backend/src/modules/backup/backup.service.ts", "w", encoding="utf-8") as f:
        f.write(c)
    print("Successfully patched backup.service.ts")
else:
    target_crlf = target.replace("\n", "\r\n")
    if target_crlf in c:
        c = c.replace(target_crlf, replacement.replace("\n", "\r\n"), 1)
        with open("careplus-backend/src/modules/backup/backup.service.ts", "w", encoding="utf-8") as f:
            f.write(c)
        print("Successfully patched backup.service.ts with CRLF")
    else:
        print("Target not found")

