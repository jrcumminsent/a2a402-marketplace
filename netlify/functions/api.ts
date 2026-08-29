import {
  MissingDatabaseConnectionError,
  getConnectionString,
} from "@netlify/database";

import { buildApp } from "../../apps/api/src/app.js";
import { installBuilderRoutes } from "../../apps/api/src/builders.js";
import { installNetworkRoutes } from "../../apps/api/src/network.js";
import { autonomousMarketplaceDiscovery } from "../../apps/api/src/machine-discovery.js";
import { createNetlifyArtifactStorage } from "./blob-storage.js";

let application: Promise<Awaited<ReturnType<typeof buildApp>>> | undefined;

function app(): Promise<Awaited<ReturnType<typeof buildApp>>> {
  // Netlify Database injects its connection through the official runtime
  // binding. The application itself stays portable by consuming DATABASE_URL.
  try {
    process.env.DATABASE_URL = getConnectionString();
  } catch (error) {
    // A manually provisioned database may not yet be bound to this function.
    // Preserve the portable DATABASE_URL fallback while configuration is fixed.
    if (!(error instanceof MissingDatabaseConnectionError)) throw error;
  }
  application ??= buildApp({
    artifactStorage: createNetlifyArtifactStorage(10_000_000),
  }).then((context) => {
    installNetworkRoutes(context.server, context.engine);
    installBuilderRoutes(context.server, context.engine);
    return context;
  });
  return application;
}

function publicDiscoveryResponse(requestUrl: URL): Response {
  const publicUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const discovery = autonomousMarketplaceDiscovery(publicUrl);
  return Response.json({
    ...discovery,
    state: "operational",
    next_action: {
      method: "GET",
      url: `${publicUrl}/api/discovery`,
      authentication_required: false,
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const functionPrefix = "/.netlify/functions/api";
  const requestPath = requestUrl.pathname.startsWith(functionPrefix)
    ? requestUrl.pathname.slice(functionPrefix.length) || "/"
    : requestUrl.pathname;

  // Root discovery is intentionally stateless. Do not cold-start the durable
  // marketplace runtime just to answer the public machine entry point: runtime
  // initialization can legitimately contend with active SERIALIZABLE writes.
  if ((request.method === "GET" || request.method === "HEAD") && requestPath === "/") {
    return publicDiscoveryResponse(requestUrl);
  }

  const { server } = await app();
  const requestBody = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.text();
  const response = await server.inject({
    method: request.method,
    url: requestPath + requestUrl.search,
    headers: Object.fromEntries(request.headers.entries()),
    payload: requestBody || undefined,
  });
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(name, String(item));
    } else if (value !== undefined) {
      responseHeaders.set(name, String(value));
    }
  }
  return new Response(response.body, {
    status: response.statusCode,
    headers: responseHeaders,
  });
}
