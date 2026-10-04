# Eat@State menu data — schema reference

The JSON files in this directory are the canonical, machine-readable source
for MSU dining-hall menus. They are published to the
[`/menus/` subpath](https://eatatstate.github.io/menus/) of
`eatatstate.github.io`, so the HTTP base for everything here is
`https://eatatstate.github.io/menus/data/`.

No auth, no API key, CORS-open. Safe to poll from cron or feed to an LLM.

## URL patterns

| File | Pattern | Notes |
|------|---------|-------|
| Per-meal menu | `data/{YYYY-MM-DD}/{breakfast\|lunch\|dinner}.json` | One file = all 11 halls for one meal on one date. |
| Today pointer | `data/today.json` | Regenerated every publish; resolves the current date for you. |
| Index | `data/index.json` | Lists every date/meal/hall currently fetchable. |
| Dining hours | `data/dining-hours.json` | Open/close per hall per weekday (stable, non-dated). |

The static site ships the **newest 7 days** of per-meal snapshots. Older
snapshots live on the `data` git branch of the source repository
(`eatatstate/menus-pwa`) and are **not** served over HTTP.

## Per-meal menu file

```jsonc
{
  "meal": "lunch",
  "date": "2026-10-04",
  "fetched_at": "2026-10-04T22:01:00Z",
  "schema_version": 1,
  "halls": [
    {
      "name": "The Edge at Akers",
      "slug": "the-edge-at-akers",
      "closed": false,
      "stations": [
        {
          "name": "NOOK",
          "items": [
            {
              "name": "Apple Jacks",
              "cat": "entree",
              "calories": 111,
              "ingredients": "Corn Flour Blend (…)",
              "nutr": { "pro": 1, "carb": 25, "fat": 1, "serv": 1 },
              "diet": ["vegetarian", "vegan", "nutfree"],
              "allergens": ["Wheat", "Soy"]
            }
          ]
        }
      ]
    }
  ]
}
```

### Top level

- `meal` — `"breakfast" | "lunch" | "dinner"`.
- `date` — `YYYY-MM-DD`, bucketed in **America/Detroit** (Eastern Time).
- `fetched_at` — RFC 3339 UTC timestamp of when the snapshot was written.
- `schema_version` — integer; bumped on breaking changes (see
  [`/CHANGELOG.md`](https://eatatstate.github.io/menus/CHANGELOG.md)).
- `halls` — array of the 11 dining halls.

### `halls[]`

- `name` — display name.
- `slug` — stable kebab-case identifier (use as a key; `name` can change).
- `closed` — `true` when **no menu is published** for this hall+meal. This is a
  *publishing* state, not whether the building is physically open — use
  `dining-hours.json` for real open/close times.
- `stations[]` — serving stations/areas within the hall.

### `stations[]`

- `name` — station display name (e.g. `NOOK`, `SALAD BAR`).
- `items[]` — the dishes.

### `items[]`

- `name` — dish name.
- `cat` — coarse category, e.g. `entree`, `side`, `dessert`, `salad`, `drink`.
- `calories` — numeric, per serving; omitted when unknown.
- `ingredients` — free-text ingredient/allergen line from the vendor.
- `nutr` — per-serving nutrition panel (see below).
- `diet[]` — dietary tags the item satisfies, e.g. `vegetarian`, `vegan`,
  `glutenfree`, `nutfree`, `dairyfree`, `soyfree`, `eggfree`. Empty/omitted
  when there is nothing to judge.
- `allergens[]` — vendor-declared allergen display names (`Milk`, `Wheat`,
  `Soy`, …). Omitted when the vendor declared none.
- `carried` — `true` when the dish is carried over from an earlier meal on the
  same day (lunch/dinner files only; breakfast is the reference and never
  flagged).

### `nutr` (per serving)

| key | meaning |
|-----|---------|
| `pro` | protein (g) |
| `carb` | total carbohydrate (g) |
| `fat` | total fat (g) |
| `sat` | saturated fat (g) |
| `fib` | dietary fiber (g) |
| `sug` | total sugars (g) |
| `asug` | added sugars (g) |
| `sod` | sodium (mg) |
| `chol` | cholesterol (mg) |
| `pot` | potassium (mg) |
| `caci` | calcium (mg) |
| `fe` | iron (mg) |
| `serv` | servings (usually `1`) |

Values are **per serving**; serving sizes are not comparable across dishes, so
treat `nutr` as a relative/quick-look panel, not a precise per-100 g value.

## `today.json`

```jsonc
{
  "date": "2026-10-04",              // current date in America/Detroit
  "meals": ["lunch", "dinner"],       // meals with a snapshot for `date`
  "available_dates": ["2026-10-03", "2026-10-04", "2026-10-05"],
  "latest_date": "2026-10-05",        // most recent snapshot on the site
  "schema_version": 1
}
```

`meals` is empty for `date` if that day's snapshot hasn't been published yet
(e.g. you fetched early morning before breakfast). Fall back to
`available_dates` / `latest_date`.

## `index.json`

```jsonc
{
  "generated_at": "2026-10-04T22:01:00Z",
  "meals": ["breakfast", "lunch", "dinner"],
  "dates": ["2026-09-28", "2026-09-29", "…", "2026-10-05"],
  "latest_date": "2026-10-05",
  "halls": [
    { "name": "The Edge at Akers", "slug": "the-edge-at-akers" }
  ]
}
```

`dates` is the authoritative list of what is currently fetchable (newest 7
days). `halls` is the canonical name+slug table.

## Versioning policy

- `fetched_at` is present on every file and always reflects the write time.
- `schema_version` bumps **only** on breaking changes (field renamed, removed,
  or retyped). Additive optional fields do not bump it.
- Every breaking change is recorded in
  [`/CHANGELOG.md`](https://eatatstate.github.io/menus/CHANGELOG.md).
- Historical date files continue to be served as long as they are within the
  7-day window; older history is retained on the git `data` branch.
