import { dispatchDueReminders } from "../../src/lib/server/push-reminders";

export default async function sendDueReminders() {
  try {
    const result = await dispatchDueReminders();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Failed to run scheduled reminders",
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }
}

export const config = {
  schedule: "* * * * *",
};
