# CAD Quote App

> **Illustrative estimates only.** Prices come from tuned constants and are not real manufacturing quotes.
>
> **Local use only.** The app has no login and no rate limiting, and corrupt uploads can still crash or hang the geometry engine. Do not expose it to the internet.

## What the app does

Upload one or more STEP or STP files of parts and enter a quantity for each. The app measures each part's geometry, counts its holes, scores its complexity, and returns a CNC machining estimate in 6061 Aluminum: material, machine, and setup cost per unit, order total, and lead time. Every quote is saved with its uploaded STEP file, a thumbnail, and a 3D model you can rotate on the quote page, and you can review past quotes and archive the ones you are done with.

Quotes have three statuses:

| Status | Meaning |
|---|---|
| `quoted` | Set when the quote is created. |
| `reviewed` | Set when the quote page is opened, or with the check mark in the history. Shown with a green check. |
| `archived` | Set with the archive button in the history. Archived quotes are read-only. |

```text
apps/web/                    React and Vite frontend
apps/api/                    Fastify API, SQLite storage, and pricing
packages/geometry-engine/    Python geometry engine (standalone, not a pnpm package)
packages/quote-contract/     Quote and QuoteStatus types shared by the web app and API
examples/                    Generated sample part
```

The API runs the engine as a child process for each upload. See [REPORT.md](REPORT.md) for how parsing, geometry, complexity, pricing, and lead time work.

## Decisions

- SQLite keeps the entire backend self-contained, with no external database server to run.

- Quotes are priced the moment they are created, so every quote starts as `quoted`.

## Install dependencies

Prerequisites:

- Node.js 24 or newer.
- pnpm 11.21.0, the version pinned in `package.json`. To install it: `npm install -g pnpm@11.21.0`
- Python 3.12. If `python3.12` is not the command name on your system, use your Python 3.12 path in the first command below.

This was tested on Node 24.18 and Python 3.12.

The commands below are for macOS and Linux and have been tested on macOS. Run them from the project root:

```sh
python3.12 -m venv packages/geometry-engine/.venv
packages/geometry-engine/.venv/bin/pip install -r packages/geometry-engine/requirements.txt
pnpm install
```

By default the API runs `packages/geometry-engine/.venv/bin/python` and `packages/geometry-engine/geometry_engine.py`. To use a different interpreter or script, set `GEOMETRY_PYTHON_PATH` or `GEOMETRY_SCRIPT_PATH`.

## Run everything

```sh
pnpm dev
```

This starts the API on port 3001 and the web app at `http://localhost:5173`. Open that address in a browser.

To use other ports, set `API_PORT` and `WEB_PORT`. The web app's proxy follows `API_PORT`:

```sh
API_PORT=3101 WEB_PORT=5273 pnpm dev
```

## Run the frontend or backend alone

```sh
pnpm --filter @cad-quote/web dev
pnpm --filter @cad-quote/api dev
```

The API listens on `http://127.0.0.1:3001`. The web app needs the API for all quote requests, so its API calls fail while the API is stopped.

## Database

There is no separate database step. SQLite is built into the API, and its file is created automatically at `apps/api/data/quotes.db` on first start. To use a different file, set `QUOTES_DB_PATH` to an absolute path:

```sh
QUOTES_DB_PATH=/path/to/quotes.db pnpm dev
```

A database created by an earlier version of the app is upgraded automatically the next time the API starts through `pnpm dev`: the retired `new` status is removed and any rows that had it become `quoted`.

## Saved STEP files, models, and thumbnails

Each quote stores its files under `previews/<quote id>/` in the data directory:

| File | Contents |
|---|---|
| `source.step` | The uploaded STEP file. |
| `model.bin` | The mesh shown by the 3D viewer. |
| `thumbnail.png` | The image shown in the history and on the batch results page. |

The data directory is `apps/api/data` by default. Set `QUOTES_DATA_DIR` to an absolute path to use a different one; if only `QUOTES_DB_PATH` is set, the `previews` folder is created next to that database file.

Quotes created before these files were saved show **Preview unavailable** in place of the 3D model and a placeholder image in the history.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `API_PORT` | `3001` | Port the API listens on and the web app proxies to. |
| `WEB_PORT` | `5173` | Port of the web dev server. |
| `QUOTES_DB_PATH` | `apps/api/data/quotes.db` | SQLite database file. |
| `QUOTES_DATA_DIR` | `apps/api/data` | Directory that holds `previews/`. |
| `GEOMETRY_PYTHON_PATH` | `packages/geometry-engine/.venv/bin/python` | Python interpreter for the geometry engine. |
| `GEOMETRY_SCRIPT_PATH` | `packages/geometry-engine/geometry_engine.py` | Geometry script. |
| `GEOMETRY_PREVIEW_SCRIPT_PATH` | `packages/geometry-engine/export_preview.py` | Script that exports the mesh and thumbnail. |

## Run the standalone geometry engine

```sh
packages/geometry-engine/.venv/bin/python packages/geometry-engine/geometry_engine.py examples/sample-block.step
```

Example output:

