// SimpleHotelier — read a whole result set, page by page.
// PostgREST answers at most 1000 rows per request (the project's max_rows)
// and silently stops there, so jobs that walk every tenant, feed or booking
// must page. `build` returns a fresh query ordered by a unique column.
// deno-lint-ignore-file no-explicit-any
export async function allRows<T = any>(build: () => any, pageSize = 500, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
