import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  userId: z.string().min(1),
  deviceName: z.string().min(1),
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

export async function POST(request: Request) {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin env is missing" }, { status: 503 });
  }

  const payload = schema.parse(await request.json());

  const { error } = await admin.from("push_subscriptions").upsert({
    user_id: payload.userId,
    endpoint: payload.subscription.endpoint,
    p256dh: payload.subscription.keys.p256dh,
    auth: payload.subscription.keys.auth,
    device_name: payload.deviceName,
    user_agent: request.headers.get("user-agent"),
    last_seen_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