```json
{
    "file": "sample-block.step",
    "bounding_box_mm": {
        "length": 60.0,
        "width": 40.0,
        "height": 15.0
    },
    "volume_cm3": 34.3,
    "surface_area_cm2": 87.0,
    "features": {
        "face_count": 10,
        "edge_count": 24,
        "holes_detected": 4,
        "complexity_score": 1.06
    }
}
```

On failure it prints `error: ...` to stderr and exits with status 1.

## Example upload flow

1. Run `pnpm dev` and open `http://localhost:5173`.
2. On the New Quote page, choose or drop `examples/sample-block.step`. Each file gets its own panel with a live thumbnail, its name and size, a remove button, and its own quantity, and the last box in the list adds more files.
3. Enter quantity `10`. Quantity must be a whole number from 1 to 100,000.
4. Select **Generate Quote**. The page shows "Analyzing part geometry…" while the engine runs.
5. The app opens the quote at `/quotes/<id>`, showing cost, the 3D model, lead time, geometry, and detected features. Opening a quote marks it `reviewed`.
6. On wide windows, saved quotes appear beside the form on the home page; on narrower windows, select **History**. Use the check mark to mark a quote reviewed without opening it, and the archive button to remove it from the list. **View archived** shows archived quotes, which have no actions; opening an archived quote does not change it.

The same upload from the command line, through the web app's proxy:

```sh
curl -F quantity=10 -F file=@examples/sample-block.step http://localhost:5173/api/quotes
```

The file field must be named `file`, and the quantity field `quantity`.

## Use your own STEP file

Any `.step` or `.stp` file up to 50 MB can be used. To measure one with the standalone command:

```sh
packages/geometry-engine/.venv/bin/python packages/geometry-engine/geometry_engine.py /path/to/your-part.step
```

To quote one in the web app, run `pnpm dev`, open `http://localhost:5173`, choose your file in the **CAD file** field, enter a quantity, and select **Generate Quote**.

## Multiple files

Choose or drop up to 20 files at a time. Each file has its own quantity, and a quantity typed before any file is chosen becomes the starting value for that first selection. Files with the wrong extension or no contents are marked on their own panel and skipped; exact duplicates (same name and size) are ignored.

A single file opens its quote page. Several files open a batch results page with a thumbnail, cost, lead time, and link for each quote, plus a link back home. If some files fail, the successful quotes are kept, the error appears on the failed panel, and you can retry the failures or view the results that succeeded.

The back button beside the **New quote** heading asks for confirmation before discarding the selection.

## 3D viewer

The quote page shows the part in an interactive 3D view. It rotates slowly when idle, unless the browser asks for reduced motion. Drag or swipe to rotate it; auto-rotation resumes shortly after you let go.

## Example quote output

This is the real API response for `examples/sample-block.step` at quantity 10, captured from a running app with a temporary database. The part is a generated 60 × 40 × 15 mm block with 4 through holes. The figures are illustrative estimates, not a real manufacturing quote.

```json
{
    "file": "sample-block.step",
    "quantity": 10,
    "material": "6061 Aluminum",
    "geometry": {
        "bounding_box_mm": {
            "length": 60,
            "width": 40,
            "height": 15
        },
        "volume_cm3": 34.3,
        "surface_area_cm2": 87
    },
    "features": {
        "holes_detected": 4,
        "face_count": 10,
        "edge_count": 24,
        "complexity_score": 1.06
    },
    "cost_breakdown": {
        "material_cost_per_unit": 0.46,
        "machine_time_cost_per_unit": 13.57,
        "setup_cost_per_unit": 15,
        "total_cost_per_unit": 29.03,
        "total_order_cost": 290.3
    },
    "lead_time_days": 7,
    "id": 1,
    "status": "quoted",
    "created_at": "2026-11-09T07:59:12.541Z"
}
```

## Assumptions and known limitations

**Inputs and scope**

- Only STEP and STP uploads are accepted, up to 50 MB.
- For local use only. There is no login or rate limiting.

**Pricing**

- Prices are illustrative estimates based on tuned constants, not real manufacturing quotes.
- Material is always 6061 Aluminum. Material cost uses exact part volume, not stock volume.
- The cutting-time constant `CUTTING_TIME_CALIBRATION` and the 0.263 complexity coefficient are each fitted to one reference part, so they do not establish real-world accuracy.
- Complexity depends only on face count, not on true machining difficulty.

**Geometry engine**

- Prismatic parts measure the same when rotated, but round parts remain orientation-sensitive because they lack flat reference faces.
- Hole detection handles ordinary holes but can miscount unusual features such as pocket relief corners, heavily interrupted bores, and intersecting holes.
- Corrupted files can pass validation and return wrong numbers.
- The standalone script has no timeout, and a rare corrupt file can crash or hang it. The API runs it with a 120-second timeout.
- Strict loading could reject an unusual valid export with an unrelated bad entity.
- Values are rounded to 1 decimal (complexity to 2), so very small parts lose precision.
- Overlapping solids are summed.

**Running the app**

- The web dev server proxies `/api` to the API. A production build must have `/api` served at the same origin.
- Ctrl-C on `pnpm dev` prints a harmless pnpm error message.
