import { hasSupabaseConfig } from "@/lib/env";
import { logError, logInfo, logWarn, sendOpsAlert } from "@/lib/observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WebhookDelivery } from "@/lib/types";

type ProcessResult = {
  processed: number;
  delivered: number;
  failed: number;
  skipped: boolean;
  deliveries: Array<Pick<WebhookDelivery, "id" | "status" | "attempts" | "last_status_code" | "last_error">>;
};

export async function enqueueEprWebhookDelivery(batchId: string) {
  if (!hasSupabaseConfig() || !process.env.EPR_WEBHOOK_URL) {
    logWarn("EPR webhook enqueue skipped", {
      batchId,
      hasSupabaseConfig: hasSupabaseConfig(),
      eprWebhookConfigured: Boolean(process.env.EPR_WEBHOOK_URL)
    });
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("enqueue_epr_webhook_delivery", {
    p_batch_id: batchId,
    p_endpoint_url: process.env.EPR_WEBHOOK_URL
  });

  if (error) {
    logError("EPR webhook enqueue failed", error, { batchId });
    throw error;
  }

  logInfo("EPR webhook delivery enqueued", {
    batchId,
    deliveryId: data?.id,
    status: data?.status
  });

  return data as WebhookDelivery;
}

export async function processEprWebhookDeliveries(limit = 10): Promise<ProcessResult> {
  if (!hasSupabaseConfig() || !process.env.EPR_WEBHOOK_URL) {
    logWarn("EPR webhook processor skipped", {
      hasSupabaseConfig: hasSupabaseConfig(),
      eprWebhookConfigured: Boolean(process.env.EPR_WEBHOOK_URL)
    });
    return {
      processed: 0,
      delivered: 0,
      failed: 0,
      skipped: true,
      deliveries: []
    };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_webhook_deliveries", {
    p_limit: limit
  });

  if (error) {
    logError("EPR webhook claim failed", error, { limit });
    throw error;
  }

  const claimed = (data || []) as WebhookDelivery[];
  const deliveries: ProcessResult["deliveries"] = [];
  let delivered = 0;
  let failed = 0;

  for (const delivery of claimed) {
    logInfo("EPR webhook delivery attempt started", {
      deliveryId: delivery.id,
      batchId: delivery.batch_id,
      attempts: delivery.attempts,
      maxAttempts: delivery.max_attempts
    });
    const result = await deliverWebhook(delivery);

    if (result.status === "delivered") {
      delivered += 1;
      logInfo("EPR webhook delivery succeeded", {
        deliveryId: result.id,
        batchId: result.batch_id,
        attempts: result.attempts,
        statusCode: result.last_status_code
      });
    } else {
      failed += 1;
      logWarn("EPR webhook delivery failed", {
        deliveryId: result.id,
        batchId: result.batch_id,
        status: result.status,
        attempts: result.attempts,
        maxAttempts: result.max_attempts,
        statusCode: result.last_status_code,
        error: result.last_error
      });
      await alertIfWebhookAbandoned(result);
    }

    deliveries.push({
      id: result.id,
      status: result.status,
      attempts: result.attempts,
      last_status_code: result.last_status_code,
      last_error: result.last_error
    });
  }

  return {
    processed: claimed.length,
    delivered,
    failed,
    skipped: false,
    deliveries
  };
}

export async function listEprWebhookDeliveries(limit = 25) {
  if (!hasSupabaseConfig()) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data || []) as WebhookDelivery[];
}

export async function retryEprWebhookDelivery(deliveryId: string) {
  if (!hasSupabaseConfig() || !process.env.EPR_WEBHOOK_URL) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data: delivery, error: readError } = await supabase
    .from("webhook_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .single();

  if (readError || !delivery) {
    throw readError || new Error("Webhook delivery not found");
  }

  if (delivery.status === "delivered") {
    return delivery as WebhookDelivery;
  }

  const nextAttempt = Number(delivery.attempts || 0) + 1;
  logInfo("Manual EPR webhook retry requested", {
    deliveryId,
    batchId: delivery.batch_id,
    nextAttempt
  });
  const { data: claimed, error: claimError } = await supabase
    .from("webhook_deliveries")
    .update({
      status: "processing",
      attempts: nextAttempt,
      max_attempts: Math.max(Number(delivery.max_attempts || 5), nextAttempt),
      locked_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
      last_error: null
    })
    .eq("id", deliveryId)
    .select()
    .single();

  if (claimError || !claimed) {
    logError("Manual EPR webhook retry claim failed", claimError || new Error("Unable to claim webhook delivery"), {
      deliveryId
    });
    throw claimError || new Error("Unable to claim webhook delivery");
  }

  const result = await deliverWebhook(claimed as WebhookDelivery);
  await alertIfWebhookAbandoned(result);
  return result;
}

async function deliverWebhook(delivery: WebhookDelivery) {
  try {
    const response = await fetch(delivery.endpoint_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": delivery.idempotency_key
      },
      body: JSON.stringify(delivery.payload)
    });
    const responseBody = await response.text();

    return markDeliveryResult({
      deliveryId: delivery.id,
      delivered: response.ok,
      statusCode: response.status,
      responseBody,
      error: response.ok ? null : response.statusText
    });
  } catch (error) {
    logError("EPR webhook HTTP request failed", error, {
      deliveryId: delivery.id,
      batchId: delivery.batch_id,
      attempts: delivery.attempts
    });
    return markDeliveryResult({
      deliveryId: delivery.id,
      delivered: false,
      statusCode: null,
      responseBody: null,
      error: error instanceof Error ? error.message : "Webhook request failed"
    });
  }
}

async function markDeliveryResult({
  deliveryId,
  delivered,
  statusCode,
  responseBody,
  error
}: {
  deliveryId: string;
  delivered: boolean;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
}) {
  const supabase = createSupabaseAdminClient();
  const { data, error: rpcError } = await supabase.rpc("mark_webhook_delivery_result", {
    p_delivery_id: deliveryId,
    p_delivered: delivered,
    p_status_code: statusCode,
    p_response_body: responseBody,
    p_error: error
  });

  if (rpcError) {
    logError("EPR webhook result update failed", rpcError, { deliveryId });
    throw rpcError;
  }

  return data as WebhookDelivery;
}

async function alertIfWebhookAbandoned(delivery: WebhookDelivery) {
  if (delivery.status !== "abandoned") {
    return;
  }

  await sendOpsAlert({
    title: "EPR webhook delivery abandoned",
    message: `Delivery ${delivery.id} for batch ${delivery.batch_id} reached ${delivery.attempts}/${delivery.max_attempts} attempts.`,
    severity: "error",
    fields: {
      deliveryId: delivery.id,
      batchId: delivery.batch_id,
      attempts: delivery.attempts,
      maxAttempts: delivery.max_attempts,
      lastStatusCode: delivery.last_status_code,
      lastError: delivery.last_error,
      idempotencyKey: delivery.idempotency_key
    }
  });
}
