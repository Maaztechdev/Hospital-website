import urllib.request, json
req = urllib.request.urlopen("http://127.0.0.1:4100/api/v1/appointments/public/doctors")
docs = json.loads(req.read().decode())["data"]
doc = docs[0]
doc_id = doc["id"]
print("Doctor:", doc_id)
for d in ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]:
    try:
        req2 = urllib.request.urlopen(f"http://127.0.0.1:4100/api/v1/appointments/public/doctors/{doc_id}/slots?date={d}")
        slots = json.loads(req2.read().decode())["data"]
        print(f"Date {d}: total={len(slots['slotsPerDay'])}, booked={len(slots['bookedSlots'])}, available={len(slots['availableSlots'])}")
    except Exception as e:
        print(f"Date {d}: error {e}")

