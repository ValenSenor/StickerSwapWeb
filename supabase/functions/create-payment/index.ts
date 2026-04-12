import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verificar sesión del usuario via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Crear preferencia en Mercado Pago
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN");
    const siteUrl = Deno.env.get("SITE_URL") ?? "https://pmodotofheuvamkfnwem.supabase.co";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    const preference = {
      items: [
        {
          title: "StickerSwap Premium",
          quantity: 1,
          unit_price: 5000,
          currency_id: "ARS",
        },
      ],
      notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
      external_reference: user.id,
    };

    const mpRes = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpAccessToken}`,
        },
        body: JSON.stringify(preference),
      }
    );

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error("MP error:", JSON.stringify(mpData));
      return new Response(
        JSON.stringify({ error: mpData.message ?? mpData.error ?? JSON.stringify(mpData) }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ init_point: mpData.init_point }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
