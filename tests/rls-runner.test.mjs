// Focused test: the live RLS suite runner (scripts/rls-check.mjs).
// Risk covered: tests/rls/checks.sql runs against the LIVE database and is
// only safe because the whole query ends in a raise that rolls it back. A
// COMMIT/BEGIN/END/SAVEPOINT (or an unterminated string or comment that
// swallows the final raise) would let test fixtures persist in production.
// The runner must refuse such SQL, keep plpgsql BEGIN/END inside DO blocks
// working, and read results only from the RLS_RESULTS error. No network.
// Run: node --test tests/rls-runner.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transactionControlProblems, buildQuery, parseResults } from "../scripts/rls-check.mjs";

const checks = readFileSync(new URL("rls/checks.sql", import.meta.url), "utf8");
const refused = (sql) => transactionControlProblems(sql).length > 0;

test("refuses transaction control at statement start", () => {
  for (const sql of [
    "commit;", "COMMIT", "commit work;", "begin;", "BEGIN TRANSACTION;", "begin isolation level serializable;",
    "start transaction;", "START TRANSACTION READ WRITE;", "savepoint s1;", "release savepoint s1;",
    "rollback;", "rollback to savepoint s1;", "end;", "END TRANSACTION;", "abort;", "prepare transaction 'x';",
    "select 1;\ncommit;\nselect 2;", "select 1; end", "insert into t values (1);  -- note\n  Commit ;",
    "create temp table t (x int); /* c */ begin; select 1;"
  ]) assert.ok(refused(sql), sql);
});

test("refuses COMMIT/ROLLBACK inside DO and function bodies (plpgsql transaction control)", () => {
  for (const sql of [
    "do $$ begin commit; end $$;",
    "do $x$ begin perform 1; rollback; end $x$;",
    "create function pg_temp.f() returns void language plpgsql as $f$ begin commit; end $f$;",
    "do $a$ begin execute $b$ select 1 $b$; commit; end $a$;",
    "do $a$ begin execute $b$ rollback $b$; end $a$;"
  ]) assert.ok(refused(sql), sql);
});

test("refuses SQL that could swallow the appended final raise", () => {
  for (const sql of ["select 'unterminated", "select 1; /* never closed", "do $$ begin perform 1;", 'select "open']) {
    assert.ok(refused(sql), sql);
  }
});

test("refuses the jsonb ? operators (Management API placeholders)", () => {
  assert.ok(refused("select '{}'::jsonb ? 'a';"));
  assert.ok(refused("select x ?| array['a'] from t;"));
  assert.ok(refused("do $$ begin perform '{}'::jsonb ?& array['a']; end $$;"));
});

test("accepts normal DO blocks, functions, strings and comments", () => {
  for (const sql of [
    "do $$ begin perform 1; end $$;",
    "do $$ declare x int; begin begin x := 1; exception when others then null; end; end $$;",
    "do $chk$\nbegin\n  if true then\n    raise notice 'end';\n  end if;\nend\n$chk$;",
    "create function pg_temp.f() returns void language plpgsql as $f$ begin reset role; end $f$;",
    "select 'commit; begin; end;' as note;",
    "-- commit\n-- begin;\nselect 1;",
    "/* rollback; /* nested */ end; */ select 1;",
    "select E'it\\'s; commit;' as a, 'it''s' as b;",
    'select 1 as "commit";',
    "select 1 as committed, 2 as begin_at, 3 as end_date;",
    "select public.release_abandoned_holds();",
    "select 'why?' as q, $1;",
    "select format('%s', x) from t where y = '{tenant_a}'"
  ]) assert.deepEqual(transactionControlProblems(sql), [], sql);
});

test("the committed suite passes the guard and keeps the runner's contract", () => {
  assert.deepEqual(transactionControlProblems(checks), []);
  assert.match(checks, /create temp table rls_results \(name text primary key, ok boolean not null, info text\)/);
  assert.ok(!checks.includes("RLS_RESULTS"), "only the runner raises the results");
  assert.ok(!checks.includes("\r"), "LF line endings");
  const names = [...checks.matchAll(/'(R\d\d) /g)].map((m) => m[1]);
  assert.ok(names.length >= 30, "expected the R-numbered checks");
  assert.equal(new Set(names).size, names.length, "check numbers are unique");
});

test("buildQuery appends the rolled-back raise after the suite", () => {
  const q = buildQuery("select 1 -- trailing comment without newline");
  assert.ok(q.startsWith("select 1 -- trailing comment without newline\n"), "a trailing comment cannot swallow the raise");
  assert.match(q, /reset role;\s*do \$rls_final\$[\s\S]*raise exception 'RLS_RESULTS %'[\s\S]*pg_temp\.rls_results[\s\S]*\$rls_final\$;\s*$/);
  assert.deepEqual(transactionControlProblems(buildQuery(checks)), []);
});

test("parseResults reads the RLS_RESULTS error and nothing else", () => {
  const rows = [{ name: "R01 a", ok: true, info: "brackets ] } and \"quotes\" in info" }, { name: "R02 b", ok: false, info: null }];
  const body = JSON.stringify({ message: `Failed to run sql query: ERROR:  P0001: RLS_RESULTS ${JSON.stringify(rows)}\nCONTEXT:  PL/pgSQL function inline_code_block line 3 at RAISE\n` });
  assert.deepEqual(parseResults(body), rows);
  assert.deepEqual(parseResults(`ERROR: RLS_RESULTS ${JSON.stringify(rows)}`), rows, "plain-text error body");
  assert.equal(parseResults(JSON.stringify({ message: "ERROR: 42P01: relation \"rls_results\" does not exist" })), null);
  assert.equal(parseResults(JSON.stringify({ message: "syntax error near raise exception 'RLS_RESULTS %'" })), null, "echoed query text");
  assert.equal(parseResults(JSON.stringify([{ name: "R01", ok: true }])), null, "a success body is not results");
  assert.equal(parseResults(`RLS_RESULTS [{"name":"R01","ok":"yes"}]`), null, "malformed rows");
});
