# CAD Quote App: Technical Report

Prices in this project are illustrative estimates based on tuned constants. They are not real manufacturing quotes.

## 1. How the CAD file is parsed

`packages/geometry-engine/geometry_engine.py` reads the file with OpenCascade's STEP reader (through the `cadquery-ocp` Python package), which converts STEP units to millimetres. Loading is strict. The file is rejected if it cannot be parsed, if any entity has a fail-level check, if any root fails to transfer, if fewer solids transfer than the file declares, or if any solid fails OpenCascade's validity check. Only solids are measured; loose surfaces and wires are ignored, and a file with no solid is an error.

The API in `apps/api` accepts only `.step` and `.stp` names, writes the upload to a temporary file, runs the engine as a child process with a 120-second timeout, and deletes the file afterwards. A part the engine cannot read returns HTTP 422.

## 2. How geometry is calculated

All values come from the B-rep model, not a mesh.

- **Bounding box:** tight and aligned to the part's own flat faces and straight edges, so a rotated copy of a prismatic part measures the same. Round parts have no such reference and keep the file's axes, so they remain sensitive to orientation. Values are sorted so length ≥ width ≥ height.
- **Volume and surface area:** OpenCascade global properties, summed over all solids.
- **Face and edge counts:** unique topological faces and edges. Degenerate edges, which have no length, are excluded.
- **Holes:** concave cylindrical and conical faces are grouped by shared axis. A run of same-radius cylinders counts as a hole if it closes at least 270° of a circle at some position along the axis and the axis there is empty space. Abutting coaxial steps (counterbores, countersinks, drill points) are one hole. Outer cylinders, slot ends, tooth flanks, fillets, and faces of sealed internal voids are excluded.

Lengths, volume, and area are rounded to 1 decimal place.

## 3. How complexity is detected

Complexity comes only from face count:

`score = 1 + 0.263 × log10(max(face_count, 6) ÷ 6)`, rounded to 2 decimals.

A six-sided prism scores exactly 1. The 0.263 is fitted to one reference part. Holes are counted separately and affect cutting time, not this score.

## 4. How the pricing formula works

**Hardcoded values**

| Value | Amount |
|---|---|
| Material | 6061 Aluminum, 2.7 g/cm³, $5.00/kg |
| Machine rate | $100/hour |
| Setup time | 1.5 hours per order |
| Roughing rate | 20 cm³/minute |
| Finishing rate | 20 cm²/minute |
| Time per hole | 1 minute |
| `CUTTING_TIME_CALIBRATION` | 1.01174 |

**Formulas**

- Removed volume (cm³) = max(bounding-box volume − part volume, 0). The clamp is needed because rounded measurements can make a nearly solid part's volume exceed its box.
- Cutting minutes = (removed ÷ 20 + surface area ÷ 20 + holes × 1) × 1.01174.
- Cutting hours = cutting minutes ÷ 60.
- Material per unit = part volume (cm³) × 2.7 ÷ 1000 × $5.
- Machine per unit = cutting hours × complexity × (1 − discount) × $100.
- Setup per unit = 1.5 × $100 ÷ quantity.
- Per-unit total = rounded material + rounded machine + rounded setup.
- Order total = rounded per-unit total × quantity.

**Quantity discount on machine time**

| Quantity | Discount |
|---|---|
| 1–5 | None |
| 6–20 | 10% |
| 21–100 | 20% |
| Above 100 | 30% |

**Rounding:** each of the three lines is rounded to cents before summing. To remove floating-point noise, the USD amount × 100 is rounded to 12 significant digits, then rounded half-up to whole cents.

**Why exact part volume:** material uses the part's exact volume rather than stock volume, which is the basis the formula was fitted to.

**Setup:** setup is charged on its own line, separately from machine time. The 1.5 hours is not added to machine cost.

## 5. How the lead time formula works

Lead time days = 5 + production days + complexity buffer.

- Production days = ceil((discounted machine hours per unit × quantity + 1.5) ÷ 8), using 8-hour production days. Setup hours count here once per order.
- Complexity buffer = ceil(complexity − 1). This is 0 when the score is exactly 1.00 and 1 for any score above 1, up to 2.00.

Both ceilings use the same 12-significant-digit noise removal. The sample part in `examples/sample-block.step` at quantity 10 gives 5 + 1 + 1 = 7 days.

## 6. What assumptions were made

- Every part is 6061 Aluminum, CNC milled at a flat $100/hour.
- The bounding box stands in for the stock when estimating removed volume, even though material is charged on part volume.
- Cutting rates are heuristics. The calibration constant and the 0.263 coefficient are each fitted to one reference part, so they do not establish accuracy on other parts.
- Face count stands in for machining difficulty.
- The app is for local use only. It has no login or rate limiting, accepts files up to 50 MB, and corrupt uploads can still crash or hang the engine, so it should not be exposed to the internet.

## 7. What to improve with more time

- Real calibration data from multiple machined parts, replacing the two values fitted to one reference part.
- Better feature recognition, covering pockets, slots, and intersecting or interrupted holes, plus tool-access analysis.
- A real machining-difficulty measure in place of face count, based on features, tolerances, and required setups.
- Process isolation and a timeout in the standalone engine, so a corrupt file cannot hang or crash it.
- Tighter handling of corrupted files that currently pass validation and return wrong numbers.
