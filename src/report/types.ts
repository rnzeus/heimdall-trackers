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

/**
 * Tracker-agnostic bug report. Secrets must already be masked by the caller:
 * adapters send it to a third-party service as is.
 */
export type BugReport = {
  title: string;
  description?: string;
  environment: ReportEnvironment;
  request?: ReportRequest;
  console?: ReportLogEntry[];
};
