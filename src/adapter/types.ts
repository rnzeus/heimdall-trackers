import type { BugReport } from "../report/types";

/** A field of the connection form; the host renders the form from this description. */
export type CredentialField = {
  key: string;
  label: string;
  kind: "secret" | "url" | "text";
  placeholder?: string;
  help?: string;
  helpUrl?: string;
};

export type Credentials = Readonly<Record<string, string>>;

/** `fetch` is injected: the same adapter runs in Electron main and in a Cloudflare Worker. */
export type TrackerContext = {
  credentials: Credentials;
  fetch: typeof fetch;
};

/** A node of the tracker hierarchy (workspace → space → list, project → issue type, …). */
export type TargetNode = {
  id: string;
  name: string;
  kind: string;
  /** issues can be created here */
  selectable: boolean;
  hasChildren: boolean;
};

export type IssueAttachment = {
  name: string;
  type: string;
  data: Uint8Array;
};

export type CreatedIssue = {
  id: string;
  url: string;
  /** names of attachments that failed to upload; the issue itself exists */
  failedAttachments: string[];
};

/**
 * Logos are SVG markup. Hosts must render them as images (`<img>`, CSS mask), never inline them into the DOM.
 * `mono` is a single-colour mark with `fill="currentColor"` for muted states; `color` is the brand logo.
 */
export type TrackerLogo = {
  mono: string;
  color?: string;
};

/** What a host needs to show a tracker, available or planned. */
export type TrackerListing = {
  /** kebab-case, stable: hosts store connections under it */
  id: string;
  name: string;
  homepage: string;
  logo: TrackerLogo;
};

export type IssueFieldKind = "select" | "multi-select" | "users" | "text" | "number" | "date" | "checkbox" | "url";

export type IssueFieldOption = { id: string; label: string; color?: string };

/**
 * A field of an issue in one place of the tracker (status, assignees, a custom field, …); the host renders
 * the form from it. Values: `select` → option id, `multi-select` / `users` → option ids, `date` → epoch ms.
 */
export type IssueField = {
  /** stable within the place; the host sends values back under it */
  key: string;
  label: string;
  kind: IssueFieldKind;
  required: boolean;
  options?: IssueFieldOption[];
  defaultValue?: IssueFieldValue;
};

export type IssueFieldValue = string | number | boolean | string[];

export type IssueFieldValues = Readonly<Record<string, IssueFieldValue>>;

/** `beta` adapters work but have not been checked against the live API in every scenario; hosts may hide them. */
export type TrackerStage = "stable" | "beta";

export type TrackerAdapter = TrackerListing & {
  stage: TrackerStage;
  credentials: readonly CredentialField[];
  /** every origin the adapter may request with these credentials; hosts block the rest */
  origins: (params: { credentials: Credentials }) => string[];
  verify: (params: { ctx: TrackerContext }) => Promise<{ account: string }>;
  /** children of `parent`, or the top level without it */
  listTargets: (params: { ctx: TrackerContext; parent?: string }) => Promise<TargetNode[]>;
  /** fields an issue can have in `target`; field types the adapter cannot fill are left out */
  issueFields: (params: { ctx: TrackerContext; target: string }) => Promise<IssueField[]>;
  createIssue: (params: {
    ctx: TrackerContext;
    target: string;
    report: BugReport;
    attachments?: readonly IssueAttachment[];
    /** values keyed by `IssueField.key`; unknown keys are ignored */
    fields?: IssueFieldValues;
  }) => Promise<CreatedIssue>;
};
