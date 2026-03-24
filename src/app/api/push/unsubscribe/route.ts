import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  endpoint: z.string().url(),
});

export async function POST(request: Request) {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin env is missing" }, { status: 503 });
  }

  const payload = schema.parse(await request.json());
  const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", payload.endpoint);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
