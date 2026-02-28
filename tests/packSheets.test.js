import test from 'node:test';
import assert from 'node:assert/strict';

import { packSheets } from '../core/packSheets.js';

const getPlacedParts = (map) => (Array.isArray(map?.items) ? map.items.filter((item) => item.type === 'parts') : []);
const overlaps = (a, b) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

test('packSheets: basic 2D packing', () => {
    const result = packSheets(
        { id: 'stock-2d', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 50, height: 50, count: 2 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
    assert.equal(result.stopReason, null);
    assert.equal(result.results.length, 1);
    assert.ok(Array.isArray(result.results[0].items));
    assert.equal(result.results[0].result, undefined);
    assert.equal(getPlacedParts(result.results[0]).length, 2);
});

test('packSheets: 1D mode packing', () => {
    const result = packSheets(
        { id: 'stock-1d', mode: '1d', width: 200, height: 1000, allowRotation: false },
        [
            { id: 'p1', width: 20, height: 300 },
            { id: 'p2', width: 20, height: 500 },
        ],
        { sheetTrim: 10, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
    assert.equal(result.stopReason, null);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].partsCount, 2);
    assert.equal(getPlacedParts(result.results[0]).length, 2);
});

test('packSheets: part count expansion', () => {
    const result = packSheets(
        { id: 'stock-count', mode: '2d', width: 120, height: 120, allowRotation: false },
        [{ id: 'p1', width: 20, height: 20, count: 3 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.unplacedParts.length, 0);
    assert.equal(result.stopReason, null);
    assert.equal(result.results.length, 1);
    assert.equal(getPlacedParts(result.results[0]).length, 3);
});

test('packSheets: returns error on invalid input', () => {
    const result = packSheets(
        { id: 'stock-invalid', mode: '2d', width: 100, height: 100, allowRotation: true },
        [{ id: 'p1', width: '100', height: 30 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.includes('[packer]'));
    assert.equal(result.stopReason, 'validation_error');
    assert.equal(result.results.length, 0);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
});

test('packSheets: rotation off/on behavior', () => {
    const basePart = { id: 'p1', width: 80, height: 40 };
    const settings = { sheetTrim: 0, kerf: 0 };

    const withoutRotation = packSheets(
        { id: 'stock-no-rot', mode: '2d', width: 60, height: 90, allowRotation: false },
        [basePart],
        settings
    );
    assert.equal(withoutRotation.results.length, 0);
    assert.equal(withoutRotation.tooBigParts.length, 1);
    assert.equal(withoutRotation.unplacedParts.length, 0);
    assert.equal(withoutRotation.stopReason, null);

    const withRotation = packSheets(
        { id: 'stock-rot', mode: '2d', width: 60, height: 90, allowRotation: true },
        [basePart],
        settings
    );
    assert.equal(withRotation.error, undefined);
    assert.equal(withRotation.tooBigParts.length, 0);
    assert.equal(withRotation.unplacedParts.length, 0);
    assert.equal(withRotation.stopReason, null);
    assert.equal(withRotation.results.length, 1);
    const placed = getPlacedParts(withRotation.results[0]);
    assert.equal(placed.length, 1);
    assert.equal(placed[0].isRotated, true);
});

test('packSheets: 1D defaults use stock width', () => {
    const result = packSheets(
        { id: 'stock-1d-width', mode: '1d', width: 80, height: 200, allowRotation: false },
        [{ id: 'p1', width: 10, height: 100 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].width, 80);
    const placed = getPlacedParts(result.results[0]);
    assert.equal(placed.length, 1);
    assert.equal(placed[0].width, 80);
});

test('packSheets: minLeftoverSize filters tiny 1D leftovers', () => {
    const result = packSheets(
        { id: 'stock-1d-leftover', mode: '1d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 10, height: 99.5 }],
        { sheetTrim: 0, kerf: 0, minLeftoverSize: 1 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 1);
    const materials = result.results[0].items.filter((item) => item.type === 'materials');
    assert.equal(materials.length, 0);
});

test('packSheets: returns validation error on invalid minLeftoverSize', () => {
    const result = packSheets(
        { id: 'stock-invalid-setting', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 20, height: 20 }],
        { sheetTrim: 0, kerf: 0, minLeftoverSize: -1 }
    );

    assert.equal(result.results.length, 0);
    assert.equal(result.stopReason, 'validation_error');
    assert.ok(result.error.includes('minLeftoverSize'));
});

test('packSheets: epsilon tolerance allows near-boundary fit', () => {
    const result = packSheets(
        { id: 'stock-epsilon', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 100.0000004, height: 100 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
    assert.equal(result.results.length, 1);
    assert.equal(getPlacedParts(result.results[0]).length, 1);
});

test('packSheets: 1D decimal DP does not overpack profile length', () => {
    const result = packSheets(
        { id: 'stock-1d-decimal', mode: '1d', width: 80, height: 100.9, allowRotation: false },
        [
            { id: 'p1', width: 10, height: 50.6 },
            { id: 'p2', width: 10, height: 50.6 },
        ],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 2);
    assert.equal(result.tooBigParts.length, 0);
});

test('packSheets: 2D decimal DP does not place part outside sheet bounds', () => {
    const stock = { id: 'stock-2d-decimal', mode: '2d', width: 100, height: 100, allowRotation: false };
    const result = packSheets(
        stock,
        [
            { id: 'p1', width: 60, height: 50 },
            { id: 'p2', width: 60, height: 50.6 },
        ],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 2);
    let placedCount = 0;
    for (const map of result.results) {
        const placed = getPlacedParts(map);
        assert.ok(placed.length <= 1);
        placedCount += placed.length;
        for (const item of placed) {
            assert.ok(item.x + item.width <= stock.width + 1e-6);
            assert.ok(item.y + item.height <= stock.height + 1e-6);
        }
    }
    assert.equal(placedCount, 2);
});

test('packSheets: handles duplicate part ids without dropping items', () => {
    const result = packSheets(
        { id: 'stock-dup-id', mode: '2d', width: 100, height: 50, allowRotation: false },
        [
            { id: 'dup', width: 50, height: 50 },
            { id: 'dup', width: 50, height: 50 },
        ],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 1);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
    const placed = getPlacedParts(result.results[0]);
    assert.equal(placed.length, 2);
    assert.equal(placed[0].id, 'dup');
    assert.equal(placed[1].id, 'dup');
});

test('packSheets: returns stats object', () => {
    const result = packSheets(
        { id: 'stock-stats', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 50, height: 50, count: 2 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(typeof result.stats, 'object');
    assert.equal(result.stats.inputParts, 2);
    assert.equal(result.stats.placedParts, 2);
    assert.ok(result.stats.sheetIterations >= 1);
    assert.ok(result.stats.directionalPasses >= 1);
    assert.equal(typeof result.stats.directionalGuardLimitReached, 'boolean');
});

test('packSheets: stats indicate recursion depth limit reached', () => {
    const result = packSheets(
        { id: 'stock-rec-limit', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 50, height: 60, count: 3 }],
        { sheetTrim: 0, kerf: 0, maxRecursionDepth: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.stats.maxRecursionDepthReached, true);
    assert.equal(result.stats.maxRecursionDepthObserved, 0);
});

test('packSheets: sheetTrim larger than sheet returns tooBigParts', () => {
    const result = packSheets(
        { id: 'stock-trim', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 10, height: 10 }],
        { sheetTrim: 60, kerf: 0 }
    );

    assert.equal(result.results.length, 0);
    assert.equal(result.tooBigParts.length, 1);
    assert.equal(result.unplacedParts.length, 0);
});

test('packSheets: kerf edge case splits into multiple sheets', () => {
    const result = packSheets(
        { id: 'stock-kerf', mode: '2d', width: 100, height: 100, allowRotation: false },
        [
            { id: 'p1', width: 50, height: 100 },
            { id: 'p2', width: 50, height: 100 },
        ],
        { sheetTrim: 0, kerf: 1 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 2);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
});

test('packSheets: percentage and usedArea are consistent', () => {
    const result = packSheets(
        { id: 'stock-metrics', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 40, height: 50 }],
        { sheetTrim: 0, kerf: 0 }
    );

    const map = result.results[0];
    assert.equal(map.usedArea, 2000);
    assert.equal(map.percentage, '20.0');
});

test('packSheets: no overlaps and no duplicate placements per sheet', () => {
    const result = packSheets(
        { id: 'stock-overlap', mode: '2d', width: 120, height: 120, allowRotation: false },
        [{ id: 'p', width: 20, height: 20, count: 20 }],
        { sheetTrim: 0, kerf: 0 }
    );

    let totalPlaced = 0;
    for (const map of result.results) {
        const placed = getPlacedParts(map);
        totalPlaced += placed.length;
        const seen = new Set();

        for (let i = 0; i < placed.length; i += 1) {
            const p = placed[i];
            const key = `${p.id}:${p.x}:${p.y}:${p.width}:${p.height}`;
            assert.equal(seen.has(key), false);
            seen.add(key);

            assert.ok(p.x >= 0 && p.y >= 0);
            assert.ok(p.x + p.width <= map.width + 1e-6);
            assert.ok(p.y + p.height <= map.height + 1e-6);

            for (let j = i + 1; j < placed.length; j += 1) {
                assert.equal(overlaps(p, placed[j]), false);
            }
        }
    }

    assert.equal(totalPlaced, 20);
});

test('packSheets: large batch 1000 parts', () => {
    const result = packSheets(
        { id: 'stock-big', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 10, height: 10, count: 1000 }],
        { sheetTrim: 0, kerf: 0 }
    );

    const placed = result.results.reduce((sum, map) => sum + getPlacedParts(map).length, 0);
    assert.equal(placed, 1000);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.unplacedParts.length, 0);
});

test('packSheets: validates too large dimensions', () => {
    const result = packSheets(
        { id: 'stock-too-large', mode: '2d', width: 1e9, height: 100, allowRotation: false },
        [{ id: 'p1', width: 10, height: 10 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.results.length, 0);
    assert.equal(result.stopReason, 'validation_error');
    assert.ok(result.error.includes('too large'));
});
