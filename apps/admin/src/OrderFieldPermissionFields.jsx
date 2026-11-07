import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { EDITABLE_FIELD_OPTIONS } from "./orderViewUtils";

export default function OrderFieldPermissionFields({ permissionDraft, onPermissionChange, idPrefix }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EDITABLE_FIELD_OPTIONS.map((option) => {
          const fieldKey = `can_edit_${option.key}`;
          const id = `${idPrefix}-${fieldKey}`;
          return (
            <div key={fieldKey} className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={Boolean(permissionDraft?.[fieldKey])}
                onCheckedChange={(checked) => onPermissionChange(fieldKey, Boolean(checked))}
              />
              <Label htmlFor={id} className="cursor-pointer text-sm font-normal leading-snug">
                {option.label}
              </Label>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t pt-4">
        <Checkbox
          id={`${idPrefix}-can_create_orders`}
          checked={Boolean(permissionDraft?.can_create_orders)}
          onCheckedChange={(checked) => onPermissionChange("can_create_orders", Boolean(checked))}
        />
        <Label
          htmlFor={`${idPrefix}-can_create_orders`}
          className="cursor-pointer text-sm font-medium leading-none"
        >
          Create new order
        </Label>
      </div>
    </div>
  );
}
