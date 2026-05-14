# Seed Studio

> **Generate realistic schema-aware test data for any Directus project — in one click.**

## Why Seed Studio

Every Directus user — solo dev, agency, internal-tools team — hits the same wall: build a schema, look at empty tables, then either hand-craft hundreds of rows or write a one-off seed script that rots the moment the schema changes.

Seed Studio reads your live schema, detects what each field should contain (based on type, interface, name heuristics, and validation), resolves M2O relationships and `directus_files` references, and writes realistic data in batches. Four-hour seed-script tasks become 30-second one-click generations.

## Features

- One-click realistic test data via a wizard inside the Directus admin
- Schema-aware strategy auto-detection
- 60+ field name heuristics (e.g. `email` → fake email, `slug` → URL slug, `price` → 1–1000 float)
- M2O relationship handling — picks random existing parent rows
- Image reuse from existing `directus_files` records
- Per-field overrides with inline preview
- Dry-run mode that returns 10 sample rows without writing
- Wipe-and-regenerate mode with Stripe-style typed confirmation
- Generation history audit log (`seed_studio_runs`)
- Saved presets per collection (`seed_studio_presets`)
- Server-Sent Events progress with elapsed / estimated remaining
- 70+ Faker methods exposed in the override UI

## Screenshots

### 1 · Pick a collection
Bento grid of every user collection — with field count, row count, and one-click select. Sidebar shows recent generation runs with live status dots.

