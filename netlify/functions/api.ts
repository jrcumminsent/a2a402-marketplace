import {
  MissingDatabaseConnectionError,
  getConnectionString,
} from "@netlify/database";

import { buildApp } from "../../apps/api/src/app.js";

interface NetlifyEvent {
  httpMethod: string;
  path: string;
  rawQuery: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}

interface NetlifyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

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
  application ??= buildApp();
  return application;
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  const { server } = await app();
  const functionPrefix = "/.netlify/functions/api";
  const requestPath = event.path.startsWith(functionPrefix)
    ? event.path.slice(functionPrefix.length) || "/"
    : event.path;
  const response = await server.inject({
    method: event.httpMethod,
    url: requestPath + (event.rawQuery ? `?${event.rawQuery}` : ""),
    headers: event.headers,
    payload: event.body ?? undefined,
  });
  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, String(value)])),
    body: response.body,
  };
}
