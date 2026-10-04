# Changelog

Breaking changes to the published menu JSON (`/menus/data/…`) are recorded
here. Each version bump of `schema_version` corresponds to an entry below.
Additive changes (new optional fields) do **not** bump the version and do not
require an entry.

## v1 — 2026-10-04

Initial versioned schema. All per-meal and combined menu files now carry
`"schema_version": 1`.

Per-meal file (`/data/{YYYY-MM-DD}/{breakfast|lunch|dinner}.json`):

```
{ meal, date, fetched_at, schema_version, halls[] }
  hall:    { name, slug, closed, stations[] }
  station: { name, items[] }
  item:    { name, cat, calories?, ingredients?, nutr?, diet[]?, allergens[]?, carried? }
  nutr:    { pro, carb, fat, sat, fib, sug, asug, sod, chol, pot, caci, fe, serv }
```

Also published at this version:

- `data/index.json` — available dates, meals, and hall slugs
- `data/today.json` — current-date / latest-snapshot pointer
- `data/README.md` — field-by-field schema reference
- site-root `llms.txt` — LLM/agent-readable index of the data
