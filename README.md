# Packer Module

## Overview

`packer` is a standalone cutting engine module.

It provides:

- 2D sheet packing with guillotine-style target passes
- 1D profile packing mode
- optional part rotation (if allowed by stock)

Main goal:

- receive normalized input objects
- produce cut maps (placed parts + leftovers)
- fail fast on invalid input (returns `error` field without automatic console logging)

The module uses only canonical fields.

## Public API

- `packSheets(stock, parts, settings)`

Standalone package entrypoint:

- `index.js`

## Core Contracts (Canonical)

### `settings`

```json
{
  "sheetTrim": 10,
  "kerf": 4,
  "minLeftoverSize": 1,
  "maxRecursionDepth": 64
}
```

- `sheetTrim`: sheet border trim from each side
- `kerf`: cutting tool thickness
- `minLeftoverSize` (optional): minimum leftover size to include in output
- `maxRecursionDepth` (optional, 2D): max recursive fill depth per target pass, defaults to `64`
- Input must already contain final dimensions for packing.

### `stock`

```json
{
  "id": "stock_xl_2750x1830",
  "mode": "2d",
  "width": 1830,
  "height": 2750,
  "allowRotation": true
}
```

- `mode`: `"2d"` or `"1d"`

### `part` (input canonical)

```json
{
  "id": 317490,
  "width": 500,
  "height": 540,
  "count": 3
}
```

Required fields:

- `id`, `width`, `height`

Optional fields:

- `count` (integer `>= 1`, default `1`)

### `packSheets(...)` return

```json
{
  "results": [
    {
      "width": 1830,
      "height": 2750,
      "partsCount": 24,
      "percentage": "91.3",
      "usedArea": 4567890,
      "runDirection": "vertical",
      "items": [
        { "type": "parts", "id": 1, "x": 10, "y": 10, "width": 500, "height": 540 },
        { "type": "materials", "id": "sheet_remainder", "x": 1510, "y": 10, "width": 320, "height": 2740 }
      ]
    }
  ],
  "tooBigParts": [],
  "unplacedParts": [],
  "stopReason": null,
  "stats": {
    "inputParts": 24,
    "placedParts": 24,
    "usedAreaTotal": 4567890,
    "efficiency": 91.3,
    "sheetIterations": 1,
    "maxSheetIterations": 1000,
    "directionalPasses": 8,
    "maxRecursionDepthReached": false,
    "maxRecursionDepthObserved": 3,
    "directionalGuardLimitReached": false
  }
}
```

- `results[*].items` contains both:
  - placed parts (`type: "parts"`)
  - leftovers (`type: "materials"`)
- `tooBigParts`: parts that cannot fit the effective sheet bounds
- `unplacedParts`: parts that fit bounds but were not placed by current heuristic run
- `stopReason`: `null` or machine-readable reason (for example `validation_error`, `no_progress`, `directional_guard_limit_reached`, `max_sheet_iterations_reached`)
- `stats`: diagnostic execution metrics for analysis/debug

### `packSheets(...)` validation error return

```json
{
  "results": [],
  "tooBigParts": [],
  "unplacedParts": [],
  "stopReason": "validation_error",
  "error": "[packer] ...validation message..."
}
```

Input/output adaptation for specific UIs should be done outside this module.
