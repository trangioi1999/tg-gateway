import { brandOf, colorBrands } from "../lib/brands";
export default function Brand({
  id: raw,
  size = 22,
}: {
  id: string;
  size?: number;
}) {
  const id = brandOf(raw);
  if (!id)
    return (
      <span className="brand-icon" aria-hidden="true">
        ◇
      </span>
    );
  const url = "/brands/" + id + ".svg";
  return colorBrands.includes(id) ? (
    <img className="brand-icon" src={url} width={size} height={size} alt="" />
  ) : (
    <i
      aria-hidden="true"
      className="brand-icon mono"
      style={{
        width: size,
        height: size,
        maskImage: `url(${url})`,
        WebkitMaskImage: `url(${url})`,
      }}
    />
  );
}
