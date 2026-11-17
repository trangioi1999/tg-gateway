export default function Switch({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <input
      className="sw"
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
