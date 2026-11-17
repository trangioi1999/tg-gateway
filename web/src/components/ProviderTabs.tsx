import type { ProviderQuota } from "../../../src/dashboard/contract";
import Brand from "./Brand";
import { providerLabel } from "../lib/brands";
export default function ProviderTabs({
  providers,
  value,
  onChange,
  active = [],
  loading = false,
}: {
  /** Providers with traffic in the selected period: shown even when not configured. */
  active?: string[];
  loading?: boolean;
  providers: ProviderQuota[];
  value: string;
  onChange: (id: string) => void;
}) {
  const shown = new Set([...active, value]);
  const ids: string[] = providers.filter((p) => p.configured || shown.has(p.id)).map((p) => p.id);
  for (const id of shown) if (id && !ids.includes(id)) ids.push(id);
  return (
    <div className={loading ? "ptabs refetching" : "ptabs"} role="group" aria-label="Nhà cung cấp">
      {["", ...ids].map(
        (id) => (
          <button
            className="ptab"
            key={id}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            {id ? <Brand id={id} /> : <span>∑</span>}
            {id ? providerLabel(id) : "Tất cả"}
          </button>
        ),
      )}
    </div>
  );
}
