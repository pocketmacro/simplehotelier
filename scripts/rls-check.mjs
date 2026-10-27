// SimpleHotelier — database access-rule (RLS / grants) regression suite.
// Risk covered: a migration (or a dashboard edit) silently reopening
// cross-tenant reads, membership takeover, billing bypass, anonymous writes
// or browser access to internal functions. tests/rls/checks.sql creates its
// own fixtures (users, two tenants, rooms, reservations, ...) and asserts
// what each role can actually do against the LIVE database.
//
// Usage: node scripts/rls-check.mjs
//        node scripts/rls-check.mjs --with supabase/migrations/<pending>.sql
//          (runs a migration that isn't applied yet first, in the same
//          rolled-back transaction, to check it before applying it)
//
// Safe on live: the whole file plus a final DO block that raises
// "RLS_RESULTS <json>" is sent as ONE Management API query, which Postgres
// runs as one implicit transaction. The raise rolls everything back
// (fixtures included) and carries the results out in the error text.
// The script refuses SQL with transaction control (COMMIT, BEGIN, END,
// SAVEPOINT, ...), and treats a successful API response as a failure,
// because it means the final raise did not happen.
// Exit code: 0 = every check passed, 1 = anything else. No secrets printed.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MARKER = "RLS_RESULTS ";

/* Replace comments, strings, quoted identifiers and dollar-quoted bodies
   with spaces so only code remains; bodies are returned for a nested scan. */
function stripSql(sql) {
  const problems = [];
  const bodies = [];
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? n : nl;
      out += " ";
    } else if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      if (depth > 0) problems.push("unterminated /* comment");
      out += " ";
    } else if (c === "'") {
      const escapes = /(^|[^A-Za-z0-9_$])[eE]$/.test(out);
      i++;
      let closed = false;
      while (i < n) {
        if (escapes && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) problems.push("unterminated string literal");
      out += " ";
    } else if (c === '"') {
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) problems.push("unterminated quoted identifier");
      out += " _ident_ ";
    } else if (c === "$" && !/[A-Za-z0-9_$]$/.test(out)) {
      const m = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
      m.lastIndex = i;
      const tag = m.exec(sql);
      if (!tag) { out += c; i++; continue; } // $1 parameter
      const end = sql.indexOf(tag[0], i + tag[0].length);
      if (end < 0) {
        problems.push(`unterminated ${tag[0]} body`);
        i = n;
      } else {
        bodies.push(sql.slice(i + tag[0].length, end));
        i = end + tag[0].length;
      }
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return { code: out, bodies, problems };
}

const TOP_LEVEL = new Set(["commit", "rollback", "abort", "begin", "end", "savepoint", "release"]);
const short = (s) => s.trim().replace(/\s+/g, " ").slice(0, 60);

/* Every reason this SQL could end, split or escape the single rolled-back
   transaction. Empty array = safe to send. Exported for tests. */
export function transactionControlProblems(sql) {
  const found = [];
  const { code, bodies, problems } = stripSql(sql);
  found.push(...problems);
  for (const stmt of code.split(";")) {
    const words = (stmt.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) || []);
    const [w1, w2] = words;
    if (!w1) continue;
    if (TOP_LEVEL.has(w1) || ((w1 === "start" || w1 === "prepare") && w2 === "transaction")) {
      found.push(`transaction control statement: ${short(stmt)}`);
    }
  }
  if (code.includes("?")) found.push("the ? operator (Management API placeholder) outside strings");
  // Inside DO / function bodies plpgsql BEGIN/END are fine; COMMIT/ROLLBACK are not.
  const queue = [...bodies];
  while (queue.length) {
    const inner = stripSql(queue.shift());
    found.push(...inner.problems);
    const m = inner.code.match(/\b(commit|rollback)\b/i);
    if (m) found.push(`${m[1].toUpperCase()} inside a $$ body`);
    if (inner.code.includes("?")) found.push("the ? operator (Management API placeholder) inside a $$ body");
    queue.push(...inner.bodies);
  }
  return found;
}

