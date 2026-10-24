import { codeForStatus, TrackerError } from "./errors";
import type { TrackerContext } from "./types";

const parseJson = (text: string): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Performs a request and returns the parsed body; failures become a `TrackerError`. */
export async function requestJson({
  ctx,
  url,
  method = "GET",
  headers,
  body,
  describeError,
}: {
  ctx: TrackerContext;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  describeError?: (body: unknown) => string | undefined;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await ctx.fetch(url, { method, headers, body });
  } catch (error) {
    throw new TrackerError({
      code: "network",
      message: error instanceof Error ? error.message : "Network request failed",
    });
  }

  const data = parseJson(await response.text());
  if (!response.ok) {
    throw new TrackerError({
      code: codeForStatus(response.status),
      status: response.status,
      message: describeError?.(data) ?? `HTTP ${response.status}`,
    });
  }
  return data;
}

const unexpectedShape = (what: string) =>
  new TrackerError({
    code: "unexpected",
    message: `Unexpected response: ${what}`,
  });

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw unexpectedShape("expected an object");
}

export function readString({ record, key }: { record: Record<string, unknown>; key: string }): string {
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  throw unexpectedShape(`missing "${key}"`);
}

export function readRecords({
  record,
  key,
}: {
  record: Record<string, unknown>;
  key: string;
}): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) throw unexpectedShape(`missing "${key}"`);
  return value.map(asRecord);
}
