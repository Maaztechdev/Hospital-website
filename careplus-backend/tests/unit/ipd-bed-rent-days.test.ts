import { bedRentAccrualDates } from "@modules/ipd/ipdBilling.utils";

const scenarios = [
  {
    name: "admission and discharge before cut-off on the same day",
    admittedAt: "2026-06-03T05:00:00.000Z",
    endAt: "2026-06-03T06:00:00.000Z",
    expectedDays: 1,
  },
  {
    name: "discharge before cut-off the next day",
    admittedAt: "2026-06-03T05:00:00.000Z",
    endAt: "2026-06-04T06:00:00.000Z",
    expectedDays: 2,
  },
  {
    name: "discharge after cut-off the next day",
    admittedAt: "2026-06-03T05:00:00.000Z",
    endAt: "2026-06-04T08:00:00.000Z",
    expectedDays: 3,
  },
  {
    name: "afternoon admission and next-day discharge before cut-off",
    admittedAt: "2026-06-03T09:00:00.000Z",
    endAt: "2026-06-04T06:00:00.000Z",
    expectedDays: 1,
  },
  {
    name: "afternoon admission and next-day discharge after cut-off",
    admittedAt: "2026-06-03T09:00:00.000Z",
    endAt: "2026-06-04T08:00:00.000Z",
    expectedDays: 2,
  },
  {
    name: "morning admission and discharge five days later before cut-off",
    admittedAt: "2026-06-03T05:00:00.000Z",
    endAt: "2026-06-08T06:00:00.000Z",
    expectedDays: 6,
  },
  {
    name: "afternoon admission and discharge five days later before cut-off",
    admittedAt: "2026-06-03T09:00:00.000Z",
    endAt: "2026-06-08T06:00:00.000Z",
    expectedDays: 5,
  },
  {
    name: "cut-off instant exactly at discharge",
    admittedAt: "2026-06-03T05:00:00.000Z",
    endAt: "2026-06-03T07:00:00.000Z",
    expectedDays: 2,
  },
  {
    name: "admission exactly at cut-off does not count that instant",
    admittedAt: "2026-06-03T07:00:00.000Z",
    endAt: "2026-06-03T13:00:00.000Z",
    expectedDays: 1,
  },
] as const;

describe("bedRentAccrualDates", () => {
  it.each(scenarios)("$name", ({ admittedAt, endAt, expectedDays }) => {
    const results = ["UTC", "Asia/Karachi"].map((timezone) => {
      const previousTimezone = process.env.TZ;
      try {
        process.env.TZ = timezone;
        return bedRentAccrualDates(
          new Date(admittedAt),
          new Date(endAt),
          "12:00",
          "Asia/Karachi",
        ).map(({ dayIndex }) => dayIndex);
      } finally {
        process.env.TZ = previousTimezone;
      }
    });
    const expectedIndexes = Array.from({ length: expectedDays }, (_, index) => index + 1);

    expect(results).toEqual([expectedIndexes, expectedIndexes]);
    expect(results[0]).toEqual(results[1]);
  });
});
