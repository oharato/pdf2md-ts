import type { PageBlockPlugin } from "./types.js";
import { candidateHistoryBlockPlugin } from "./postprocess/candidateHistoryBlockPlugin.js";
import { detachedOfficerTextBlockPlugin } from "./postprocess/detachedOfficerTextBlockPlugin.js";

/**
 * Default block-level post-processors applied after generic render normalization.
 * Order matters: officer reconstruction can feed candidate-history normalization.
 */
export const defaultPageBlockPlugins: PageBlockPlugin[] = [
  detachedOfficerTextBlockPlugin,
  candidateHistoryBlockPlugin,
];
