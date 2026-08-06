# Security & correctness review — `feat/intelligent-engine`

Self-review of the new engine, run after the branch was pushed. Nothing here is
committed: the working tree holds the fixes, `git status` lists them.

- **Unit tests:** 276 passing (`pnpm test`), up from 234.
- **Typecheck:** clean (`npx tsc --noEmit`).
- **Live checks:** 71/71 against a real Directus 11.17.4 + SQLite instance.
- **New files:** `src/core/request-validation.ts`, `test/security.test.ts`.

Method: read every path that accepts input from an HTTP request body, then run
the whole thing against a live instance and chase every disagreement between
what the code claimed and what the database did. Four of the bugs below were
invisible to unit tests — they only appeared against real Directus.

---

## 1. Security findings

| # | Severity | Finding | Fixed in |
|---|---|---|---|
| S1 | Medium | **Faker path traversal.** `person.constructor`, `lorem.toString`, `internet.valueOf` etc. matched the "looks like a method" pattern and resolved to real functions. Paths are capped at two segments so `constructor.constructor` was unreachable — not RCE — but a request body had no business addressing them. | [faker-methods.ts](src/core/faker-methods.ts) — explicit blocklist plus a constructor check in the resolver |
| S2 | Medium | **Entity trait traversal.** A `coherent` strategy walked the entity with an unchecked dotted path, so `constructor.constructor` or arbitrary depth was accepted; `person.constructor` even passed validation and failed silently at generation time. | [entity.ts](src/core/entity.ts) — exactly `<namespace>.<trait>`, blocklisted inherited keys, never returns a function |
| S3 | Medium | **Regex denial of service.** `regex` strategies and stored `meta.validation` patterns went straight to `faker.helpers.fromRegExp`, which happily materialises `[a-z]{1000000000}`. | [rng.ts](src/core/rng.ts) — `assertSafePattern` (length + repetition caps) and a hard cap on generated length |
| S4 | Medium | **Unbounded run size.** `count` was only checked for "positive number", so `count: 1e12` started a run that never ends. | [request-validation.ts](src/core/request-validation.ts) — 1,000,000 rows per run, rejected with a 400 |
| S5 | Low | **Sequence padding.** `{0…}` with 100k zeros built a 100 kB string per row. | [validation.ts](src/core/validation.ts) — padding capped at 40, pattern at 200 characters |
| S6 | Low | **Prototype-polluting keys.** A strategy map arriving as JSON can carry a real `__proto__` own property, and a column could be named `__proto__`. | [request-validation.ts](src/core/request-validation.ts) rejects the key; [generator.ts](src/core/generator.ts) never writes it |
| S7 | Low | **Locale lookup used `in`.** `'constructor' in allLocales` is true, so `locale: "constructor"` reached the Faker constructor. | [faker-host.ts](src/endpoint/faker-host.ts) — own-property check |
| S8 | Low | **Unvalidated strategy payloads.** Malformed strategies silently produced `null` for every row instead of an error. | [request-validation.ts](src/core/request-validation.ts) — full shape validation, 400 with a specific message |
| S9 | Low | **Unbounded audit text.** A failed batch quotes the whole INSERT statement — megabytes for a 500-row batch — straight into `error_message`. | [generate.ts](src/endpoint/routes/generate.ts) — `truncateMessage` at 2,000 characters |
| S10 | Low | **Unencoded collection in URLs.** The browser adapter interpolated the collection name into REST paths unencoded. | [http-data-source.ts](src/module/adapters/http-data-source.ts) — `encodeURIComponent` |
| S11 | Low | **ReDoS on stored validation rules** when checking a generated row. | [filter-ast.ts](src/core/filter-ast.ts) — subject capped at 10,000 characters |
| S12 | Low | **Junction row explosion.** `m2m_random` cardinality came from the request; parents × links had no ceiling. | 100 links per row, 100,000 junction rows per batch |
| S13 | Low | **Unvalidated localStorage.** Run history and Undo trusted whatever was in the browser store. | [useLocalRuns.ts](src/module/composables/useLocalRuns.ts) — shape check on read |

