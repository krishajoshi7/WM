type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

export function logInfo(message: string, fields: LogFields = {}) {
  writeStructuredLog("info", message, fields);
}

export function logWarn(message: string, fields: LogFields = {}) {
  writeStructuredLog("warn", message, fields);
}

export function logError(message: string, error: unknown, fields: LogFields = {}) {
  writeStructuredLog("error", message, {
    ...fields,
    error: normalizeError(error)
  });
}

export async function sendOpsAlert({
  title,
  message,
  severity = "error",
  fields = {}
}: {
  title: string;
  message: string;
  severity?: "warn" | "error";
  fields?: LogFields;
}) {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL;

  if (!webhookUrl) {
    logWarn("Ops alert skipped because OPS_ALERT_WEBHOOK_URL is not configured", {
      title,
      severity,
      ...fields
    });
    return { delivered: false, skipped: true };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: `${severity.toUpperCase()}: ${title}\n${message}`,
        title,
        message,
        severity,
        service: "sustainable-ecg",
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
        timestamp: new Date().toISOString(),
        fields
      })
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      logWarn("Ops alert webhook returned a non-2xx response", {
        title,
        severity,
        status: response.status,
        responseBody: responseBody.slice(0, 500)
      });
      return { delivered: false, skipped: false };
    }

    logInfo("Ops alert delivered", {
      title,
      severity
    });
    return { delivered: true, skipped: false };
  } catch (error) {
    logError("Ops alert delivery failed", error, {
      title,
      severity
    });
    return { delivered: false, skipped: false };
  }
}

function writeStructuredLog(level: LogLevel, message: string, fields: LogFields) {
  const payload = {
    level,
    message,
    service: "sustainable-ecg",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    timestamp: new Date().toISOString(),
    ...redact(fields)
  };
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

function redact(fields: LogFields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      /secret|token|authorization|password|key/i.test(key) ? "[redacted]" : value
    ])
  );
}
