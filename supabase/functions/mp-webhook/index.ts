import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const body = await req.json();

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
