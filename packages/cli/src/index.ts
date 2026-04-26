export type PlannedCliOption =
  | "--llm"
  | "--since"
  | "--share"
  | "--json"
  | "--privacy";

export const PLANNED_CLI_OPTIONS: readonly PlannedCliOption[] = [
  "--llm",
  "--since",
  "--share",
  "--json",
  "--privacy",
] as const;

export { main, parseArgs } from "./stupify";
