import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useInventory } from "../InventoryDataContext";
import { MovementTypeBadge, PageHeader } from "../inventoryUiUtils";

export default function InventoryMovementsPage({ openNewSku }) {
  const { movements, movementsLoading } = useInventory();
  const [type, setType] = useState("all");
  const filtered = type === "all" ? movements : movements.filter((m) => m.type === type);

  const tabs = ["all", "IN", "OUT", "TRANSFER", "ADJUST"];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock movements"
        subtitle="Immutable audit log · last 28 events shown."
        actions={
          <>
            <Button type="button" variant="outline" size="sm">
              Export CSV
            </Button>
            <Button type="button" size="sm" onClick={() => openNewSku?.("fabric")}>
              New SKU
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
            <Tabs value={type} onValueChange={setType}>
              <ScrollArea className="w-full">
                <TabsList className="h-auto w-max">
                  {tabs.map((t) => (
                    <TabsTrigger key={t} value={t} className="gap-1.5">
                      {t === "all" ? "All" : t}
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                        {t === "all" ? movements.length : movements.filter((m) => m.type === t).length}
                      </Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </Tabs>
            <div className="sm:ml-auto sm:w-64">
              <Input placeholder="Search SKU, user, ref…" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>From → To</TableHead>
                  <TableHead>User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movementsLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Loading movements…
                    </TableCell>
                  </TableRow>
                ) : (
                filtered.map((m) => {
                  const dt = new Date(m.ts);
                  const initials = m.user
                    .split(" ")
                    .map((n) => n[0])
                    .join("");
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="text-sm">{dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                        <div className="text-xs text-muted-foreground">
                          {dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <MovementTypeBadge type={m.type} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{m.skuName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{m.sku}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={cn("font-medium", m.qty > 0 ? "text-emerald-600" : "text-red-600")}>
                          {m.qty > 0 ? "+" : ""}
                          {m.qty.toLocaleString()} {m.unit}
                        </span>
                      </TableCell>
                      <TableCell>{m.reason}</TableCell>
                      <TableCell className="font-mono text-xs">{m.ref}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {m.type === "TRANSFER" ? `${m.fromWh} → ${m.toWh}` : m.fromWh}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <Avatar className="size-5">
                            <AvatarFallback className="bg-primary/10 text-[9px] text-primary">{initials}</AvatarFallback>
                          </Avatar>
                          {m.user}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