Checked and found clean: no `eval`/`new Function`/dynamic `require`, no `v-html`
or `innerHTML` anywhere in the UI, no SQL string building (everything goes
through `ItemsService` or the REST API), admin-only guard applied before every
route, no secrets in code or logs, no token in a URL (that one was fixed on the
branch already).

---

## 2. Correctness bugs

| # | Severity | Bug | Why tests missed it | Fixed in |
|---|---|---|---|---|
| B1 | **High** | **Undo never enabled, seed never shown.** The audit row got its own UUID while the UI looked the record up by `runId`, so after any API-engine run the lookup failed silently. | The in-browser engine uses the run id as the record id, so this only broke on the API engine. | [generate.ts](src/endpoint/routes/generate.ts) — the run record now *is* the run id |
| B2 | **High** | **Value-frequency profiling always failed.** The adapter passed `groupBy` to `ItemsService`, but the internal `Query` field is `group` (`groupBy` is the REST spelling). The grouping was silently ignored, so "learn from data" reported "not enough signal" for every enum column. | The fake data source implemented `groupCount` itself, so the real query shape was never exercised. | [items-service-data-source.ts](src/endpoint/adapters/items-service-data-source.ts) |
| B3 | **High** | **Same seed did not reproduce a run.** Dates are relative to "now", which was read from the wall clock per row — two runs a minute apart drifted, so the reproducibility promise was false for any date column. | Unit tests compared runs within the same millisecond. | Time anchor: `options.now`, fixed per run, returned by every run and stored in the audit row |
| B4 | Medium | **Project runs stopped reporting after the first collection.** The first child run's `complete` event closed the shared progress stream. | No test drove a project run through the SSE route. | [project.ts](src/core/project.ts) — child terminal events are re-labelled as phase updates |
| B5 | Medium | **Undo flag raced the UI.** The terminal event was emitted before the audit row was updated; the UI reads that row the moment it sees `complete`. | Timing-dependent, invisible in-process. | [generate.ts](src/endpoint/routes/generate.ts) — terminal event held until after the audit write |
| B6 | Medium | **One unreadable column silenced all profiling.** A single failing field (geometry on a database with no spatial functions, or a permission) made the whole sample query throw, and profiling returned nothing. | The fake source never failed. | [inference.ts](src/core/inference.ts) — per-field fallback, and unreadable columns are reported as such |
| B7 | Medium | **Unreadable columns looked "100% empty"** and were suggested a null-rate strategy — advice to always blank a field, based on a failed read. | Surfaced only after B6's fix. | [inference.ts](src/core/inference.ts) — unreadable ≠ empty |
| B8 | Low | **Silent field failures.** The executor swallows per-field errors so one bad strategy cannot abort a 100k-row run — but nothing reported them, so a systematically failing field wrote empty values forever. | — | Failures are counted and surfaced as a run warning |
| B9 | Low | **Non-array API responses crashed the browser engine** (`rows.map is not a function`) on an error body. | — | [http-data-source.ts](src/module/adapters/http-data-source.ts) — list responses normalised |
| B10 | Low | **A stalled wipe looped 10,000 times** when deletes were refused (e.g. a foreign key). | — | Detects no progress and stops with an explanation |
| B11 | Low | **Unsafe stored regex broke detection.** A pattern we cannot generate from was still suggested, so every row failed that field. | — | [strategy-detector.ts](src/core/strategy-detector.ts) — falls back to heuristics |
| B12 | Low | **Transient probe failure stranded the UI.** A 502/503 during a server restart cached "app engine" for the whole session. | — | [useSeedApi.ts](src/module/composables/useSeedApi.ts) — only 404/403 are cached as definitive |
| B13 | Low | **Audit collection accumulated revisions** — a revision per status update of a log row. | — | [audit.ts](src/endpoint/audit.ts) — `accountability: 'activity'` on `seed_studio_runs` |

One test-double bug worth noting: `FakeDataSource.sample` ignored the requested
field list and returned whole rows, which is what hid B6/B7. It now projects
fields the way Directus does.

---

## 3. Behaviour changes you should know about

- **`options.now`** is new. Any run reports the anchor it used; to reproduce a
  run exactly, send back **both** `seed` and `now`. Both are stored in the run
  record's `options`.