![Pick a collection](https://raw.githubusercontent.com/khanahmad4527/directus-extension-seed-studio/main/docs/screenshots/1-pick.png)

Toggle the **System** checkbox to also seed into Directus system collections (`directus_notifications`, `directus_activity`, `directus_users`, etc.) — the detector ships with per-field rules for each.

![Including system collections](https://raw.githubusercontent.com/khanahmad4527/directus-extension-seed-studio/main/docs/screenshots/2-system.png)

### 2 · Review strategies & save presets
Every field is shown with its auto-detected strategy badge — color-coded by family (faker / relation / random / system / built). Edit per-field, skip, or save the whole map as a named preset for re-use.

![Review fields](https://raw.githubusercontent.com/khanahmad4527/directus-extension-seed-studio/main/docs/screenshots/3-fields.png)

### 3 · Generation settings
Quick-pick row counts (100 / 500 / 1k / 5k / 10k), custom batch size, and append-vs-wipe mode with a typed confirmation dialog.

![Settings](https://raw.githubusercontent.com/khanahmad4527/directus-extension-seed-studio/main/docs/screenshots/4-settings.png)

### 4 · Live progress
Server-Sent Events stream the live progress — rows written, current batch, elapsed time, ETA. Refresh-safe: leave the page mid-run, come back, the wizard auto-resumes.

![Progress](https://raw.githubusercontent.com/khanahmad4527/directus-extension-seed-studio/main/docs/screenshots/5-progress.png)

## Installation

Install via the Directus Marketplace, or via npm:

```sh
npm install directus-extension-seed-studio
```

Restart Directus. The `Seed Studio` module will appear in the admin sidebar for any user with admin access.

## Usage

1. Open the **Seed Studio** module in the sidebar.
2. Pick a collection.
3. Review the auto-detected strategy for every field. Click the edit icon next to any row to override it; click **Preview** to see three sample values.
4. Pick a row count (chips: 100 / 500 / 1,000 / 5,000 / 10,000, or custom).
5. Choose **Append** or **Wipe first** (requires typing the collection name to confirm).
6. Optional: toggle **Dry-run preview** to see 10 sample rows without writing.
7. Click **Generate** and watch the progress bar fill.

## Field name heuristics

| Name pattern (contains, case-insensitive) | Strategy |
|---|---|
| `email` | `faker.internet.email()` |
| `phone`, `mobile`, `tel` | `faker.phone.number()` |
| `first_name`, `firstname`, `given_name` | `faker.person.firstName()` |
| `last_name`, `lastname`, `surname`, `family_name` | `faker.person.lastName()` |
| `full_name`, `name` (exact) | `faker.person.fullName()` |
| `username`, `handle` | `faker.internet.userName()` |
| `password` | `faker.internet.password()` |
| `url`, `website`, `homepage` | `faker.internet.url()` |
| `domain` | `faker.internet.domainName()` |
| `slug` | `faker.lorem.slug()` |
| `title`, `headline` | `faker.lorem.sentence()` |
| `description`, `summary`, `excerpt` | `faker.lorem.paragraph()` |
| `body`, `content`, `article` | `faker.lorem.paragraphs(5)` |
| `address`, `street` | `faker.location.streetAddress()` |
| `city` | `faker.location.city()` |
| `country` | `faker.location.country()` |
| `state`, `region`, `province` | `faker.location.state()` |
| `zip`, `postcode`, `postal_code` | `faker.location.zipCode()` |
| `lat`, `latitude` | `faker.location.latitude()` |
| `lng`, `lon`, `longitude` | `faker.location.longitude()` |
| `company`, `organization`, `org` | `faker.company.name()` |
| `job`, `role`, `position` | `faker.person.jobTitle()` |
| `price`, `amount`, `cost`, `total` | float 1.00 – 1000.00 |
| `quantity`, `qty`, `count`, `stock` | int 0 – 1000 |
| `age` | int 18 – 80 |
| `bio`, `about`, `profile` | `faker.person.bio()` |

When the field name matches none of these, Seed Studio falls back to the interface, then to the type.

## Strategy types

| Kind | What it does |
|---|---|
| `system` | Directus handles the value (id, date_created, etc.) |
| `skip` | Field is omitted from generated rows |
| `null` | Always emits `null` |
| `fixed` | Same hard-coded value every row |
| `faker` | Calls a `@faker-js/faker` method by path (allowlist enforced) |
| `random_choice` | Picks from a list |
| `random_int` | Integer in `[min, max]` |
| `random_float` | Float with fraction digits |
| `random_date` | Random date in `[-daysBack, +daysForward]` |
| `random_boolean` | Boolean with probability of `true` |
| `uuid` | `crypto.randomUUID()` |
| `sequence` | Pattern like `INV-{0000}` — index-based, zero-padded |
| `m2o_random` | Picks a random existing parent row |
| `file_reuse` | Picks a random existing file from `directus_files` |
| `lorem_paragraphs` | N paragraphs of lorem ipsum |

All produced values are post-processed against the field's `max_length`, numeric range, and `is_unique` constraints.

## Audit collections

Seed Studio creates two collections on first use:

### `seed_studio_runs`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `collection` | `string` | which collection was generated |
| `row_count_requested` | `integer` | |
| `row_count_written` | `integer` | |
| `dry_run` | `boolean` | |
| `wipe_first` | `boolean` | |
| `strategies` | `json` | snapshot of strategies used |
| `status` | `string` | `running` / `success` / `failed` |
| `error_message` | `text` | populated on failure |
| `duration_ms` | `integer` | |
| `started_at` | `timestamp` | |
| `completed_at` | `timestamp` | |
| `user_created` | `uuid` | |

### `seed_studio_presets`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `string` | user-given preset name |
| `collection` | `string` | target collection |
| `strategies` | `json` | strategy map keyed by field name |
| `user_created` | `uuid` | |
| `date_created` | `timestamp` | |

## API endpoints

All routes are admin-only. Non-admins receive `403`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/seed-studio/collections` | List collections with row counts |
| `GET` | `/seed-studio/schema/:collection` | Schema + auto-strategies |
| `POST` | `/seed-studio/preview` | Dry-run (returns rows, no writes) |
| `POST` | `/seed-studio/generate` | Start a generation run |
| `GET` | `/seed-studio/generate/:runId/progress` | SSE progress stream |
| `GET` | `/seed-studio/presets/:collection` | List presets |
| `POST` | `/seed-studio/presets` | Save a preset |
| `DELETE` | `/seed-studio/presets/:id` | Delete a preset |
| `GET` | `/seed-studio/runs` | List recent runs |
| `GET` | `/seed-studio/faker-methods` | List allowlisted Faker methods |

## Permissions

Seed Studio is **admin-only by design** — the module hides itself for non-admins and every endpoint route returns `403` unless `accountability.admin === true`. This is a developer/admin tool: it can wipe data and generate at scale. Never grant access to a non-admin.

## Compatibility

- Directus `^11.0.0`
- Node.js `>= 20`
- Postgres, MySQL/MariaDB, or SQLite

## Local development

This project uses **pnpm** as the package manager and ships a `docker-compose.yml` for one-command end-to-end testing.

```sh
git clone https://github.com/khanahmad4527/directus-extension-seed-studio.git
cd directus-extension-seed-studio
pnpm install
pnpm build            # produces dist/api.js + dist/app.js
pnpm dev              # watch + rebuild on change
```

### Run with Docker (recommended)

```sh
pnpm build            # build once so dist/ exists
docker compose up     # starts Postgres + Redis + Directus + seeds test data
```

Open <http://localhost:8055>, log in with `admin@example.com` / `d1r3ctu5`. The `seed` service creates four UUID-PK collections with M2O relations for you to try Seed Studio against:

- `ss_authors` (id, name, email, bio, avatar → directus_files)
- `ss_categories` (id, name, slug)
- `ss_posts` (id, title, slug, content, status, author → ss_authors, category → ss_categories, cover → directus_files)
- `ss_comments` (id, body, rating, post → ss_posts, author → ss_authors)

All primary keys and every foreign key are `uuid`.

Stop and reset:

```sh
docker compose down -v       # also drops the database volume
rm -rf data                  # removes uploads + Postgres data on the host
```

### Tests

```sh
pnpm test
```

## Roadmap

**v2**

- Multi-collection seed plans with topological dependency resolution
- Three-tier image seeding (reuse / placeholder-service download / Tier-1 URL)
- Self-referential relationship handling (tree generation)
- M2M junction auto-population
- Preset import/export as JSON

**v3+**

- Pre-built schema + seed templates (blog, e-commerce, CRM)
- AI-suggested strategies from a natural-language description

## License

[MIT](LICENSE) © Ahmad Khan

## Author

**Ahmad Khan** — [GitHub](https://github.com/khanahmad4527)
