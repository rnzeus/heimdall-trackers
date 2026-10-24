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
  request: {
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
  console: [
    {
      level: "error",
      ts: Date.UTC(2026, 9, 22, 12, 3, 15),
      message: "Payment failed",
      stack: "at pay()",
    },
  ],
};

describe("renderMarkdown", () => {
  it("renders every section of a full report", () => {
    const markdown = renderMarkdown({ report });

    expect(markdown.startsWith("Tapped Pay, spinner forever\n\n### Environment")).toBe(true);
    expect(markdown).toContain("- **App:** com.example.app 1.2.3 (45), stage");
    expect(markdown).toContain("- **Device:** iPhone 17 Pro · iOS 26.0");
    expect(markdown).toContain("- **SDK:** 0.4.0");
    expect(markdown).toContain("**POST** `https://api.example.com/orders` · **500** · 812 ms");
    expect(markdown).toContain("```http\nAuthorization: •••\nContent-Type: application/json\n```");
    expect(markdown).toContain('```json\n{"error":"internal"}\n```');
    expect(markdown).toContain("```bash\ncurl -X POST");
    expect(markdown).toContain("2026-10-22T12:03:15.000Z ERROR Payment failed\nat pay()");
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
        request: {
          method: "GET",
          url: "https://x.dev",
          responseBody: "a ``` b",
        },
      },
    });
    expect(markdown).toContain("````\na ``` b\n````");
  });

  it("truncates long bodies", () => {
    const markdown = renderMarkdown({
      report: {
        title: "x",
        environment: {},
        request: {
          method: "GET",
          url: "https://x.dev",
          responseBody: "a".repeat(20),
        },
      },
      maxBodyChars: 5,
    });
    expect(markdown).toContain("aaaaa\n… (truncated, 15 more characters)");
  });
});
