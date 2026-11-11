with open("careplus-frontend/src/dashboard/pages/doctor/DoctorDashboard.tsx", "r", encoding="utf-8") as f:
    c = f.read()

target = "const todays = appointments.filter((a) => a.date === today)"
replacement = "const todays = appointments.filter((a) => (a.date ? a.date.slice(0, 10) : \"\") === today)"
if target in c:
    c = c.replace(target, replacement, 1)
    with open("careplus-frontend/src/dashboard/pages/doctor/DoctorDashboard.tsx", "w", encoding="utf-8") as f:
        f.write(c)
    print("Successfully patched DoctorDashboard.tsx")
else:
    print("Target already replaced or not found")

