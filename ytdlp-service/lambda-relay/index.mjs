// Downloader — Egress Relay (AWS Lambda Function URL)
// Node.js 20.x runtime (ESM)
//
// Serves as an outbound request/response reverse-proxy for Downloader.
// Egress traffic is routed through AWS Lambda with x-target-host header.

const RELAY_SECRET = process.env.RELAY_SECRET || "";

export const handler = async (event) => {
  const headers = event.headers || {};
  const secret = headers["x-proxy-secret"] || headers["X-Proxy-Secret"];

  if (RELAY_SECRET && secret !== RELAY_SECRET) {
    return {
      statusCode: 401,
      body: "Unauthorized",
    };
  }

  const targetHost = headers["x-target-host"] || headers["X-Target-Host"];
  if (!targetHost) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ok", service: "downloader-lambda-relay" }),
    };
  }

  const rawPath = event.rawPath || "/";
  const rawQuery = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const targetUrl = targetHost.replace(/\/$/, "") + rawPath + rawQuery;

  const forwardHeaders = { ...headers };
  const stripKeys = [
    "x-target-host", "x-proxy-secret", "host", "content-length",
    "x-forwarded-for", "x-forwarded-proto", "x-forwarded-port",
    "x-amzn-trace-id", "forwarded", "via"
  ];
  for (const k of Object.keys(forwardHeaders)) {
    if (stripKeys.includes(k.toLowerCase())) {
      delete forwardHeaders[k];
    }
  }

  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || "GET";
  let reqBody = undefined;
  if (event.body) {
    reqBody = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: ["GET", "HEAD"].includes(method) ? undefined : reqBody,
    });

    const respHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding"].includes(k.toLowerCase())) {
        respHeaders[k] = v;
      }
    });

    const arrayBuf = await upstream.arrayBuffer();
    const base64Body = Buffer.from(arrayBuf).toString("base64");

    return {
      statusCode: upstream.status,
      headers: respHeaders,
      isBase64Encoded: true,
      body: base64Body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: `Relay upstream error: ${err.message}`,
    };
  }
};
