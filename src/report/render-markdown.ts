import type {
  BugReport,
  ReportEnvironment,
  ReportEvent,
  ReportLogEntry,
  ReportRequest,
  ReportSocketEvent,
  ReportStateEvent,
} from "./types";

const DEFAULT_MAX_BODY_CHARS = 4000;

const longestBacktickRun = (text: string): number =>
  Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));

const codeBlock = ({ content, language = "" }: { content: string; language?: string }): string => {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${fence}${language}\n${content}\n${fence}`;
};

const inlineCode = (text: string): string => {
  const ticks = "`".repeat(longestBacktickRun(text) + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${padding}${text}${padding}${ticks}`;
};

const truncate = ({ text, max }: { text: string; max: number }): string =>
  text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)` : text;

const bodyLanguage = (body: string): string => (/^\s*[[{]/.test(body) ? "json" : "");

const joinDefined = ({ parts, separator }: { parts: (string | undefined)[]; separator: string }): string =>
  parts.filter((part): part is string => Boolean(part)).join(separator);

function renderEnvironment(environment: ReportEnvironment): string[] {
  const { app, device, sdkVersion } = environment;
  const lines: string[] = [];

  if (app) {
    const build = app.build ? `(${app.build})` : undefined;
    const value = joinDefined({
      parts: [app.id, app.version, build],
      separator: " ",
    });
    const withEnvironment = joinDefined({
      parts: [value, app.environment],
      separator: ", ",
    });
    if (withEnvironment) lines.push(`- **App:** ${withEnvironment}`);
  }

  if (device) {
    const os = joinDefined({
      parts: [device.os ?? device.platform, device.osVersion],
      separator: " ",
    });
    const value = joinDefined({
      parts: [device.name ?? device.model, os],
      separator: " · ",
    });
    if (value) lines.push(`- **Device:** ${value}`);
  }

  if (sdkVersion) lines.push(`- **SDK:** ${sdkVersion}`);

  return lines.length > 0 ? ["### Environment", "", ...lines] : [];
}

const renderHeaders = (headers: Record<string, string>): string =>
  Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");

function renderRequest({ request, maxBodyChars }: { request: ReportRequest; maxBodyChars: number }): string[] {
  const status = request.status === undefined ? undefined : `**${request.status}**`;
  const duration = request.durationMs === undefined ? undefined : `${Math.round(request.durationMs)} ms`;
  const summary = joinDefined({
    parts: [`**${request.method.toUpperCase()}** ${inlineCode(request.url)}`, status, duration],
    separator: " · ",
  });

  const lines = [summary];
  if (request.error) lines.push("", `**Error:** ${request.error}`);

  const sections: [string, string | undefined, string][] = [
    ["Request headers", request.requestHeaders && renderHeaders(request.requestHeaders), "http"],
    ["Request body", request.requestBody, "body"],
    ["Response headers", request.responseHeaders && renderHeaders(request.responseHeaders), "http"],
    ["Response body", request.responseBody, "body"],
    ["cURL", request.curl, "bash"],
  ];

  for (const [title, content, kind] of sections) {
    if (!content) continue;
    const isBody = kind === "body";
    lines.push(
      "",
      `#### ${title}`,
      "",
      codeBlock({
        content: isBody ? truncate({ text: content, max: maxBodyChars }) : content,
        language: isBody ? bodyLanguage(content) : kind,
      }),
    );
  }

  return lines;
}

const SOCKET_DIRECTION = { in: "received", out: "sent" } as const;

function renderSocket({ event, maxBodyChars }: { event: ReportSocketEvent; maxBodyChars: number }): string[] {
  const what =
    event.phase === "frame" ? `frame ${event.direction ? SOCKET_DIRECTION[event.direction] : ""}`.trim() : event.phase;
  const lines = [`**${what}** ${inlineCode(event.url)}`];
  const details = joinDefined({
    parts: [event.code === undefined ? undefined : `code ${event.code}`, event.reason, event.error],
    separator: " · ",
  });
  if (details) lines.push("", details);
  if (event.data) {
    lines.push(
      "",
      codeBlock({ content: truncate({ text: event.data, max: maxBodyChars }), language: bodyLanguage(event.data) }),
    );
  }
  return lines;
}

function renderState(event: ReportStateEvent): string[] {
  const lines = [
    joinDefined({ parts: [`**${event.store}**`, event.action && inlineCode(event.action)], separator: " · " }),
  ];
  if (event.changes.length === 0) return lines;
  const diff = event.changes.flatMap((change) => [
    ...(change.before === undefined ? [] : [`- ${change.key}: ${change.before}`]),
    ...(change.after === undefined ? [] : [`+ ${change.key}: ${change.after}`]),
  ]);
  return [...lines, "", codeBlock({ content: diff.join("\n"), language: "diff" })];
}

const EVENT_TITLE: Record<ReportEvent["kind"], string> = {
  request: "Request",
  log: "Console",
  socket: "WebSocket",
  state: "State change",
};

function renderEvent({ event, maxBodyChars }: { event: ReportEvent; maxBodyChars: number }): string[] {
  const lines = [`### ${EVENT_TITLE[event.kind]}`, ""];
  if (event.note) lines.push(...event.note.split("\n").map((line) => `> ${line}`), "");
  switch (event.kind) {
    case "request":
      return [...lines, ...renderRequest({ request: event, maxBodyChars })];
    case "log":
      return [...lines, codeBlock({ content: renderLogEntry(event) })];
    case "socket":
      return [...lines, ...renderSocket({ event, maxBodyChars })];
    case "state":
      return [...lines, ...renderState(event)];
  }
}

const renderLogEntry = (entry: ReportLogEntry): string => {
  const head = `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase()} ${entry.message}`;
  return entry.stack ? `${head}\n${entry.stack}` : head;
};

const renderConsole = (entries: ReportLogEntry[]): string[] =>
  entries.length > 0 ? ["### Console around", "", codeBlock({ content: entries.map(renderLogEntry).join("\n") })] : [];

/** Default Markdown rendering of a report; adapters for trackers with another markup convert the report themselves. */
export function renderMarkdown({
  report,
  maxBodyChars = DEFAULT_MAX_BODY_CHARS,
}: {
  report: BugReport;
  maxBodyChars?: number;
}): string {
  const blocks: string[][] = [
    report.description ? [report.description] : [],
    renderEnvironment(report.environment),
    ...(report.events ?? []).map((event) => renderEvent({ event, maxBodyChars })),
    renderConsole(report.console ?? []),
  ];

  const { reporter } = report.environment;
  if (reporter) {
    blocks.push([
      "---",
      `_Reported with ${joinDefined({ parts: [reporter.name, reporter.version], separator: " " })}_`,
    ]);
  }

  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join("\n"))
    .join("\n\n");
}
