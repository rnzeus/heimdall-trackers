import { describe, expect, it } from "vitest";

import { createFakeFetch } from "../../testing/fake-fetch";
import { describeAdapterContract } from "../../testing/contract";
import { clickupAdapter } from ".";

const API = "https://api.clickup.com/api/v2";
const TOKEN = "pk_test";

const routes = {
  [`GET ${API}/user`]: {
    body: { user: { id: 1, username: "QA Lead", email: "qa@example.com" } },
  },
  [`GET ${API}/team`]: { body: { teams: [{ id: "100", name: "Workspace" }] } },
  [`GET ${API}/team/100/space`]: {
    body: { spaces: [{ id: "200", name: "Mobile" }] },
  },
  [`GET ${API}/space/200/folder`]: {
    body: { folders: [{ id: "300", name: "Releases" }] },
  },
  [`GET ${API}/space/200/list`]: {
    body: { lists: [{ id: "400", name: "Inbox" }] },
  },
  [`GET ${API}/folder/300/list`]: {
    body: { lists: [{ id: "500", name: "Bugs" }] },
  },
  [`POST ${API}/list/500/task`]: {
    body: { id: "abc123", url: "https://app.clickup.com/t/abc123" },
  },
  [`POST ${API}/list/400/task`]: {
    body: { id: "def456", url: "https://app.clickup.com/t/def456" },
  },
  [`POST ${API}/task/abc123/attachment`]: { body: { id: "att1" } },
  [`GET ${API}/list/500`]: {
    body: {
      id: "500",
      space: { id: "200" },
      statuses: [
        { status: "done", type: "closed", orderindex: 2, color: "#6bc950" },
        { status: "backlog", type: "open", orderindex: 0, color: "#d3d3d3" },
        {
          status: "in progress",
          type: "custom",
          orderindex: 1,
          color: "#4194f6",
        },
      ],
    },
  },
  [`GET ${API}/list/500/member`]: {
    body: {
      members: [
        { id: 7, username: "Anna" },
        { id: 8, username: null, email: "bob@example.com" },
      ],
    },
  },
  [`GET ${API}/space/200`]: {
    body: { id: "200", features: { priorities: { enabled: true } } },
  },
  [`GET ${API}/space/200/tag`]: {
    body: { tags: [{ name: "bug", tag_bg: "#ff0000" }] },
  },
  [`GET ${API}/list/500/field`]: {
    body: {
      fields: [
        {
          id: "cf1",
          name: "Platform",
          type: "drop_down",
          required: true,
          type_config: {
            options: [
              { id: "o2", name: "Android", orderindex: 1 },
              { id: "o1", name: "iOS", orderindex: 0 },
            ],
          },
        },
        { id: "cf2", name: "Build", type: "short_text" },
        { id: "cf3", name: "Progress", type: "formula" },
      ],
    },
  },
};

describeAdapterContract({
  adapter: clickupAdapter,
  credentials: { token: TOKEN },
  routes,
  target: "list:500",
  attachmentRoute: `POST ${API}/task/abc123/attachment`,
});

describe("clickup adapter", () => {
  const setup = () => {
    const fake = createFakeFetch({ routes });
    return {
      ctx: { credentials: { token: TOKEN }, fetch: fake.fetch },
      calls: fake.calls,
    };
  };

  it("sends the personal token as is", async () => {
    const { ctx, calls } = setup();
    await clickupAdapter.verify({ ctx });
    expect(calls[0]?.headers.get("Authorization")).toBe(TOKEN);
  });

  it("lists folders and folderless lists of a space", async () => {
    const { ctx } = setup();
    const nodes = await clickupAdapter.listTargets({
      ctx,
      parent: "space:200",
    });
    expect(nodes).toEqual([
      {
        id: "folder:300",
        name: "Releases",
        kind: "folder",
        selectable: false,
        hasChildren: true,
      },
      {
        id: "list:400",
        name: "Inbox",
        kind: "list",
        selectable: true,
        hasChildren: false,
      },
    ]);
  });

  it("creates the task with a Markdown description", async () => {
    const { ctx, calls } = setup();
    await clickupAdapter.createIssue({
      ctx,
      target: "list:400",
      report: { title: "Login fails", environment: { sdkVersion: "0.4.0" } },
    });
    const body = (await calls[0]?.json()) as {
      name: string;
      markdown_content: string;
    };
    expect(body.name).toBe("Login fails");
    expect(body.markdown_content).toContain("- **SDK:** 0.4.0");
  });

  it("describes statuses, members, priorities, tags and supported custom fields of a list", async () => {
    const { ctx } = setup();
    const fields = await clickupAdapter.issueFields({
      ctx,
      target: "list:500",
    });

    expect(fields.map((field) => [field.key, field.kind])).toEqual([
      ["status", "select"],
      ["assignees", "users"],
      ["priority", "select"],
      ["tags", "multi-select"],
      ["cf:cf1", "select"],
      ["cf:cf2", "text"],
    ]);
    expect(fields[0]).toMatchObject({
      options: [{ id: "backlog" }, { id: "in progress" }, { id: "done" }],
      defaultValue: "backlog",
    });
    expect(fields[1]?.options?.map((option) => option.label)).toEqual(["Anna", "bob@example.com"]);
    expect(fields[4]).toMatchObject({
      required: true,
      options: [
        { id: "o1", label: "iOS" },
        { id: "o2", label: "Android" },
      ],
    });
  });

  it("leaves out parts of the form the token cannot read", async () => {
    const fake = createFakeFetch({
      routes: {
        ...routes,
        [`GET ${API}/list/500/member`]: { status: 403, body: {} },
      },
    });
    const fields = await clickupAdapter.issueFields({
      ctx: { credentials: { token: TOKEN }, fetch: fake.fetch },
      target: "list:500",
    });
    expect(fields.map((field) => field.key)).not.toContain("assignees");
  });

  it("sends the chosen field values with the task", async () => {
    const { ctx, calls } = setup();
    await clickupAdapter.createIssue({
      ctx,
      target: "list:400",
      report: { title: "Login fails", environment: {} },
      fields: {
        status: "backlog",
        assignees: ["7"],
        priority: "2",
        tags: ["bug"],
        "cf:cf1": "o1",
        unknown: "x",
      },
    });
    const body = (await calls[0]?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "backlog",
      assignees: [7],
      priority: 2,
      tags: ["bug"],
      custom_fields: [{ id: "cf1", value: "o1" }],
    });
    expect(body).not.toHaveProperty("unknown");
  });

  it("rejects a target that is not a list", async () => {
    const { ctx } = setup();
    const error = await clickupAdapter
      .createIssue({
        ctx,
        target: "space:200",
        report: { title: "x", environment: {} },
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "invalid_request" });
  });

  it("uses the ClickUp error text", async () => {
    const fake = createFakeFetch({
      routes: {
        [`GET ${API}/user`]: {
          status: 401,
          body: { err: "Token invalid", ECODE: "OAUTH_025" },
        },
      },
    });
    const error = await clickupAdapter
      .verify({ ctx: { credentials: { token: "bad" }, fetch: fake.fetch } })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "unauthorized",
      status: 401,
      message: "Token invalid",
    });
  });
});
