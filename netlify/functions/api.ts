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
  application ??= buildApp();
  return application;
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  const { server } = await app();
  const response = await server.inject({
    method: event.httpMethod,
    url: event.path + (event.rawQuery ? `?${event.rawQuery}` : ""),
    headers: event.headers,
    payload: event.body ?? undefined,
  });
  return {
    statusCode: response.statusCode,
    headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, String(value)])),
    body: response.body,
  };
}
