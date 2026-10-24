import { asRecord, readString } from "../../adapter/http";
import type { CreatedIssue, IssueAttachment, TrackerAdapter, TrackerContext } from "../../adapter/types";
import { renderMarkdown } from "../../report/render-markdown";
import { invalidTarget, listChildren, ORIGIN, parseNodeId, request } from "./api";
import { listIssueFields, taskFields } from "./fields";
import { clickupLogo } from "./logo";

async function uploadAttachment({
  ctx,
  taskId,
  attachment,
}: {
  ctx: TrackerContext;
  taskId: string;
  attachment: IssueAttachment;
}): Promise<void> {
  const form = new FormData();
  form.append("attachment", new Blob([new Uint8Array(attachment.data)], { type: attachment.type }), attachment.name);
  await request({
    ctx,
    path: `/task/${encodeURIComponent(taskId)}/attachment`,
    method: "POST",
    body: form,
  });
}

export const clickupAdapter: TrackerAdapter = {
  id: "clickup",
  name: "ClickUp",
  homepage: "https://clickup.com",
  logo: clickupLogo,
  stage: "beta",
  credentials: [
    {
      key: "token",
      label: "Personal API token",
      kind: "secret",
      placeholder: "pk_…",
      help: "ClickUp → Settings → Apps → API Token",
      helpUrl: "https://app.clickup.com/settings/apps",
    },
  ],

  origins: () => [ORIGIN],

  async verify({ ctx }) {
    const user = asRecord((await request({ ctx, path: "/user" })).user);
    const username = user.username;
    return {
      account: typeof username === "string" && username ? username : readString({ record: user, key: "email" }),
    };
  },

  async listTargets({ ctx, parent }) {
    if (parent === undefined)
      return listChildren({
        ctx,
        path: "/team",
        key: "teams",
        kind: "workspace",
      });

    const { kind, value } = parseNodeId(parent);
    const id = encodeURIComponent(value);
    switch (kind) {
      case "workspace":
        return listChildren({
          ctx,
          path: `/team/${id}/space?archived=false`,
          key: "spaces",
          kind: "space",
        });
      case "space": {
        const [folders, lists] = await Promise.all([
          listChildren({
            ctx,
            path: `/space/${id}/folder?archived=false`,
            key: "folders",
            kind: "folder",
          }),
          listChildren({
            ctx,
            path: `/space/${id}/list?archived=false`,
            key: "lists",
            kind: "list",
          }),
        ]);
        return [...folders, ...lists];
      }
      case "folder":
        return listChildren({
          ctx,
          path: `/folder/${id}/list?archived=false`,
          key: "lists",
          kind: "list",
        });
      default:
        throw invalidTarget(parent);
    }
  },

  async issueFields({ ctx, target }) {
    const { kind, value } = parseNodeId(target);
    if (kind !== "list") throw invalidTarget(target);
    return listIssueFields({ ctx, listId: value });
  },

  async createIssue({ ctx, target, report, attachments = [], fields = {} }): Promise<CreatedIssue> {
    const { kind, value } = parseNodeId(target);
    if (kind !== "list") throw invalidTarget(target);

    const task = await request({
      ctx,
      path: `/list/${encodeURIComponent(value)}/task`,
      method: "POST",
      json: {
        ...taskFields({ fields }),
        name: report.title,
        markdown_content: renderMarkdown({ report }),
      },
    });
    const taskId = readString({ record: task, key: "id" });

    const failedAttachments: string[] = [];
    for (const attachment of attachments) {
      try {
        await uploadAttachment({ ctx, taskId, attachment });
      } catch {
        failedAttachments.push(attachment.name);
      }
    }

    return {
      id: taskId,
      url: readString({ record: task, key: "url" }),
      failedAttachments,
    };
  },
};
