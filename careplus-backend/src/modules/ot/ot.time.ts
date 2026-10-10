export const HOSPITAL_TIME_ZONE = "Asia/Karachi";
export const PAST_SURGERY_START_MESSAGE =
  "Surgery start time must be in the future (hospital time: Asia/Karachi)";

export function isFutureSurgeryStart(start: Date, now = new Date()) {
  return start.getTime() > now.getTime();
}
