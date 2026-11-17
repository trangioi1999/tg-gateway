export default function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-label="TG Gateway">
      <rect width="64" height="64" rx="15" fill="#1B4FA0" />
      <rect x="10" y="12" width="44" height="7" rx="2" fill="#fff" />
      <rect x="14" y="19" width="8" height="33" fill="#fff" />
      <rect x="42" y="19" width="8" height="33" fill="#fff" />
      <path
        d="M22 44 38 32"
        stroke="#F0A202"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