/* checks.sql must create temp table rls_results (name, ok, info). */
export function buildQuery(sql) {
  return `${sql}
;
reset role;
do $rls_final$
begin
  raise exception '${MARKER}%', (
    select coalesce(json_agg(json_build_object('name', r.name, 'ok', r.ok, 'info', r.info) order by r.name), '[]'::json)
    from pg_temp.rls_results r);
end
$rls_final$;
`;
}

/* Pull the results array out of the API's error response (null if absent). */
export function parseResults(text) {
  const candidates = [];
  try {
    const j = JSON.parse(text);
    if (j && typeof j.message === "string") candidates.push(j.message);
    if (j && typeof j.error === "string") candidates.push(j.error);
  } catch { /* not JSON */ }
  candidates.push(String(text));
  for (const msg of candidates) {
    const at = msg.indexOf(MARKER + "[");
    if (at < 0) continue;
    const start = at + MARKER.length;
    let depth = 0;
    let inStr = false;
    for (let i = start; i < msg.length; i++) {
      const ch = msg[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const arr = JSON.parse(msg.slice(start, i + 1));
            if (Array.isArray(arr) && arr.every((r) => r && typeof r.name === "string" && typeof r.ok === "boolean")) return arr;
          } catch { /* fall through */ }
          break;
        }
      }
    }
  }
  return null;
}

function readEnv(root) {
  const env = {};
  for (const line of readFileSync(root + ".env", "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

/* Send one rolled-back query. Returns { httpOk, status, results, body }. */
export async function runRolledBack(sql, { root } = {}) {
  const problems = transactionControlProblems(sql);
  if (problems.length) {
    const e = new Error("REFUSED: the SQL could end the transaction early or break the API call:\n  " + problems.join("\n  "));
    e.refused = true;
    throw e;
  }
  const base = root || new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const env = readEnv(base);
  const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref || !env.SUPABASE_TOKEN) throw new Error(".env needs SUPABASE_TOKEN + NEXT_PUBLIC_SUPABASE_URL");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildQuery(sql) }),
    signal: AbortSignal.timeout(180000)
  });
  const body = await res.text();
  return { httpOk: res.ok, status: res.status, results: parseResults(body), body };
}

/* Returns the exit code (process.exit right after fetch trips a libuv
   assertion on Windows, so the caller sets process.exitCode instead). */
async function main() {
  const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const args = process.argv.slice(2);
  const pending = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--with" && args[i + 1]) pending.push(args[++i]);
    else { console.error(`unknown argument: ${args[i]}`); return 1; }
  }
  const sql = pending.map((f) => readFileSync(root + f.replaceAll("\\", "/"), "utf8") + "\n;\n").join("") +
    readFileSync(root + "tests/rls/checks.sql", "utf8");
  if (pending.length) console.log(`Including pending migration(s): ${pending.join(", ")}\n`);
  let out;
  try {
    out = await runRolledBack(sql, { root });
  } catch (e) {
    console.error(e.refused ? e.message : `ABORT: ${e.message}`);
    return 1;
  }
  if (out.httpOk) {
    console.error("!!! WARNING: the API reported SUCCESS. The final RLS_RESULTS raise did not happen,");
    console.error("!!! so the transaction may have COMMITTED test fixtures to the live database.");
    console.error("!!! Look for rls-check-* tenants and @rls-check.invalid users and remove them.");
    return 1;
  }
  if (!out.results) {
    console.error(`FAILED: HTTP ${out.status} without an ${MARKER.trim()} marker (nothing was saved; the error rolled back):`);
    console.error(out.body.slice(0, 1500));
    return 1;
  }
  const width = Math.min(70, Math.max(...out.results.map((r) => r.name.length)));
  for (const r of out.results) {
    const info = r.info == null ? "" : String(r.info).replace(/\s+/g, " ");
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.ok ? info.slice(0, 110) : info}`);
  }
  const failed = out.results.filter((r) => !r.ok).length;
  console.log(`\n${out.results.length - failed} passed, ${failed} failed (rolled back; nothing saved)`);
  return failed || !out.results.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
