with open("careplus-frontend/src/lib/api.ts", "r", encoding="utf-8") as f:
    c = f.read()
target = "date: appointment.appointmentDate,"
replacement = "date: appointment.appointmentDate ? appointment.appointmentDate.slice(0, 10) : \"\","
if target in c:
    c = c.replace(target, replacement, 1)
    with open("careplus-frontend/src/lib/api.ts", "w", encoding="utf-8") as f:
        f.write(c)
    print("Successfully patched api.ts")
else:
    print("Target already replaced or not found")

