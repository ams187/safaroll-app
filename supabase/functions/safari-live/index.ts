import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { activityState, type SafariRun } from "../_shared/safari.ts";
import { closeExpiredChoruses } from "../_shared/chorus-lifecycle.ts";

// Secret-protected cron, never callable by a player to forge an update.
Deno.serve(async (request) => {
  const secret = Deno.env.get("RECAP_SECRET");
  if (!secret || request.headers.get("x-recap-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const appId = Deno.env.get("ONESIGNAL_APP_ID"),
    key = Deno.env.get("ONESIGNAL_API_KEY");
  if (!appId || !key) {
    return new Response("OneSignal not configured", { status: 503 });
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  // Expiry must happen even if nobody reopens the app.
  const chorus = await closeExpiredChoruses(db, appId, key).catch(() => ({ closed: 0, failed: 1 }));
  const { error: expiryError } = await db.from("safari_runs").update({
    status: "expired",
    ended_at: new Date().toISOString(),
  })
    .eq("status", "active").lte("expires_at", new Date().toISOString());
  if (expiryError) return new Response(expiryError.message, { status: 500 });
  const { data: jobs, error } = await db.from("safari_activity_outbox").select(
    "run_id,revision",
  ).is("sent_at", null)
    .or(
      `attempted_at.is.null,attempted_at.lt.${
        new Date(Date.now() - 60000).toISOString()
      }`,
    ).order("attempted_at", { ascending: true, nullsFirst: true }).limit(5);
  if (error) return new Response(error.message, { status: 500 });
  let accepted = 0;
  let failed = chorus.failed;
  let absent = 0;
  for (const job of jobs ?? []) {
    // Conditional claim: overlapping cron executions cannot send the same job concurrently.
    const { data: claim, error: claimError } = await db.from(
      "safari_activity_outbox",
    ).update({ attempted_at: new Date().toISOString() })
      .eq("run_id", job.run_id).eq("revision", job.revision).is("sent_at", null)
      .or(
        `attempted_at.is.null,attempted_at.lt.${
          new Date(Date.now() - 60000).toISOString()
        }`,
      ).select("run_id");
    if (claimError) { failed++; continue; }
    if (!claim?.length) continue;
    try {
      const { data, error: snapshotError } = await db.rpc("safari_snapshot", {
        p_run: job.run_id,
      });
      if (snapshotError || !data) {
        throw new Error(snapshotError?.message ?? "Missing safari");
      }
      const run = data as SafariRun;
      const deliveries = await Promise.allSettled(
        run.members.map(async (member) => {
          const end = run.status !== "active" || member.left;
          const response = await fetch(
            `https://api.onesignal.com/apps/${appId}/live_activities/safari-${run.id}-${member.userId}/notifications`,
            {
              method: "POST",
              headers: {
                Authorization: `Key ${key}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                event: end ? "end" : "update",
                name: "Safari photo",
                event_updates: { data: activityState(run) },
                priority: end ? 10 : 5,
                stale_date: Math.floor(
                  new Date(run.expiresAt).getTime() / 1000,
                ),
                ...(end
                  ? { dismissal_date: Math.floor(Date.now() / 1000) - 1 }
                  : {}),
              }),
              signal: AbortSignal.timeout(8000),
            },
          );
          const result = await response.json().catch(() => null);
          // Following is optional. Only this documented absence is terminal;
          // a generic 404 (wrong endpoint/proxy) must still fail and retry.
          if (response.status === 404 && Array.isArray(result?.errors) &&
            result.errors.length === 1 && result.errors[0] === "activity_id not found in this app") {
            absent++;
            return;
          }
          if (!response.ok) {
            throw new Error(`OneSignal HTTP ${response.status}`);
          }
          if (typeof result?.id !== "string" || !result.id.trim() || result.errors?.length) {
            throw new Error("OneSignal did not accept the Live Activity update");
          }
          return true;
        }),
      );
      const failure = deliveries.find((delivery) =>
        delivery.status === "rejected"
      );
      if (failure?.status === "rejected") throw failure.reason;
      const { error: ackError } = await db.from("safari_activity_outbox").update({
        sent_at: new Date().toISOString(),
        error: null,
      })
        .eq("run_id", job.run_id).eq("revision", run.revision);
      if (ackError) throw new Error("Failed to acknowledge Live Activity job");
      if (deliveries.some(delivery => delivery.status === "fulfilled" && delivery.value === true)) accepted++;
    } catch (error) {
      failed++;
      await db.from("safari_activity_outbox").update({
        error: String(error).slice(0, 300),
      })
        .eq("run_id", job.run_id).eq("revision", job.revision);
    }
  }
  // Acceptance by OneSignal is not proof of delivery to the phone.
  return Response.json({ processed: jobs?.length ?? 0, accepted, failed, absent, chorusClosed: chorus.closed }, {
    status: failed ? 503 : 200,
  });
});