- **Run id = audit row id.** A run's `runId` is now the primary key of its
  `seed_studio_runs` row.
- **Strategy maps are validated.** A malformed strategy is a 400 with a specific
  message instead of silently generating nulls.
- **Runs are capped at 1,000,000 rows** and project runs at 50 collections.
- **`seed_studio_runs` no longer writes revisions** (activity only). Existing
  installs keep their current setting; only fresh installs get it.
- Fast write writes **zero** activity and revisions for the target collection.
  The two rows you will still see belong to the run's own audit record.

---

## 4. How to test it manually

The app is already running from this session. If it is not, see §5.

**Open** http://localhost:8055 → `admin@example.com` / `d1r3ctu5` → **Seed Studio**
in the sidebar. Hard-refresh (`Ctrl+Shift+R`) after any rebuild — Directus serves
the app extension as one cached JS file.

Test data present: `ss_authors`, `ss_categories`, `ss_tags`, `ss_posts`,
`ss_comments`, `ss_posts_tags`. `ss_posts` is the interesting one — it has a
validated SKU, decimals, date pairs, a divider, a conditional field, a geometry
column, a unique short code, sort + archive metadata, an m2m to tags, and an
active flow on item-create.

> ⚠️ Before **generating** into `ss_posts`, set the `area` field to **Skip**.
> Plain SQLite has no `st_geomfromtext`, so *any* geometry write fails there —
> Directus, not the extension. Dry-run shows the Polygon correctly, and Postgres
> or MySQL writes it fine.

### 4.1 Row counts and Learn from data (B2, plus the v1.0.0 count bug)

1. Step 1 shows **real row counts** on the collection cards (they were all 0 before).
2. Pick `ss_posts` → step 2 → the presets bar has **📊 Learn from data** on the right.
3. Click it. Expected: a blue banner, "Updated N fields from 198 existing rows",
   listing e.g. `status — 3 distinct values in the existing rows` and
   `sku — every sampled value matches ^[A-Z]{3}-[0-9]{5}$`.
4. `status` should now show a **weighted** badge whose weights match the real
   split (published ≫ draft ≫ archived).

### 4.2 Reproducibility (B3)

1. Step 3 → **Reproducibility** → type a seed, e.g. `777` → **Dry-run**.
2. Note a couple of values, including a date. Step 4 shows `Seed 777 reproduces these exact rows`.
3. Back → Dry-run again with the same seed. **Every value, including dates, is identical.**
4. Change the seed → different rows.

### 4.3 Settings survive a dry run (fixed earlier today)

1. Step 3: set Fast write, a seed, row count 250, tick *Realistic empty values*.
2. **Dry-run** → step 4 → **Back to settings**. Everything you chose is still there.

### 4.4 Pre-flight warnings

1. Step 3, set the row count to `5000`. Within a second an orange banner appears:
   - `Flow "Notify on new post" runs on item create … would fire 5,000 times`
   - the revision/activity volume for the run
   - any parent collection that still has no rows.

### 4.5 Dry run as a real validator

1. Step 2, edit `sku` → **Fixed value** → type `nope` → Save.
2. Step 3 → Dry-run. Expected: a red banner, "1 value would be rejected by
   Directus", naming `sku` and the validation rule.
3. Reset that field (**Edit → Reset to auto**) and dry-run again: green banner.

### 4.6 Generate, m2m, undo (B1)

1. Step 2: set `area` to **Skip**. Step 3: 40 rows, Safe write → **Generate**.
2. Progress fills; when it finishes the card shows the seed and an **Undo run** button.
3. Check `ss_posts_tags` in Content — it has junction rows (each post linked to 0–4 tags).
4. Click **Undo run**. Expected: "Removed 40 rows from ss_posts", and the run in
   the sidebar turns *undone*. Clicking Undo again is refused.

### 4.7 Cancel (B5)

1. Generate 4,000 rows with Fast write.
2. Hit **Stop run** part-way. Expected: the card switches to *Cancelled*, showing
   how many rows were written, and **Undo run** is available for exactly those.

### 4.8 Fast vs safe write

