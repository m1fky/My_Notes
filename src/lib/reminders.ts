import { addDays, addWeeks, format } from "date-fns";

import type { Reminder, ReminderRepeat } from "@/lib/types";

export function formatReminder(reminder?: Reminder | null) {
  if (!reminder || !reminder.isEnabled) {
    return "Без напоминания";
  }

  const base = format(new Date(reminder.fireAt), "d MMM, HH:mm");

  if (reminder.repeatRule === "daily") {
    return `${base} · ежедневно`;
  }

  if (reminder.repeatRule === "weekly") {
    return `${base} · еженедельно`;
  }

  return base;
}

export function nextReminderDate(fireAtIso: string, repeatRule: ReminderRepeat) {
  const current = new Date(fireAtIso);

  if (repeatRule === "daily") {
    return addDays(current, 1).toISOString();
  }

  if (repeatRule === "weekly") {
    return addWeeks(current, 1).toISOString();
  }

  return fireAtIso;
}

export function hasDueReminder(reminders: Reminder[]) {
  const now = Date.now();
  return reminders.some((reminder) => reminder.isEnabled && new Date(reminder.fireAt).getTime() <= now);
}
