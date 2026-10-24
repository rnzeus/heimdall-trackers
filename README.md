# @rnzeus/heimdall-trackers

Issue tracker adapters for [Heimdall](https://heimdall.rnzeus.dev) — the debugger for dev and stage builds of React Native apps. A QA engineer captures a failing request in Heimdall, and the adapter turns it into a task with the request, the environment, console errors and the session file attached.

Supported: **ClickUp** (beta). Planned: Jira, Linear, GitHub Issues, GitLab Issues, Asana, Trello (`plannedTrackers`). More trackers are welcome — see [Writing an adapter](#writing-an-adapter).

No runtime dependencies. Adapters get `fetch` from the caller, so the same code runs in Electron main, Node and Cloudflare Workers.

## Install

```sh
yarn add @rnzeus/heimdall-trackers
```

## Usage

```ts
import { clickupAdapter, isTrackerError } from "@rnzeus/heimdall-trackers";

const ctx = { credentials: { token: "pk_…" }, fetch };

const { account } = await clickupAdapter.verify({ ctx });
const workspaces = await clickupAdapter.listTargets({ ctx });
const spaces = await clickupAdapter.listTargets({ ctx, parent: workspaces[0].id });

try {
  const issue = await clickupAdapter.createIssue({
    ctx,
    target: "list:901234",
    report: {
      title: "POST /orders → 500",
      description: "Tapped Pay, nothing happened",
      environment: { app: { id: "com.example.app", version: "1.2.3" }, sdkVersion: "0.4.0" },
      request: { method: "POST", url: "https://api.example.com/orders", status: 500 },
    },
    attachments: [{ name: "session.edda", type: "application/json", data: bytes }],
  });
  console.log(issue.url, issue.failedAttachments);
} catch (error) {
  if (isTrackerError(error) && error.code === "unauthorized") {
    // ask for a new token
  }
}
```

**Mask secrets before building a report** — adapters send it to the tracker as is.

`renderMarkdown({ report })` gives the default Markdown of a report, e.g. for a "Copy bug report" button.

## Writing an adapter

1. Add `src/adapters/<tracker>/index.ts` exporting a `TrackerAdapter`:
   - `id`, `name`, `homepage`; if the tracker is in `src/planned`, take its entry (same `id`) and remove it from there;
   - `logo` — `mono` (single colour, `fill="currentColor"`, shown muted) and `color` (the brand logo from the tracker's official brand kit), static SVG only: hosts render it as an image;
   - `stage` — start with `"beta"`; `"stable"` once it has been checked against the live API;
   - `credentials` — fields of the connection form (token, site URL, …); the host renders the form from them;
   - `origins` — every origin the adapter may call; hosts block everything else (for self-hosted trackers, derive it from the URL field);
   - `verify`, `listTargets` (the hierarchy down to where issues are created);
   - `issueFields` — the fields an issue has in a place (status, assignees, custom fields …) as `IssueField[]`; hosts render the form from them, so nothing is tied to one board; leave out field types you cannot fill;
   - `createIssue` — takes the chosen `fields` keyed by `IssueField.key`;
   - throw `TrackerError` with a fitting `code`; the `requestJson` helper does it for HTTP statuses.
2. Register it in `src/adapters/index.ts` and export it from `src/index.ts`.
3. Add `<tracker>.test.ts` with recorded API responses and run the shared contract:

   ```ts
   describeAdapterContract({ adapter, credentials, routes, target, attachmentRoute });
   ```

   The contract checks the description and logos, credential verification, 401 and network errors, that `target` is reachable through `listTargets`, issue fields, issue creation with attachments and default field values, partial attachment failures and declared origins.
4. `yarn typecheck && yarn knip && yarn dupes && yarn test`, then open a pull request.

To announce a tracker before its adapter exists, add a `TrackerListing` with a `mono` logo to `src/planned`.

Adapters are reviewed and shipped with Heimdall releases; Heimdall does not load adapters at runtime, because they handle tracker tokens.

## License

MIT