1. Generate 20 rows with **Safe**, then 20 with **Fast**.
2. In Content → Activity, filter by `ss_posts`: safe adds ~20 entries, fast adds
   none. Fast-written rows have an empty `user_created` — that is the trade-off,
   and the settings screen says so.

### 4.9 Locale

1. Step 3 → Reproducibility → set locale `de` → Dry-run.
2. Names, phone numbers and addresses are German, and `country` reads `Germany`
   rather than a random country.

### 4.10 The in-browser engine (Cloud path)

1. Stop Directus, rename `dist/api.js` to `dist/api.js.off`, start Directus again,
   hard-refresh the admin.
2. Seed Studio shows a blue banner: *Running in this browser tab*.
3. Everything still works — generate 20 rows into `ss_authors`. Fast write is
   disabled with an explanation, the locale picker is locked to English, and run
   history is local to the browser.
4. Restore `dist/api.js` and restart to go back to the API engine.

### 4.11 The security guards (optional, via curl)

```sh
TOKEN=$(curl -s -X POST http://localhost:8055/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"d1r3ctu5"}' | jq -r .data.access_token)

# S1 — blocked faker path → 400 with a clear message
curl -s -X POST http://localhost:8055/seed-studio/preview -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"collection":"ss_posts","strategies":{"title":{"kind":"faker","method":"person.constructor"}}}'

# S3 — memory-bomb pattern → 400
curl -s -X POST http://localhost:8055/seed-studio/preview -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"collection":"ss_posts","strategies":{"sku":{"kind":"regex","pattern":"[a-z]{99999999}"}}}'

# S4 — run size cap → 400
curl -s -X POST http://localhost:8055/seed-studio/generate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"collection":"ss_posts","strategies":{},"count":999999999}'

# S6 — prototype key → 400
curl -s -X POST http://localhost:8055/seed-studio/preview -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"collection":"ss_posts","strategies":{"__proto__":{"kind":"null"}}}'

# Wipe without confirmation → 400
curl -s -X POST http://localhost:8055/seed-studio/generate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"collection":"ss_posts","strategies":{},"count":1,"wipeFirst":true}'
```

Each should return a 400 with a specific message, and nothing should be written.

### 4.12 Automated checks

```sh
cd ~/directus-extension-seed-studio
pnpm test                                     # 276 unit tests, no database needed
npx tsc --noEmit                              # typecheck
node <scratch>/test-features.mjs              # 71 checks against the live instance
```

The live script lives in this session's scratchpad
(`/tmp/claude-1000/-home-ahmad-directus-extension-seed-studio/…/scratchpad/`)
along with `extend-schema.mjs`, which builds the test schema. Worth moving into
the repo as `test/live/` if you want it in CI against a service container.

---

## 5. Restarting the test instance

Directus 11.17.4 with SQLite, extension symlinked from the repo:

```sh
SP=/tmp/claude-1000/-home-ahmad-directus-extension-seed-studio/<session>/scratchpad
cd $SP/dx && npx directus start          # http://localhost:8055

# from scratch:
rm -f data/data.db && npx directus bootstrap && npx directus start
cd ~/directus-extension-seed-studio
DIRECTUS_URL=http://localhost:8055 node seed/init.mjs   # base collections
node $SP/extend-schema.mjs                              # validation, m2m, flow, geometry
```

After changing extension source: `pnpm build`, restart Directus, hard-refresh the
admin tab.

---

## 6. Still open

- **Geometry on SQLite** cannot be written at all (no spatial functions). Only
  affects this test rig; noted in the manual steps above.
- **`decimal(p,s)` ceilings** rely on the database reporting precision. SQLite
  reports none, so that constraint is inert there; Postgres and MySQL report it.
- **Concurrent runs on the same collection** each keep their own uniqueness
  registry, so two simultaneous runs can collide on a unique column. Rare and
  loud (the database rejects the batch) rather than silent.
- **`created_ids`** stores up to 100,000 keys as JSON (~3.7 MB for UUIDs) on the
  run row. Beyond that a run is marked not undoable.
- Version bump still needed before release — I would go **2.0.0**: wipe now
  requires `confirm`, and strategy validation rejects payloads the old endpoint
  accepted.
