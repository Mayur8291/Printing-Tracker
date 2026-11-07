import { formatSamplingOrderIdDisplay } from "./samplingOrderUtils";

export default function SamplingOrderIdBadge({ orderId }) {
  const label = formatSamplingOrderIdDisplay(orderId) || "Sampling order";
  return (
    <span className="order-kind-badge order-kind-badge--sampling" title="Sampling order">
      {label}
    </span>
  );
}
