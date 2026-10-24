export type TrackerErrorCode =
  "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "invalid_request" | "network" | "unexpected";

export class TrackerError extends Error {
  readonly code: TrackerErrorCode;
  readonly status?: number;

  constructor({ code, message, status }: { code: TrackerErrorCode; message: string; status?: number }) {
    super(message);
    this.name = "TrackerError";
    this.code = code;
    this.status = status;
  }
}

export const isTrackerError = (error: unknown): error is TrackerError => error instanceof TrackerError;

export function codeForStatus(status: number): TrackerErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "invalid_request";
  return "unexpected";
}
