import { TrackerError } from "../../adapter/errors";
import { asRecord, readRecords, readString, requestJson } from "../../adapter/http";
import type { TargetNode, TrackerContext } from "../../adapter/types";

export const ORIGIN = "https://api.clickup.com";
const API = `${ORIGIN}/api/v2`;

type NodeKind = "workspace" | "space" | "folder" | "list";

const describeError = (body: unknown): string | undefined =>
  body && typeof body === "object" && "err" in body && typeof body.err === "string" ? body.err : undefined;

export const request = ({
  ctx,
  path,
  method,
  body,
  json,
}: {
  ctx: TrackerContext;
  path: string;
  method?: string;
  body?: BodyInit;
  json?: unknown;
}) =>
  requestJson({
    ctx,
    url: `${API}${path}`,
    method,
    headers: {
      Authorization: ctx.credentials.token ?? "",
      ...(json === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: json === undefined ? body : JSON.stringify(json),
    describeError,
  }).then(asRecord);

const toNodes = ({ records, kind }: { records: Record<string, unknown>[]; kind: NodeKind }): TargetNode[] =>
  records.map((record) => ({
    id: `${kind}:${readString({ record, key: "id" })}`,
    name: readString({ record, key: "name" }),
    kind,
    selectable: kind === "list",
    hasChildren: kind !== "list",
  }));

export const listChildren = async ({
  ctx,
  path,
  key,
  kind,
}: {
  ctx: TrackerContext;
  path: string;
  key: string;
  kind: NodeKind;
}): Promise<TargetNode[]> =>
  toNodes({
    records: readRecords({ record: await request({ ctx, path }), key }),
    kind,
  });

export const parseNodeId = (id: string): { kind: string; value: string } => {
  const separator = id.indexOf(":");
  return separator === -1 ? { kind: "", value: id } : { kind: id.slice(0, separator), value: id.slice(separator + 1) };
};

export const invalidTarget = (target: string) =>
  new TrackerError({
    code: "invalid_request",
    message: `Unknown ClickUp target "${target}"`,
  });
