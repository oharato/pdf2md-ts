import type { BorderlessTablePlugin } from "./types.js";
import { officerBorderlessTablePlugin } from "./borderless/officerBorderlessTablePlugin.js";

export const defaultBorderlessTablePlugins: BorderlessTablePlugin[] = [
  officerBorderlessTablePlugin,
];
