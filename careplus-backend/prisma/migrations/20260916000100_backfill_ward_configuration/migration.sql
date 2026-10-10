UPDATE "wards"
SET "daily_rate" = CASE "ward_type" WHEN 'GENERAL' THEN 3500 WHEN 'PRIVATE' THEN 9000 WHEN 'ICU' THEN 22000 ELSE "daily_rate" END,
    "capacity" = GREATEST("capacity", COALESCE((SELECT COUNT(*) FROM "beds" b JOIN "rooms" r ON r.id = b.room_id WHERE r.ward_id = "wards".id), 1));
