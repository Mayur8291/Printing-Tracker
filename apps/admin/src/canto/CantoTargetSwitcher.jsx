import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultRefreshEnvironment, getCantoTarget, setCantoTarget } from "./target";

export default function CantoTargetSwitcher({ environmentOnly = false }) {
  const target = getCantoTarget();
  const usesDashboard = environmentOnly || target.source === "supabase";
  const selectedEnvironment = usesDashboard ? defaultRefreshEnvironment() : target.environment;
  function change(patch) {
    if (window.confirm("Switch data target? Any unsaved edits will be closed.")) setCantoTarget({ ...target, ...patch });
  }
  return <div className="flex flex-wrap items-center gap-2">
    {!environmentOnly && <Select value={target.source} onValueChange={source => change({ source })}>
      <SelectTrigger className="w-36" aria-label="Scott dashboard data source"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="legacy">Old system</SelectItem><SelectItem value="supabase">Supabase</SelectItem></SelectContent>
    </Select>}
    {usesDashboard ? <div className="flex items-center gap-2" aria-label="Data environment">
      <Badge variant="outline" className={selectedEnvironment === "production" ? "border-amber-500 text-amber-700" : ""}>{selectedEnvironment === "production" ? "Production" : "Staging"}</Badge>
      <span className="text-xs text-muted-foreground">Uses dashboard environment</span>
    </div> : <Select value={selectedEnvironment} onValueChange={value => change({ environment: value })}>
      <SelectTrigger className={selectedEnvironment === "production" ? "w-36 border-amber-500 text-amber-700" : "w-36"} aria-label="Old system environment"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="staging">Staging</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent>
    </Select>}
  </div>;
}
