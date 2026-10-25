export type ReportEnvironment = {
  app?: {
    id?: string;
    version?: string;
    build?: string;
    environment?: string;
  };
  device?: {
    name?: string;
    platform?: string;
    os?: string;
    osVersion?: string;
    model?: string;
  };
  sdkVersion?: string;
  /** the tool that produced the report, e.g. `{ name: "Heimdall", version: "0.4.0" }` */
  reporter?: {
    name: string;
    version?: string;
  };
};

export type ReportRequest = {
  ts?: number;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
  curl?: string;
};

export type ReportLogEntry = {
  level: string;
  ts: number;
  message: string;
  stack?: string;
};

export type ReportSocketEvent = {
  url: string;
  ts: number;
  phase: "open" | "close" | "error" | "frame";
  direction?: "in" | "out";
  data?: string;
  code?: number;
  reason?: string;
  error?: string;
};

/** One changed top-level key of a store; values are already serialized (and masked) by the caller. */
export type ReportStateChange = { key: string; before?: string; after?: string };

export type ReportStateEvent = {
  store: string;
  ts: number;
  action?: string;
  changes: ReportStateChange[];
};

/** An event the reporter singled out (pinned), with their note. */
export type ReportEvent = { note?: string } & (
  | ({ kind: "request" } & ReportRequest)
  | ({ kind: "log" } & ReportLogEntry)
  | ({ kind: "socket" } & ReportSocketEvent)
  | ({ kind: "state" } & ReportStateEvent)
);

/** When the bug was reported and which span of time the attachments cover. */
export type ReportMoment = {
  ts: number;
  range?: { from: number; to: number };
};

/**
 * Tracker-agnostic bug report. Secrets must already be masked by the caller:
 * adapters send it to a third-party service as is.
 */
export type BugReport = {
  title: string;
  description?: string;
  environment: ReportEnvironment;
  moment?: ReportMoment;
  /** the events the report is about, in full, in the order they happened */
  events?: ReportEvent[];
  /** failures found automatically: failed requests, console errors, socket errors; `total` counts the ones left out too */
  signals?: { items: ReportEvent[]; total: number };
  /** what happened right before, oldest first, one line each */
  trail?: ReportEvent[];
  /** names of the files attached to the issue */
  attachments?: string[];
};
