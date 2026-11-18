export interface BuildInfo { version: string; commit: string; builtAt: string }
declare const __BUILD__: BuildInfo;
/** The build this page was loaded from. */
export const BUILD: BuildInfo = __BUILD__;
/** Shown in the sidebar, e.g. "v1.0.0". */
export const buildLabel = (b: BuildInfo) => "v" + b.version;
/** Commit and build time, for the tooltip. */
export function buildDetail(b: BuildInfo): string {
  const d = new Date(b.builtAt);
  return `Commit ${b.commit} · build ${isNaN(d.getTime()) ? b.builtAt : d.toLocaleString("vi-VN")}`;
}
