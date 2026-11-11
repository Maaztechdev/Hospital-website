with open("careplus-backend/src/modules/lab/lab.service.ts", "r", encoding="utf-8") as f:
    c = f.read()

target = """      await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "lab", entityType: "LabOrder", entityId: id, oldValues: { status: current.status }, newValues: { status: updated.status }, req }, tx);
      return updated;
    });"""

replacement = """      await writeAuditLog({ userId: actor.sub, action: "STATUS_CHANGE", module: "lab", entityType: "LabOrder", entityId: id, oldValues: { status: current.status }, newValues: { status: updated.status }, req }, tx);
      return updated;
    }, { maxWait: 10000, timeout: 20000 });"""

if target in c:
    c = c.replace(target, replacement, 1)
    with open("careplus-backend/src/modules/lab/lab.service.ts", "w", encoding="utf-8") as f:
        f.write(c)
    print("Successfully patched lab.service.ts")
else:
    print("Target not found, checking line endings")
    target_crlf = target.replace("\n", "\r\n")
    if target_crlf in c:
        c = c.replace(target_crlf, replacement.replace("\n", "\r\n"), 1)
        with open("careplus-backend/src/modules/lab/lab.service.ts", "w", encoding="utf-8") as f:
            f.write(c)
        print("Successfully patched lab.service.ts with CRLF")
    else:
        print("Could not find target in lab.service.ts")

