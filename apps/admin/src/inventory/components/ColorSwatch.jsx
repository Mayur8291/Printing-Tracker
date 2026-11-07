import { resolveColorSwatch } from "../inventoryColorUtils";

const SIZE_MAP = {
  xs: { width: 11, height: 11, radius: 2 },
  sm: { width: 14, height: 14, radius: 3 },
  md: { width: 20, height: 20, radius: 4 },
  lg: { width: 44, height: 44, radius: 6 }
};

export default function ColorSwatch({ color, hex, size = "sm", className = "", title }) {
  const swatch = resolveColorSwatch(color, hex);
  const dims = SIZE_MAP[size] || SIZE_MAP.sm;
  const label = title || color || "Color";

  return (
    <span
      className={`swatch${swatch.type === "tipped" ? " swatch--tipped" : ""}${className ? ` ${className}` : ""}`}
      style={{
        width: dims.width,
        height: dims.height,
        borderRadius: dims.radius,
        background: swatch.background
      }}
      title={label}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
    />
  );
}
