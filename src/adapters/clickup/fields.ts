import { isTrackerError } from "../../adapter/errors";
import { asRecord, readRecords, readString } from "../../adapter/http";
import type {
  IssueField,
  IssueFieldKind,
  IssueFieldOption,
  IssueFieldValue,
  IssueFieldValues,
  TrackerContext,
} from "../../adapter/types";
import { request } from "./api";

const CUSTOM_FIELD_PREFIX = "cf:";

/** ClickUp priorities are fixed: 1 urgent … 4 low. */
const PRIORITIES: IssueFieldOption[] = [
  { id: "1", label: "Urgent", color: "#f50000" },
  { id: "2", label: "High", color: "#ffcc00" },
  { id: "3", label: "Normal", color: "#6fddff" },
  { id: "4", label: "Low", color: "#d8d8d8" },
];

const CUSTOM_FIELD_KINDS: Record<string, IssueFieldKind> = {
  drop_down: "select",
  labels: "multi-select",
  short_text: "text",
  text: "text",
  email: "text",
  phone: "text",
  number: "number",
  currency: "number",
  date: "date",
  checkbox: "checkbox",
  url: "url",
};

const optionalString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

const byOrder = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  Number(left.orderindex ?? 0) - Number(right.orderindex ?? 0);

/** Parts of the form that need extra permissions are left out instead of failing the whole form. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (isTrackerError(error) && (error.code === "forbidden" || error.code === "not_found")) return null;
    throw error;
  }
}

function statusField(list: Record<string, unknown>): IssueField | null {
  const statuses = readRecords({ record: list, key: "statuses" }).sort(byOrder);
  if (statuses.length === 0) return null;
  const options = statuses.map((status) => ({
    id: readString({ record: status, key: "status" }),
    label: readString({ record: status, key: "status" }),
    color: optionalString(status.color),
  }));
  const open = statuses.find((status) => status.type === "open") ?? statuses[0];
  return {
    key: "status",
    label: "Status",
    kind: "select",
    required: false,
    options,
    defaultValue: open ? readString({ record: open, key: "status" }) : undefined,
  };
}

function customField(field: Record<string, unknown>): IssueField | null {
  const kind = CUSTOM_FIELD_KINDS[readString({ record: field, key: "type" })];
  if (!kind) return null;
  const config = field.type_config && typeof field.type_config === "object" ? asRecord(field.type_config) : {};
  const options = Array.isArray(config.options)
    ? config.options
        .map(asRecord)
        .sort(byOrder)
        .map((option) => ({
          id: readString({ record: option, key: "id" }),
          label:
            optionalString(option.name) ?? optionalString(option.label) ?? readString({ record: option, key: "id" }),
          color: optionalString(option.color),
        }))
    : undefined;
  return {
    key: `${CUSTOM_FIELD_PREFIX}${readString({ record: field, key: "id" })}`,
    label: readString({ record: field, key: "name" }),
    kind,
    required: field.required === true,
    ...(options ? { options } : {}),
  };
}

export async function listIssueFields({ ctx, listId }: { ctx: TrackerContext; listId: string }): Promise<IssueField[]> {
  const id = encodeURIComponent(listId);
  const list = await request({ ctx, path: `/list/${id}` });
  const spaceId = encodeURIComponent(readString({ record: asRecord(list.space), key: "id" }));

  const [members, space, tags, custom] = await Promise.all([
    optional(() => request({ ctx, path: `/list/${id}/member` })),
    optional(() => request({ ctx, path: `/space/${spaceId}` })),
    optional(() => request({ ctx, path: `/space/${spaceId}/tag` })),
    optional(() => request({ ctx, path: `/list/${id}/field` })),
  ]);

  const fields: IssueField[] = [];
  const status = statusField(list);
  if (status) fields.push(status);

  if (members) {
    fields.push({
      key: "assignees",
      label: "Assignees",
      kind: "users",
      required: false,
      options: readRecords({ record: members, key: "members" }).map((member) => ({
        id: readString({ record: member, key: "id" }),
        label: optionalString(member.username) ?? readString({ record: member, key: "email" }),
        color: optionalString(member.color),
      })),
    });
  }

  const features = space?.features && typeof space.features === "object" ? asRecord(space.features) : {};
  const priorities =
    features.priorities && typeof features.priorities === "object" ? asRecord(features.priorities) : {};
  if (priorities.enabled !== false) {
    fields.push({
      key: "priority",
      label: "Priority",
      kind: "select",
      required: false,
      options: PRIORITIES,
    });
  }

  const tagRecords = tags ? readRecords({ record: tags, key: "tags" }) : [];
  if (tagRecords.length > 0) {
    fields.push({
      key: "tags",
      label: "Tags",
      kind: "multi-select",
      required: false,
      options: tagRecords.map((tag) => {
        const name = readString({ record: tag, key: "name" });
        return { id: name, label: name, color: optionalString(tag.tag_bg) };
      }),
    });
  }

  for (const field of custom ? readRecords({ record: custom, key: "fields" }) : []) {
    const described = customField(field);
    if (described) fields.push(described);
  }

  return fields;
}

const asList = (value: IssueFieldValue): string[] => (Array.isArray(value) ? value : [String(value)]);

/** Task body properties for the chosen field values. */
export function taskFields({ fields }: { fields: IssueFieldValues }): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const custom: { id: string; value: IssueFieldValue }[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (key === "status") body.status = String(value);
    else if (key === "assignees") body.assignees = asList(value).map(Number);
    else if (key === "priority") body.priority = Number(value);
    else if (key === "tags") body.tags = asList(value);
    else if (key.startsWith(CUSTOM_FIELD_PREFIX)) custom.push({ id: key.slice(CUSTOM_FIELD_PREFIX.length), value });
  }

  if (custom.length > 0) body.custom_fields = custom;
  return body;
}
