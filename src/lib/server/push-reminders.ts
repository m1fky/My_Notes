import webpush from "web-push";

import { nextReminderDate } from "@/lib/reminders";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type DueReminderRow = {
  id: string;
  note_id: string;
  user_id: string;
  fire_at_utc: string;
  repeat_rule: "none" | "daily" | "weekly";
  is_enabled: boolean;
  last_sent_at: string | null;
};

type NoteRow = {
  id: string;
  title: string;
};

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function configureWebPush() {
  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  if (!vapidSubject || !vapidPublic || !vapidPrivate) {
    throw new Error("Push env is incomplete");
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
}

export async function dispatchDueReminders() {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    throw new Error("Supabase admin env is missing");
  }

  configureWebPush();

  const now = new Date().toISOString();
  const { data: reminders, error: remindersError } = await admin
    .from("reminders")
    .select("id, note_id, user_id, fire_at_utc, repeat_rule, is_enabled, last_sent_at")
    .lte("fire_at_utc", now)
    .eq("is_enabled", true);

  if (remindersError) {
    throw new Error(remindersError.message);
  }

  let sent = 0;
  let removedSubscriptions = 0;

  for (const reminder of (reminders ?? []) as DueReminderRow[]) {
    const [{ data: note, error: noteError }, { data: subscriptions, error: subscriptionsError }] =
      await Promise.all([
        admin.from("notes").select("id, title").eq("id", reminder.note_id).maybeSingle(),
        admin
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .eq("user_id", reminder.user_id),
      ]);

    if (noteError) {
      throw new Error(noteError.message);
    }

    if (subscriptionsError) {
      throw new Error(subscriptionsError.message);
    }

    for (const subscription of (subscriptions ?? []) as SubscriptionRow[]) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify({
            title: (note as NoteRow | null)?.title || "Напоминание",
            body: "Пора открыть заметку.",
            href: `/?note=${reminder.note_id}`,
          }),
        );
        sent += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;

        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await admin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", subscription.endpoint);

          if (deleteError) {
            throw new Error(deleteError.message);
          }

          removedSubscriptions += 1;
          continue;
        }

        throw error;
      }
    }

    const nextFireAt =
      reminder.repeat_rule === "none"
        ? reminder.fire_at_utc
        : nextReminderDate(reminder.fire_at_utc, reminder.repeat_rule);

    const { error: updateError } = await admin
      .from("reminders")
      .update({
        last_sent_at: now,
        is_enabled: reminder.repeat_rule !== "none",
        fire_at_utc: reminder.repeat_rule === "none" ? reminder.fire_at_utc : nextFireAt,
      })
      .eq("id", reminder.id);

    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  return {
    ok: true,
    dueReminders: reminders?.length ?? 0,
    sent,
    removedSubscriptions,
  };
}
