import type { TrackerAdapter } from "../adapter/types";
import { clickupAdapter } from "./clickup";

export const trackerAdapters: readonly TrackerAdapter[] = [clickupAdapter];

export const findTrackerAdapter = ({ id }: { id: string }): TrackerAdapter | undefined =>
  trackerAdapters.find((adapter) => adapter.id === id);
