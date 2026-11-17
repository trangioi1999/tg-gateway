import type {
  OverviewResponse,
  ProviderQuota,
} from "../../../../src/dashboard/contract";
export type Settings = OverviewResponse["settings"];
export type SettingsDraft = { [K in keyof Settings]: Settings[K] extends number ? number | "" : Settings[K] };
export type NumericSetting = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
export interface SettingsResponse {
  settings: Settings;
  secrets: Record<string, boolean>;
}
export interface SectionProps {
  draft: SettingsDraft;
  /** Last saved settings (to describe what saving the draft will do). */
  saved?: Settings;
  set: <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void;
  secrets: Record<string, boolean>;
  providers: ProviderQuota[];
}
