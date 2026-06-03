import { BRAND_LOGO_URL } from "./outwardChallanUtils";

export default function OcLabelBrandHeader() {
  return (
    <div className="oc-label-brand">
      <img src={BRAND_LOGO_URL} alt="Scott International logo" width={56} height={56} />
      <span className="oc-label-brand-name">Scott International</span>
    </div>
  );
}
