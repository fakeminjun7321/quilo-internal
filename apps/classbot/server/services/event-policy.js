export const ASSESSMENT_REMINDER_OFFSETS = Object.freeze([10080, 2880, 1440, 0]);
export const DEFAULT_REMINDER_OFFSETS = Object.freeze([4320, 1440, 0]);

export function defaultReminderOffsets(category) {
  return [...(category === "assessment" ? ASSESSMENT_REMINDER_OFFSETS : DEFAULT_REMINDER_OFFSETS)];
}
