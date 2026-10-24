import { describe, expect, it } from "vitest";

import { plannedTrackers } from "../planned";
import { expectValidListing } from "../testing/contract";
import { trackerAdapters } from ".";

describe("tracker registry", () => {
  it("keeps ids unique across available and planned trackers", () => {
    const ids = [...trackerAdapters, ...plannedTrackers].map((listing) => listing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(plannedTrackers.map((listing) => [listing.id, listing] as const))("describes planned %s", (_, listing) => {
    expectValidListing({ listing, brandLogo: false });
  });
});
