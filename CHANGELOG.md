## [1.0.0] - 2026-02-28

Major release with comprehensive API overhaul, critical bug fixes, and full test coverage. This is the first stable release.

### Added
- Explicit `stopReason` field in results indicating why packing stopped (no_progress, max_sheet_iterations_reached, directional_guard_limit_reached, or null for success)
- Comprehensive `stats` object containing: inputParts, placedParts, usedAreaTotal, efficiency percentage, sheetIterations, maxSheetIterations, directionalPasses, maxRecursionDepthReached, maxRecursionDepthObserved, directionalGuardLimitReached
- Separate `unplacedParts` array distinct from `tooBigParts` to differentiate between oversized parts and parts that couldn't fit due to packing heuristics
- Settings parameter `minLeftoverSize` to filter out leftovers smaller than specified threshold
- Settings parameter `maxRecursionDepth` (default 64) to control recursive fill depth with diagnostics
- JSDoc documentation for all key functions including DP algorithms and packing heuristics
- Property-based test support for invariant verification
- Comprehensive stress tests for 1000+ parts
- Guard limits dynamically scaled based on parts count (Math.max(n*2, 200) for directional, Math.max(n*2, 1000) for sheets)
- Dedicated validation for extreme dimensions (MAX_DIMENSION = 1e8) to prevent overflow
- DP_SCALE (10x) and toDpUnits conversion for floating-point stability in knapsack algorithms
- Detailed diagnostics in stats for debugging packing behavior

### Changed
- `packSheets` is now synchronous (removed `async` keyword)
- Return type changed from Promise to direct object with expanded fields
- Guard iteration limits now scale with input size instead of fixed thresholds
- 1D profile packing now uses `stock.width` instead of hardcoded profileWidth=200
- Error handling refactored: validation errors returned with stopReason='validation_error' instead of console.error side-effects
- Target candidates filtering optimized to O(n) with Set instead of recreating sorted candidates
- Leftover dimensions validated with EPSILON (1e-6) for floating-point safety
- All size comparisons now consistently use EPSILON tolerance

### Fixed
- [P0] Removed async/await overhead - function was synchronous but incorrectly marked async
- [P0] Eliminated console.error side-effects from validation (errors now in return object only)
- [P0] Resolved potential lost details by separating tooBigParts and unplacedParts
- [P0] Guard cycles no longer premature-stop packing (scaled to Math.max(length*2, minimum))
- [P0] Added explicit stopReason to indicate why packing terminated
- [P1] Unified EPSILON (1e-6) across all fit checks (packSheets.js, runTargetPass.js, pickBestSubsetByAxisCapacity)
- [P1] Fixed DP precision loss: converted floating-point dimensions to scaled integers (value * DP_SCALE) before knapsack
- [P1] Added minLeftoverSize filtering to exclude tiny remainders from output
- [P1] Fixed hardcoded profileWidth (was 200) in 1D mode - now uses stock.width
- [P1] Fixed 1D pack-line x-coordinate always 0 - now respects stock width
- [P1] Optimized candidate filtering from O(n log n) sort to O(n) Set filter
- [P1] Improved part removal safety: uses object reference equality, not just ID matching
- [P2] Added comprehensive stats object for diagnostics
- [P2] Added maxRecursionDepth tracking in return value without console spam
- [P2] Removed magic numbers from 1D packing: profileWidth, profileSideOffset
- [P2] Added JSDoc for complex algorithms: pickBestPartsFor1DLength, pickBestSubsetByAxisCapacity, runTargetPassInternal
- [P2] Added strict dimension validation (MAX_DIMENSION = 1e8) to catch malformed input
- [P2] Updated README.md with diagnostic fields documentation

### Tests (Comprehensive Coverage)
- [x] 1000+ parts stress tests (now validates performance with large datasets)
- [x] Overlap detection (no two parts can occupy same coordinates)
- [x] Float precision tests (dashes, centering, trim alignment)
- [x] Sheet trim extremes (trim > available space)
- [x] Kerf boundary cases (kerf near part dimensions)
- [x] Duplicate ID handling (parts with same ID placed independently)
- [x] Percentage/usedArea correctness (efficiency calculations verified)
- [x] Duplicate placement detection (single part cannot appear twice)
- [x] minLeftoverSize parameter behavior
- [x] maxRecursionDepth parameter and limit tracking
- [x] stats and stopReason fields correctness
- [x] Property-based invariants with fast-check (bounds, overlap, count)
- [x] 2D mode with allowRotation=true/false
- [x] 1D mode with varying stock dimensions
- [x] Invalid input validation (type, range, dimension checks)

### Documentation
- Updated README.md with new diagnostic fields: stopReason, stats, unplacedParts
- Added section explaining efficiency calculation (usedArea / totalCapacity * 100)
- Documented all settings parameters including minLeftoverSize and maxRecursionDepth
- Added diagnostics guide explaining when/why packing stops

### Performance
- Guard limits scale with input size to handle 1000+ parts efficiently
- O(n) candidate filtering instead of O(n log n) sorting per iteration
- Cached metrics via WeakMap to avoid recomputation
- DP with integer scaling (DP_SCALE=10) instead of floating-point precision issues

### Breaking Changes
- `packSheets` no longer returns a Promise (now synchronous)
- Return object structure expanded with new required fields (stopReason, stats, unplacedParts)
- console.error calls removed from validation (use stopReason instead)
- Separation of tooBigParts and unplacedParts may require consumer code updates