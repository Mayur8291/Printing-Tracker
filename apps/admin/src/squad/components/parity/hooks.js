import { useInfiniteQuery } from "@tanstack/react-query";
import { useSquad, useSquadQuery } from "../../data/hooks";

export function useOrderStats(filters = {}, subject = null, options = {}) {
  return useSquadQuery(["order-stats", filters, subject], ({ sdk }) => sdk.orderStats(filters, subject), options);
}
export function usePeopleOrderCounts(kind, ids, options = {}) {
  const key = [...ids].sort().join(",");
  return useSquadQuery(["people-order-counts", kind, key], ({ sdk }) => sdk.peopleOrderCounts(kind, ids), { enabled: ids.length > 0, ...options });
}
/** Cursor-paged list for infinite scroll (Flutter paginates on scroll). `load(sdk, cursor)` returns {data, next_cursor}. */
export function useInfiniteSquadList(key, load, options = {}) {
  const { scope, sdk } = useSquad();
  const query = useInfiniteQuery({
    queryKey: ["squad", scope, "infinite", ...key], initialPageParam: null,
    queryFn: ({ pageParam, signal }) => load(sdk?.withSignal ? sdk.withSignal(signal) : sdk, pageParam),
    getNextPageParam: (last) => last?.next_cursor ?? undefined, staleTime: 15_000, retry: false, ...options,
  });
  return { ...query, rows: query.data?.pages.flatMap((p) => p.data ?? []) ?? [] };
}
