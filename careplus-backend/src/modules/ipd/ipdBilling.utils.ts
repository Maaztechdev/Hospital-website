function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateTimeToUtc(dateKey: string, time: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let result = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(result);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
    const target = Date.UTC(year, month - 1, day, hour, minute);
    result = new Date(result.getTime() + target - represented);
  }
  return result;
}

export function bedRentAccrualDates(
  admittedAt: Date,
  upTo: Date,
  cutoffTime: string,
  timezone = "Asia/Karachi",
) {
  if (upTo < admittedAt) return [];
  const admissionDay = dateKeyInTimezone(admittedAt, timezone);
  const finalDay = dateKeyInTimezone(upTo, timezone);
  const dates = [{ dayIndex: 1, serviceDate: admissionDay, accruedAt: admittedAt }];
  for (let day = admissionDay; day <= finalDay; day = addDateKey(day, 1)) {
    const accruedAt = localDateTimeToUtc(day, cutoffTime, timezone);
    if (accruedAt > admittedAt && accruedAt <= upTo) {
      dates.push({ dayIndex: dates.length + 1, serviceDate: day, accruedAt });
    }
  }
  return dates;
}
