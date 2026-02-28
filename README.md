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
- fail fast on invalid input (logs error to console and returns `error` field)

The module uses only canonical fields.

## Public API

From `src/modules/packer/index.js`:

- `packSheets(stock, parts, settings)`

Standalone package entrypoint:

- `index.js`

## Core Contracts (Canonical)

### `settings`

```json
{
  "sheetTrim": 10,
  "kerf": 4
}
```

- `sheetTrim`: sheet border trim from each side
- `kerf`: cutting tool thickness
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
  "tooBigParts": []
}
```

- `results[*].items` contains both:
  - placed parts (`type: "parts"`)
  - leftovers (`type: "materials"`)

### `packSheets(...)` validation error return

```json
{
  "results": [],
  "tooBigParts": [],
  "error": "[packer] ...validation message..."
}
```

Input/output adaptation for specific UIs should be done outside this module.
