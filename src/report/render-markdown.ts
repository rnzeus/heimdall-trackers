import type {
  BugReport,
  ReportEnvironment,
  ReportEvent,
  ReportLogEntry,
  ReportMoment,
  ReportRequest,
  ReportSocketEvent,
  ReportStateEvent,
} from "./types";

const DEFAULT_MAX_BODY_CHARS = 4000;
const MAX_LINE_MESSAGE_CHARS = 200;

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

const socketPhase = (event: ReportSocketEvent): string =>
  event.phase === "frame" ? `frame ${event.direction ? SOCKET_DIRECTION[event.direction] : ""}`.trim() : event.phase;

function renderSocket({ event, maxBodyChars }: { event: ReportSocketEvent; maxBodyChars: number }): string[] {
  const lines = [`**${socketPhase(event)}** ${inlineCode(event.url)}`];
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

const clockTime = (ts: number): string => new Date(ts).toISOString().slice(11, 19);

function renderMoment(moment: ReportMoment): string[] {
  const covers = moment.range ? ` · covers ${clockTime(moment.range.from)}–${clockTime(moment.range.to)}` : "";
  return ["### When", "", `Reported at ${clockTime(moment.ts)} UTC${covers}`];
}

const firstLine = (text: string): string => {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > MAX_LINE_MESSAGE_CHARS ? `${line.slice(0, MAX_LINE_MESSAGE_CHARS)}…` : line;
};

/** One Markdown line of an event, without bodies or headers. */
function renderEventLine(event: ReportEvent): string {
  const time = event.ts === undefined ? undefined : inlineCode(clockTime(event.ts));
  const what = (() => {
    switch (event.kind) {
      case "request":
        return joinDefined({
          parts: [
            `**${event.method.toUpperCase()}** ${inlineCode(event.url)}`,
            event.status === undefined ? undefined : `**${event.status}**`,
            event.error,
          ],
          separator: " · ",
        });
      case "log":
        return `**${event.level.toUpperCase()}** ${firstLine(event.message)}`;
      case "socket":
        return joinDefined({
          parts: [
            `**${socketPhase(event)}** ${inlineCode(event.url)}`,
            event.code === undefined ? undefined : `code ${event.code}`,
            event.reason,
            event.error,
          ],
          separator: " · ",
        });
      case "state":
        return joinDefined({
          parts: [
            `**${event.store}**`,
            event.action && inlineCode(event.action),
            event.changes.length > 0 ? event.changes.map((change) => change.key).join(", ") : undefined,
          ],
          separator: " · ",
        });
    }
  })();
  return `- ${joinDefined({ parts: [time, what], separator: " " })}`;
}

function renderSignals(signals: NonNullable<BugReport["signals"]>): string[] {
  if (signals.items.length === 0) return [];
  const more = signals.total > signals.items.length ? ` (${signals.items.length} of ${signals.total})` : "";
  return [`### Found automatically${more}`, "", ...signals.items.map(renderEventLine)];
}

const renderTrail = (trail: ReportEvent[]): string[] =>
  trail.length > 0 ? ["### Last activity", "", ...trail.map(renderEventLine)] : [];

function renderAttachments(names: string[]): string[] {
  if (names.length === 0) return [];
  const lines = ["### Attachments", "", ...names.map((name) => `- ${inlineCode(name)}`)];
  if (names.some((name) => name.endsWith(".edda")))
    lines.push("", "Open the `.edda` file in Heimdall to see every event.");
  return lines;
}

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
    report.moment ? renderMoment(report.moment) : [],
    renderEnvironment(report.environment),
    ...(report.events ?? []).map((event) => renderEvent({ event, maxBodyChars })),
    report.signals ? renderSignals(report.signals) : [],
    renderTrail(report.trail ?? []),
    renderAttachments(report.attachments ?? []),
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
