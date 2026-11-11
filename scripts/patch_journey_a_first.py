with open("careplus-frontend/tests/e2e/qa-audit/journey-a.spec.ts", "r", encoding="utf-8") as f:
    c = f.read()

target = """    while (Date.now() - startTime < 20_000) {
      if (
        await docPage.getByText(mrNumber, { exact: false }).isVisible().catch(() => false) ||
        await docPage.getByText(suffix, { exact: false }).isVisible().catch(() => false) ||
        await docPage.locator(`text=${mrNumber}`).isVisible().catch(() => false)
      ) {
        patientVisibleInDoctorPanel = true
        break
      }
      await docPage.waitForTimeout(1000)
    }"""

replacement = """    while (Date.now() - startTime < 20_000) {
      if (
        await docPage.getByText(mrNumber, { exact: false }).first().isVisible().catch(() => false) ||
        await docPage.getByText(suffix, { exact: false }).first().isVisible().catch(() => false) ||
        await docPage.locator(`text=${mrNumber}`).first().isVisible().catch(() => false)
      ) {
        patientVisibleInDoctorPanel = true
        break
      }
      await docPage.waitForTimeout(1000)
    }"""

if target in c:
    c = c.replace(target, replacement, 1)
    with open("careplus-frontend/tests/e2e/qa-audit/journey-a.spec.ts", "w", encoding="utf-8") as f:
        f.write(c)
    print("Successfully patched journey-a.spec.ts with .first()")
else:
    target_crlf = target.replace("\n", "\r\n")
    if target_crlf in c:
        c = c.replace(target_crlf, replacement.replace("\n", "\r\n"), 1)
        with open("careplus-frontend/tests/e2e/qa-audit/journey-a.spec.ts", "w", encoding="utf-8") as f:
            f.write(c)
        print("Successfully patched journey-a.spec.ts with CRLF")
    else:
        print("Target not found")

