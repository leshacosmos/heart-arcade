import webpush from "npm:web-push@3.6.7";

const project = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rpc(name: string, args: Record<string, unknown>) {
  const res = await fetch(project + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json"},
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error("Database operation failed");
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, {status: 405});
  try {
    const data = await req.json();
    if (data.init === true) {
      // The database keeps the first pair on concurrent initialization or redeploy.
      const keys = webpush.generateVAPIDKeys();
      await rpc("heart_push_init", {
        candidate: keys, gateway_key: Deno.env.get("SUPABASE_ANON_KEY"), function_url: project + "/functions/v1/heart-push"
      });
      return Response.json({ready: true});
    }
    if (!/^[0-9a-f-]{36}$/i.test(data.job ?? "")) return new Response(null,{status:400});
    const item = await rpc("heart_push_claim", {job: data.job});
    if (!item) return new Response(null,{status:204});
    const details = webpush.generateRequestDetails(item.subscription, JSON.stringify(item.payload), {
      TTL: 86400, urgency: "normal",
      vapidDetails: {...item.vapid, subject: "https://github.com/leshacosmos/heart-arcade"}
    });
    const result = await fetch(details.endpoint, {
      method: "POST", headers: details.headers, body: details.body, redirect: "error", signal: AbortSignal.timeout(12000)
    });
    const expired = result.status === 404 || result.status === 410;
    if (result.ok || expired) await rpc("heart_push_ack", {job: data.job, expired});
    return Response.json({accepted: result.ok, status: result.status}, {status: result.ok || expired ? 200 : 502});
  } catch {
    return Response.json({error: "Push operation failed"}, {status: 503});
  }
});
