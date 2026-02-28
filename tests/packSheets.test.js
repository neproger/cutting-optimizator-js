import test from 'node:test';
import assert from 'node:assert/strict';

import { packSheets } from '../core/packSheets.js';

const getPlacedParts = (map) => (Array.isArray(map?.items) ? map.items.filter((item) => item.type === 'parts') : []);

test('packSheets: basic 2D packing', async () => {
    const result = await packSheets(
        { id: 'stock-2d', mode: '2d', width: 100, height: 100, allowRotation: false },
        [{ id: 'p1', width: 50, height: 50, count: 2 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.results.length, 1);
    assert.ok(Array.isArray(result.results[0].items));
    assert.equal(result.results[0].result, undefined);
    assert.equal(getPlacedParts(result.results[0]).length, 2);
});

test('packSheets: 1D mode packing', async () => {
    const result = await packSheets(
        { id: 'stock-1d', mode: '1d', width: 200, height: 1000, allowRotation: false },
        [
            { id: 'p1', width: 20, height: 300 },
            { id: 'p2', width: 20, height: 500 },
        ],
        { sheetTrim: 10, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.tooBigParts.length, 0);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].partsCount, 2);
    assert.equal(getPlacedParts(result.results[0]).length, 2);
});

test('packSheets: part count expansion', async () => {
    const result = await packSheets(
        { id: 'stock-count', mode: '2d', width: 120, height: 120, allowRotation: false },
        [{ id: 'p1', width: 20, height: 20, count: 3 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.results.length, 1);
    assert.equal(getPlacedParts(result.results[0]).length, 3);
});

test('packSheets: returns error on invalid input', async () => {
    const result = await packSheets(
        { id: 'stock-invalid', mode: '2d', width: 100, height: 100, allowRotation: true },
        [{ id: 'p1', width: '100', height: 30 }],
        { sheetTrim: 0, kerf: 0 }
    );

    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.includes('[packer]'));
    assert.equal(result.results.length, 0);
    assert.equal(result.tooBigParts.length, 0);
});

test('packSheets: rotation off/on behavior', async () => {
    const basePart = { id: 'p1', width: 80, height: 40 };
    const settings = { sheetTrim: 0, kerf: 0 };

    const withoutRotation = await packSheets(
        { id: 'stock-no-rot', mode: '2d', width: 60, height: 90, allowRotation: false },
        [basePart],
        settings
    );
    assert.equal(withoutRotation.results.length, 0);
    assert.equal(withoutRotation.tooBigParts.length, 1);

    const withRotation = await packSheets(
        { id: 'stock-rot', mode: '2d', width: 60, height: 90, allowRotation: true },
        [basePart],
        settings
    );
    assert.equal(withRotation.error, undefined);
    assert.equal(withRotation.tooBigParts.length, 0);
    assert.equal(withRotation.results.length, 1);
    const placed = getPlacedParts(withRotation.results[0]);
    assert.equal(placed.length, 1);
    assert.equal(placed[0].isRotated, true);
});
