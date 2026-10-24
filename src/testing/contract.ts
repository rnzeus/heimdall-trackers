import { describe, expect, it } from "vitest";

import { isTrackerError } from "../adapter/errors";
import type { Credentials, TargetNode, TrackerAdapter, TrackerContext, TrackerListing } from "../adapter/types";
import type { BugReport } from "../report/types";
import type { FakeRoutes } from "./fake-fetch";
import { createFakeFetch } from "./fake-fetch";

/** What an adapter provides to run the shared contract: recorded API responses of a happy path. */
export type AdapterFixture = {
  adapter: TrackerAdapter;
  credentials: Credentials;
  routes: FakeRoutes;
  /** a selectable target reachable from the top level through `listTargets` */
  target: string;
  /** route key of the attachment upload */
  attachmentRoute: string;
};

const MAX_DEPTH = 6;
const FIELD_KINDS = ["select", "multi-select", "users", "text", "number", "date", "checkbox", "url"];
const MAX_LOGO_BYTES = 8 * 1024;

/** Hosts render logos as images, so they must be plain static SVG: no scripts, handlers or outside references. */
function expectSafeSvg(svg: string): void {
  expect(svg.trim()).toMatch(/^<svg[\s>][\s\S]*<\/svg>$/);
  expect(svg).toMatch(/viewBox="[^"]+"/);
  expect(new TextEncoder().encode(svg).byteLength).toBeLessThanOrEqual(MAX_LOGO_BYTES);
  expect(svg).not.toMatch(/<(script|foreignObject|image|style|iframe|a)[\s>]/i);
  expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
  expect(svg).not.toMatch(/href\s*=\s*"(?!#)/i);
  expect(svg).not.toMatch(/url\((?!#)/i);
}

/** Checks what hosts show for a tracker; adapters must ship a brand logo too. */
export function expectValidListing({ listing, brandLogo }: { listing: TrackerListing; brandLogo: boolean }): void {
  expect(listing.id).toMatch(/^[a-z][a-z0-9-]*$/);
  expect(listing.name).not.toBe("");
  expect(listing.homepage).toMatch(/^https:\/\//);
  expectSafeSvg(listing.logo.mono);
  expect(listing.logo.mono).toContain("currentColor");
  if (brandLogo) expect(listing.logo.color).toBeDefined();
  if (listing.logo.color !== undefined) expectSafeSvg(listing.logo.color);
}

const report: BugReport = {
  title: "Checkout fails with 500",
  description: "Tapped Pay, nothing happened",
  environment: {
    app: { id: "com.example.app", version: "1.2.3" },
    reporter: { name: "Heimdall", version: "0.0.0" },
  },
  events: [{ kind: "request", method: "POST", url: "https://api.example.com/orders", status: 500 }],
};

const attachment = {
  name: "session.edda",
  type: "application/json",
  data: new TextEncoder().encode("{}"),
};

const contextFor = ({ fixture, routes }: { fixture: AdapterFixture; routes: FakeRoutes }) => {
  const fake = createFakeFetch({ routes });
  const ctx: TrackerContext = {
    credentials: fixture.credentials,
    fetch: fake.fetch,
  };
  return { ctx, calls: fake.calls };
};

const failEverything = ({ routes, status }: { routes: FakeRoutes; status: number }): FakeRoutes =>
  Object.fromEntries(Object.keys(routes).map((key) => [key, { status, body: { message: "failed" } }]));

async function collectTargets({ adapter, ctx }: { adapter: TrackerAdapter; ctx: TrackerContext }) {
  const found = new Map<string, TargetNode>();
  let level = await adapter.listTargets({ ctx });
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    level.forEach((node) => found.set(node.id, node));
    const children = await Promise.all(
      level.filter((node) => node.hasChildren).map((node) => adapter.listTargets({ ctx, parent: node.id })),
    );
    level = children.flat();
  }
  return found;
}

export function describeAdapterContract(fixture: AdapterFixture): void {
  const { adapter } = fixture;

  const loadFields = async () => {
    const { ctx } = contextFor({ fixture, routes: fixture.routes });
    return { ctx, fields: await adapter.issueFields({ ctx, target: fixture.target }) };
  };

  describe(`${adapter.id} adapter contract`, () => {
    it("describes itself", () => {
      expectValidListing({ listing: adapter, brandLogo: true });
      expect(["stable", "beta"]).toContain(adapter.stage);
      expect(adapter.credentials.length).toBeGreaterThan(0);
      const keys = adapter.credentials.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(Object.keys(fixture.credentials).sort()).toEqual([...keys].sort());
    });

    it("verifies credentials", async () => {
      const { ctx } = contextFor({ fixture, routes: fixture.routes });
      const { account } = await adapter.verify({ ctx });
      expect(account).not.toBe("");
    });

    it("maps 401 to an unauthorized TrackerError", async () => {
      const { ctx } = contextFor({
        fixture,
        routes: failEverything({ routes: fixture.routes, status: 401 }),
      });
      const error = await adapter.verify({ ctx }).catch((caught: unknown) => caught);
      expect(isTrackerError(error) && error.code).toBe("unauthorized");
    });

    it("maps a failed fetch to a network TrackerError", async () => {
      const ctx: TrackerContext = {
        credentials: fixture.credentials,
        fetch: () => Promise.reject(new TypeError("fetch failed")),
      };
      const error = await adapter.verify({ ctx }).catch((caught: unknown) => caught);
      expect(isTrackerError(error) && error.code).toBe("network");
    });

    it("reaches the target through listTargets", async () => {
      const { ctx } = contextFor({ fixture, routes: fixture.routes });
      const targets = await collectTargets({ adapter, ctx });
      expect(targets.get(fixture.target)?.selectable).toBe(true);
      for (const node of targets.values()) expect(node.name).not.toBe("");
    });

    it("creates an issue with the report title and attachments", async () => {
      const { ctx, calls } = contextFor({ fixture, routes: fixture.routes });
      const issue = await adapter.createIssue({
        ctx,
        target: fixture.target,
        report,
        attachments: [attachment],
      });

      expect(issue.id).not.toBe("");
      expect(issue.url).toMatch(/^https:\/\//);
      expect(issue.failedAttachments).toEqual([]);
      const bodies = await Promise.all(calls.map((call) => call.clone().text()));
      expect(bodies.some((body) => body.includes(report.title))).toBe(true);
    });

    it("keeps the issue when an attachment fails", async () => {
      const routes = {
        ...fixture.routes,
        [fixture.attachmentRoute]: { status: 500, body: { message: "failed" } },
      };
      const { ctx } = contextFor({ fixture, routes });
      const issue = await adapter.createIssue({
        ctx,
        target: fixture.target,
        report,
        attachments: [attachment],
      });
      expect(issue.failedAttachments).toEqual([attachment.name]);
    });

    it("describes the issue fields of the target", async () => {
      const { ctx, fields } = await loadFields();

      const keys = fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const field of fields) {
        expect(field.label).not.toBe("");
        expect(FIELD_KINDS).toContain(field.kind);
        if (field.kind === "select" || field.kind === "multi-select" || field.kind === "users") {
          expect(Array.isArray(field.options)).toBe(true);
        }
        if (field.kind === "select" && field.defaultValue !== undefined) {
          expect(field.options?.map((option) => option.id)).toContain(field.defaultValue);
        }
      }
    });

    it("creates an issue with the default field values", async () => {
      const { ctx, fields } = await loadFields();
      const defaults = Object.fromEntries(
        fields.flatMap((field) => (field.defaultValue === undefined ? [] : [[field.key, field.defaultValue]])),
      );
      const issue = await adapter.createIssue({
        ctx,
        target: fixture.target,
        report,
        fields: defaults,
      });
      expect(issue.id).not.toBe("");
    });

    it("requests only declared origins", async () => {
      const { ctx, calls } = contextFor({ fixture, routes: fixture.routes });
      await adapter.verify({ ctx });
      await collectTargets({ adapter, ctx });
      await adapter.issueFields({ ctx, target: fixture.target });
      await adapter.createIssue({
        ctx,
        target: fixture.target,
        report,
        attachments: [attachment],
      });

      const origins = adapter.origins({ credentials: fixture.credentials });
      for (const call of calls) expect(origins).toContain(new URL(call.url).origin);
    });
  });
}
