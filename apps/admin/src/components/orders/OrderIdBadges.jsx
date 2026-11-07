import { Badge } from "@/components/ui/badge";
import { splitOrderIds } from "@/orderViewUtils";

export default function OrderIdBadges({ orderId }) {
  const ids = splitOrderIds(orderId);
  if (!ids.length) return "—";
  if (ids.length === 1) {
    return <span className="font-medium text-foreground">{ids[0]}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1" aria-label="Order IDs">
      {ids.map((id) => (
        <Badge key={id} variant="secondary" className="font-normal" title={id}>
          {id}
        </Badge>
      ))}
    </span>
  );
}
