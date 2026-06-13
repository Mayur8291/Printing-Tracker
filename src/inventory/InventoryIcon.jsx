const paths = {
  home: (
    <>
      <path d="M3 10.5L10 3l7 7.5" />
      <path d="M5 9v8h10V9" />
    </>
  ),
  box: (
    <>
      <path d="M3 6l7-3 7 3v8l-7 3-7-3V6z" />
      <path d="M3 6l7 3 7-3M10 9v8" />
    </>
  ),
  layers: (
    <>
      <path d="M10 2l8 4-8 4-8-4 8-4z" />
      <path d="M2 10l8 4 8-4M2 14l8 4 8-4" />
    </>
  ),
  shirt: <path d="M6 3l-3 2 1 4h2v8h8V9h2l1-4-3-2-2 1.5a3 3 0 01-4 0L6 3z" />,
  swap: (
    <>
      <path d="M3 7h12M12 4l3 3-3 3" />
      <path d="M17 13H5M8 16l-3-3 3-3" />
    </>
  ),
  cart: (
    <>
      <path d="M2 3h2l2 10h10l2-6H6" />
      <circle cx="8" cy="17" r="1.2" />
      <circle cx="15" cy="17" r="1.2" />
    </>
  ),
  bell: (
    <>
      <path d="M5 8a5 5 0 0110 0v3l1.5 2.5h-13L5 11V8z" />
      <path d="M8 16a2 2 0 004 0" />
    </>
  ),
  truck: (
    <>
      <path d="M2 5h10v8H2zM12 8h4l2 2v3h-6" />
      <circle cx="5.5" cy="14.5" r="1.5" />
      <circle cx="14.5" cy="14.5" r="1.5" />
    </>
  ),
  building: (
    <>
      <path d="M4 17V4h12v13" />
      <path d="M7 8h2M11 8h2M7 11h2M11 11h2M7 14h2M11 14h2" />
      <path d="M2 17h16" />
    </>
  ),
  search: (
    <>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M13 13l4 4" />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" />,
  x: (
    <>
      <path d="M5 5l10 10M15 5L5 15" />
    </>
  ),
  chev_r: <path d="M7 4l5 6-5 6" />,
  chev_d: <path d="M4 7l6 5 6-5" />,
  chev_u: <path d="M4 13l6-5 6 5" />,
  chev_l: <path d="M13 4l-5 6 5 6" />,
  chev_ud: (
    <>
      <path d="M5 8l5-4 5 4M5 12l5 4 5-4" />
    </>
  ),
  filter: <path d="M3 4h14l-5 7v5l-4 2v-7L3 4z" />,
  download: (
    <>
      <path d="M10 3v9M6 9l4 4 4-4M3 16h14" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="15" cy="10" r="1.2" />
    </>
  ),
  check: <path d="M4 10l4 4 8-8" />,
  edit: <path d="M4 14l9-9 3 3-9 9H4v-3z" />,
  arrow_u: (
    <>
      <path d="M10 16V4M5 9l5-5 5 5" />
    </>
  ),
  arrow_d: (
    <>
      <path d="M10 4v12M5 11l5 5 5-5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="6" height="6" />
      <rect x="11" y="3" width="6" height="6" />
      <rect x="3" y="11" width="6" height="6" />
      <rect x="11" y="11" width="6" height="6" />
    </>
  ),
  list: (
    <>
      <path d="M3 5h14M3 10h14M3 15h14" />
    </>
  ),
  bolt: <path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" />,
  star: <path d="M10 2l2.5 5 5.5.8-4 4 1 5.5L10 14.5 5 17.3l1-5.5-4-4L7.5 7z" />,
  map: (
    <>
      <path d="M3 5l5-2 4 2 5-2v12l-5 2-4-2-5 2V5z" />
      <path d="M8 3v12M12 5v12" />
    </>
  ),
  warn: (
    <>
      <path d="M10 2l8 14H2L10 2z" />
      <path d="M10 8v3M10 14v.5" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5M10 6.5v.5" />
    </>
  )
};

export default function InventoryIcon({ name, size = 14, stroke = 1.6, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      {paths[name] || null}
    </svg>
  );
}
