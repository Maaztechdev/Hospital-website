with open("careplus-frontend/tests/e2e/qa-audit/journey-c.spec.ts", "r", encoding="utf-8") as f:
    c = f.read()

target = """    await prisma.payment.deleteMany({ where: { invoice: { invoiceNumber: { startsWith: "INV-BUSY" } } } })
    await prisma.invoiceItem.deleteMany({ where: { invoice: { invoiceNumber: { startsWith: "INV-BUSY" } } } })
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: "INV-BUSY" } } })"""

replacement = """    await prisma.payment.deleteMany({ where: { invoice: { patient: { mrNumber: { startsWith: "MR-BUSY" } } } } })
    await prisma.invoiceItem.deleteMany({ where: { invoice: { patient: { mrNumber: { startsWith: "MR-BUSY" } } } } })
    await prisma.invoice.deleteMany({ where: { patient: { mrNumber: { startsWith: "MR-BUSY" } } } })"""

if target in c:
    c = c.replace(target, replacement, 1)
    with open("careplus-frontend/tests/e2e/qa-audit/journey-c.spec.ts", "w", encoding="utf-8") as f:
        f.write(c)
    print("Successfully patched journey-c.spec.ts")
else:
    target_crlf = target.replace("\n", "\r\n")
    if target_crlf in c:
        c = c.replace(target_crlf, replacement.replace("\n", "\r\n"), 1)
        with open("careplus-frontend/tests/e2e/qa-audit/journey-c.spec.ts", "w", encoding="utf-8") as f:
            f.write(c)
        print("Successfully patched journey-c.spec.ts with CRLF")
    else:
        print("Target not found")

