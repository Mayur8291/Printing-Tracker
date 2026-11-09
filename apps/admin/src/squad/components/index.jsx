import { cloneElement, isValidElement, useId } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Inbox, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SquadDialogContent as DialogContent } from './SquadDialogContent';
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, actions, children }) {
  return <header className="squad-page-header"><div className="squad-page-heading"><div>{eyebrow && <p className="squad-eyebrow mb-2">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="squad-page-description">{description}</p>}</div>{actions && <div className="squad-page-actions">{actions}</div>}</div>{children}</header>;
}
export function SectionCard({ title, description, actions, children, className }) {
  return <section className={cn("squad-card", className)}>{(title || actions) && <div className="squad-card-heading"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}</div>}<div className="squad-card-body">{children}</div></section>;
}
export function MetricCard({ label, value, description, icon: Icon }) {
  return <div className="squad-metric"><div className="flex items-center justify-between gap-3"><p>{label}</p>{Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}</div><strong>{value ?? "—"}</strong>{description && <span>{description}</span>}</div>;
}
export function StatusBadge({ children, tone = "neutral" }) { return <span className={cn("squad-status", `squad-status-${["neutral", "success", "warning", "danger", "info"].includes(tone) ? tone : "neutral"}`)}>{children}</span>; }
export function ResourceState({ status = "empty", title, description, error, onRetry, action }) {
  const Icon = status === "loading" ? LoaderCircle : status === "error" ? AlertCircle : status === "denied" ? LockKeyhole : Inbox;
  const labels = { loading: "Loading your workspace", empty: "Nothing to show yet", error: "We couldn’t load this", denied: "This page is not available to your account" };
  return <div className="squad-resource-state" role={status === "error" ? "alert" : "status"} aria-busy={status === "loading"}><div className={cn("squad-state-icon", status === "error" && "text-destructive")}><Icon className={cn("size-6", status === "loading" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" /></div><h2>{title || labels[status] || labels.empty}</h2>{(description || error) && <p>{description || (typeof error === "string" ? error : "Please try again. If the problem continues, contact your administrator.")}</p>}<div className="flex flex-wrap justify-center gap-2">{onRetry && <Button type="button" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 size-4" />Try again</Button>}{action}</div></div>;
}
export function DataTable({ columns = [], rows = [], getRowKey = (row) => row.id, emptyMessage = "No matching records", onRowClick, caption }) {
  return <div className="squad-table-scroll" role="region" tabIndex={0} aria-label={caption || "Records table"}><table data-shadcn-table className="squad-table">{caption && <caption className="sr-only">{caption}</caption>}<thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={column.align === "right" ? "text-right" : undefined}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={getRowKey(row) ?? index}>{columns.map((column, columnIndex) => { const value = column.render ? column.render(row[column.key], row) : row[column.key] ?? "—"; return <td key={column.key} className={column.align === "right" ? "text-right tabular-nums" : undefined}>{onRowClick && columnIndex === 0 ? <button type="button" onClick={() => onRowClick(row)} className="squad-record-link">{value}</button> : value}</td>; })}</tr>) : <tr><td colSpan={Math.max(columns.length, 1)} className="squad-table-empty">{emptyMessage}</td></tr>}</tbody></table></div>;
}
export function Pagination({ page = 1, hasNext, onPrevious, onNext, loading, description }) { return <nav aria-label="Table pagination" className="squad-pagination"><span>{description || `Page ${page}`}</span><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={onPrevious}><ArrowLeft className="mr-1.5 size-3.5" />Previous</Button><Button type="button" variant="outline" size="sm" disabled={loading || !hasNext} onClick={onNext}>Next<ArrowRight className="ml-1.5 size-3.5" /></Button></div></nav>; }
export function Field({ label, hint, error, children, required, className }) {
  const generated = useId();
  const id = isValidElement(children) ? children.props.id || generated : generated;
  const messageId = `${id}-message`;
  return <div className={cn("squad-field", className)}><label htmlFor={id}>{label}{required && <span aria-hidden="true" className="ml-1 text-destructive">*</span>}</label>{isValidElement(children) ? cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": (error || hint) ? messageId : undefined, required: required || children.props.required }) : children}{(error || hint) && <p id={messageId} className={error ? "text-destructive" : "text-muted-foreground"}>{error || hint}</p>}</div>;
}
export function CommandDialog({ open, onOpenChange, title, description, children, onSubmit, submitLabel = "Save changes", pending, error, destructive, disabled }) {
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) onOpenChange?.(value); }}><DialogContent className="squad-dialog flex max-h-[90dvh] flex-col overflow-hidden"><DialogHeader className="shrink-0"><DialogTitle>{title}</DialogTitle><DialogDescription>{description || "Review the details before saving."}</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); if (!pending && !disabled) onSubmit?.(event); }} className="flex min-h-0 flex-col"><div className="-mx-1 space-y-5 overflow-y-auto px-1 py-1">{children}{error && <div role="alert" className="squad-inline-error"><AlertCircle className="size-4 shrink-0" />{typeof error === "string" ? error : error.message || "The change could not be saved."}</div>}</div><DialogFooter className="mt-5 shrink-0"><Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange?.(false)}>Cancel</Button><Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending || disabled}>{pending && <LoaderCircle className="mr-2 size-4 animate-spin" />}{pending ? "Saving…" : submitLabel}</Button></DialogFooter></form></DialogContent></Dialog>;
}
export function DetailList({ items = [] }) { return <dl className="squad-detail-list">{items.map((item, index) => <div key={item.key || item.label || index}><dt>{item.label}</dt><dd>{item.value ?? "—"}</dd></div>)}</dl>; }
