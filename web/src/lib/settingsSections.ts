/** Settings sections, shown as children of "Cài đặt" in the sidebar (/settings/<id>). */
export const sections = [
  ["general", "Chung", "sliders"],
  ["kiro", "Kiro", "kiro"],
  ["anthropic", "Claude API", "anthropic"],
  ["openrouter", "OpenRouter", "openrouter"],
  ["saving", "Tiết kiệm credit", "scissors"],
  ["budget", "Ngân sách", "wallet"],
  ["connect", "Kết nối & bảo mật", "plug"],
  ["data", "Dữ liệu & log", "database"],
] as const;
export type SectionId = (typeof sections)[number][0];
/** Provider sections appear only once that provider is configured. */
export const providerSections: readonly string[] = ["kiro", "anthropic", "openrouter"];
export function visibleSections(configured: (id: string) => boolean) {
  return sections.filter(([id]) => !providerSections.includes(id) || configured(id));
}
/** Section from /settings/<id>; old #<id> links still work. */
export function currentSection(): SectionId {
  const part = location.pathname.match(/^\/settings\/([a-z-]+)\/?$/)?.[1] ?? location.hash.slice(1);
  return sections.find(([id]) => id === part)?.[0] ?? "general";
}
export const sectionPath = (id: string) => (id === "general" ? "/settings" : "/settings/" + id);
