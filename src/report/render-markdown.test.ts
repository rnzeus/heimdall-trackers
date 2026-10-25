import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./render-markdown";
import type { BugReport } from "./types";

const report: BugReport = {
  title: "Checkout fails",
  description: "Tapped Pay, spinner forever",
  environment: {
    app: {
      id: "com.example.app",
      version: "1.2.3",
      build: "45",
      environment: "stage",
    },
    device: { name: "iPhone 17 Pro", os: "iOS", osVersion: "26.0" },
    sdkVersion: "0.4.0",
    reporter: { name: "Heimdall", version: "0.4.0" },
  },
  events: [
    {
      kind: "request",
      note: "Pay button",
      method: "post",
      url: "https://api.example.com/orders",
      status: 500,
      durationMs: 812.4,
      requestHeaders: {
        Authorization: "•••",
        "Content-Type": "application/json",
      },
      responseBody: '{"error":"internal"}',
      curl: "curl -X POST 'https://api.example.com/orders'",
    },
    { kind: "log", level: "error", ts: Date.UTC(2026, 9, 22, 12, 3, 14), message: "Cannot read total" },
    {
      kind: "socket",
      url: "wss://rt.example.com",
      ts: Date.UTC(2026, 9, 22, 12, 3, 16),
      phase: "frame",
      direction: "in",
      data: '{"type":"order.failed"}',
    },
    {
      kind: "state",
      store: "cart",
      action: "checkout/fail",
      ts: Date.UTC(2026, 9, 22, 12, 3, 17),
      changes: [{ key: "status", before: '"paying"', after: '"failed"' }],
    },
  ],
  moment: {
    ts: Date.UTC(2026, 9, 22, 12, 3, 20),
    range: { from: Date.UTC(2026, 9, 22, 12, 2, 20), to: Date.UTC(2026, 9, 22, 12, 3, 50) },
  },
  signals: {
    total: 3,
    items: [
      {
        kind: "request",
        ts: Date.UTC(2026, 9, 22, 12, 3, 13),
        method: "post",
        url: "https://api.example.com/orders",
        status: 500,
      },
      { kind: "log", level: "error", ts: Date.UTC(2026, 9, 22, 12, 3, 15), message: "Payment failed\nat pay()" },
    ],
  },
  trail: [
    { kind: "socket", url: "wss://rt.example.com", ts: Date.UTC(2026, 9, 22, 12, 3, 1), phase: "close", code: 1006 },
    {
      kind: "state",
      store: "cart",
      ts: Date.UTC(2026, 9, 22, 12, 3, 2),
      changes: [{ key: "items" }, { key: "total" }],
    },
  ],
  attachments: ["session.edda", "requests.har"],
};

describe("renderMarkdown", () => {
  it("renders every section of a full report", () => {
    const markdown = renderMarkdown({ report });

    expect(markdown.startsWith("Tapped Pay, spinner forever\n\n### When")).toBe(true);
    expect(markdown).toContain("- **App:** com.example.app 1.2.3 (45), stage");
    expect(markdown).toContain("- **Device:** iPhone 17 Pro · iOS 26.0");
    expect(markdown).toContain("- **SDK:** 0.4.0");
    expect(markdown).toContain(
      "### Request\n\n> Pay button\n\n**POST** `https://api.example.com/orders` · **500** · 812 ms",
    );
    expect(markdown).toContain("```http\nAuthorization: •••\nContent-Type: application/json\n```");
    expect(markdown).toContain('```json\n{"error":"internal"}\n```');
    expect(markdown).toContain("```bash\ncurl -X POST");
    expect(markdown).toContain("### Console\n\n```\n2026-10-22T12:03:14.000Z ERROR Cannot read total\n```");
    expect(markdown).toContain('**frame received** `wss://rt.example.com`\n\n```json\n{"type":"order.failed"}\n```');
    expect(markdown).toContain('**cart** · `checkout/fail`\n\n```diff\n- status: "paying"\n+ status: "failed"\n```');
    expect(markdown).toContain("### When\n\nReported at 12:03:20 UTC · covers 12:02:20–12:03:50");
    expect(markdown).toContain(
      "### Found automatically (2 of 3)\n\n- `12:03:13` **POST** `https://api.example.com/orders` · **500**\n- `12:03:15` **ERROR** Payment failed",
    );
    expect(markdown).toContain(
      "### Last activity\n\n- `12:03:01` **close** `wss://rt.example.com` · code 1006\n- `12:03:02` **cart** · items, total",
    );
    expect(markdown).toContain(
      "### Attachments\n\n- `session.edda`\n- `requests.har`\n\nOpen the `.edda` file in Heimdall to see every event.",
    );
    expect(markdown.endsWith("---\n_Reported with Heimdall 0.4.0_")).toBe(true);
  });

  it("omits empty sections", () => {
    expect(renderMarkdown({ report: { title: "Empty", environment: {} } })).toBe("");
  });

  it("keeps code fences longer than backticks inside the content", () => {
    const markdown = renderMarkdown({
      report: {
        title: "x",
        environment: {},
        events: [{ kind: "request", method: "GET", url: "https://x.dev", responseBody: "a ``` b" }],
      },
    });
    expect(markdown).toContain("````\na ``` b\n````");
  });

  it("truncates long bodies", () => {
    const markdown = renderMarkdown({
      report: {
        title: "x",
        environment: {},
        events: [{ kind: "request", method: "GET", url: "https://x.dev", responseBody: "a".repeat(20) }],
      },
      maxBodyChars: 5,
    });
    expect(markdown).toContain("aaaaa\n… (truncated, 15 more characters)");
  });
});
