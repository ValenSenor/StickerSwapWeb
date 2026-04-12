import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifyMPSignature(req: Request, rawBody: string): Promise<boolean> {
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature) return false;

  // Parsear ts y v1 del header x-signature
  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => p.split("=") as [string, string])
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  // Obtener data.id del body
  let dataId: string | undefined;
  try {
    dataId = JSON.parse(rawBody)?.data?.id;
  } catch {
    return false;
  }

  // Construir el mensaje a firmar según la documentación de MP
  const message = `id:${dataId};request-id:${xRequestId ?? ""};ts:${ts};`;

  const secret = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hex === v1;
}

serve(async (req) => {
  try {
    const rawBody = await req.text();

    // Verificar firma de Mercado Pago
    const valid = await verifyMPSignature(req, rawBody);
    if (!valid) {
      console.error("Firma de webhook inválida");
      return new Response("unauthorized", { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // MP envía distintos tipos de notificaciones
    if (body.type !== "payment") {
      return new Response("ok", { status: 200 });
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return new Response("ok", { status: 200 });
    }

    // Consultar el pago a la API de Mercado Pago
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN");
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: { Authorization: `Bearer ${mpAccessToken}` },
      }
    );

    const payment = await mpRes.json();

    if (payment.status !== "approved") {
      return new Response("ok", { status: 200 });
    }

    // El external_reference es el user.id de Supabase
    const userId = payment.external_reference;
    if (!userId) {
      return new Response("missing external_reference", { status: 400 });
    }

    // Actualizar is_premium en la tabla profiles
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    const { error } = await supabase
      .from("profiles")
      .update({ is_premium: true })
      .eq("id", userId);

    if (error) {
      console.error("Supabase update error:", error);
      return new Response("db error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(err.message, { status: 500 });
  }
});
