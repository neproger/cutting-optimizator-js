// encoding: utf-8
// runTargetPass.js

export const CUT_AXIS = {
    VERTICAL: 'vertical',
    HORIZONTAL: 'horizontal',
};

const EPSILON = 1e-6;
const DP_SCALE = 10;

const parseNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => Math.max(0, parseNumber(value, fallback));
const toDpUnits = (value) => Math.max(0, Math.ceil((toNonNegativeNumber(value) - EPSILON) * DP_SCALE));

const normalizeAxis = (axis) => {
    if (axis === CUT_AXIS.VERTICAL || axis === 'V') return CUT_AXIS.VERTICAL;
    if (axis === CUT_AXIS.HORIZONTAL || axis === 'H') return CUT_AXIS.HORIZONTAL;
    return CUT_AXIS.VERTICAL;
};

const toMaterialPieceIfValid = (piece) => {
    if (!piece || piece.width <= EPSILON || piece.height <= EPSILON) return null;
    return {
        ...piece,
        type: 'materials',
    };
};

const getSingleValidLeftover = (piece) => {
    const valid = toMaterialPieceIfValid(piece);
    return valid ? [valid] : [];
};

const getOppositeAxis = (axis) =>
    axis === CUT_AXIS.VERTICAL ? CUT_AXIS.HORIZONTAL : CUT_AXIS.VERTICAL;

const createPartPlacement = (part, x, y) => ({
    ...part,
    type: 'parts',
    x,
    y,
});

const createPassResult = ({
    success,
    placements,
    leftovers,
    remainingParts,
    maxRecursionDepthReached = false,
    maxRecursionDepthObserved = 0,
}) => ({
    success,
    placements,
    leftovers,
    remainingParts,
    maxRecursionDepthReached,
    maxRecursionDepthObserved,
});

const createRuntimeCache = () => ({
    metricsByPart: new WeakMap(),
    rotatedByPart: new WeakMap(),
});

const getPartMetrics = (part, cache) => {
    if (!part || typeof part !== 'object') {
        return { width: 0, height: 0, area: 0 };
    }

    let metrics = cache.metricsByPart.get(part);
    if (metrics) return metrics;

    const width = toNonNegativeNumber(part?.width);
    const height = toNonNegativeNumber(part?.height);
    metrics = { width, height, area: width * height };
    cache.metricsByPart.set(part, metrics);
    return metrics;
};

const fitsBounds = (width, height, maxWidth, maxHeight) =>
    width <= maxWidth + EPSILON && height <= maxHeight + EPSILON;

const getRotatedPart = (part, cache) => {
    if (!part || typeof part !== 'object') return null;

    let rotated = cache.rotatedByPart.get(part);
    if (rotated) return rotated;

    const nextWidth = toNonNegativeNumber(part?.height);
    const nextHeight = toNonNegativeNumber(part?.width);

    rotated = {
        ...part,
        width: nextWidth,
        height: nextHeight,
        isRotated: true,
    };

    cache.rotatedByPart.set(part, rotated);
    return rotated;
};

const chooseBestOrientationForBounds = (part, maxWidth, maxHeight, allowRotation, cache) => {
    const baseMetrics = getPartMetrics(part, cache);
    if (fitsBounds(baseMetrics.width, baseMetrics.height, maxWidth, maxHeight)) return part;

    if (!allowRotation) return null;
    const rotatedPart = getRotatedPart(part, cache);
    const rotatedMetrics = getPartMetrics(rotatedPart, cache);
    return fitsBounds(rotatedMetrics.width, rotatedMetrics.height, maxWidth, maxHeight) ? rotatedPart : null;
};

const buildTargetStripAndMainRemainder = (piece, targetPartMetrics, axis, cuttingTool) => {
    if (axis === CUT_AXIS.VERTICAL) {
        const stripWidth = targetPartMetrics.width;
        const mainRemainder = {
            ...piece,
            id: `${piece.id || 'piece'}_remainder_main`,
            x: piece.x + stripWidth + cuttingTool,
            y: piece.y,
            width: piece.width - stripWidth - cuttingTool,
            height: piece.height,
            type: 'materials',
        };

        return {
            strip: {
                ...piece,
                id: `${piece.id || 'piece'}_strip`,
                width: stripWidth,
                type: 'materials',
            },
            mainRemainder,
        };
    }

    const stripHeight = targetPartMetrics.height;
    const mainRemainder = {
        ...piece,
        id: `${piece.id || 'piece'}_remainder_main`,
        x: piece.x,
        y: piece.y + stripHeight + cuttingTool,
        width: piece.width,
        height: piece.height - stripHeight - cuttingTool,
        type: 'materials',
    };

    return {
        strip: {
            ...piece,
            id: `${piece.id || 'piece'}_strip`,
            height: stripHeight,
            type: 'materials',
        },
        mainRemainder,
    };
};

const removeTargetPartFromPool = (partsPool, targetPart) => {
    if (!Array.isArray(partsPool) || partsPool.length === 0) return [];

    let removeIndex = -1;
    for (let i = 0; i < partsPool.length; i += 1) {
        if (partsPool[i] === targetPart) {
            removeIndex = i;
            break;
        }
    }

    if (removeIndex < 0) return partsPool.slice();
    if (partsPool.length === 1) return [];

    const result = new Array(partsPool.length - 1);
    let writeIndex = 0;
    for (let i = 0; i < partsPool.length; i += 1) {
        if (i === removeIndex) continue;
        result[writeIndex] = partsPool[i];
        writeIndex += 1;
    }
    return result;
};

/**
 * 0/1 knapsack on strip axis capacity.
 * Objective: maximize packed area while respecting axis length + kerf budget.
 */
const pickBestSubsetByAxisCapacity = (entries, capacity, cuttingTool) => {
    const cap = toDpUnits(capacity);
    if (cap <= 0 || !Array.isArray(entries) || entries.length === 0) return [];

    const kerfInt = toDpUnits(cuttingTool);
    const dpArea = new Float64Array(cap + 1);
    const prevCap = new Int32Array(cap + 1);
    const pickedIdx = new Int32Array(cap + 1);

    for (let c = 0; c <= cap; c += 1) {
        dpArea[c] = -1;
        prevCap[c] = -1;
        pickedIdx[c] = -1;
    }
    dpArea[0] = 0;

    for (let idx = 0; idx < entries.length; idx += 1) {
        const entry = entries[idx];
        const size = toDpUnits(entry.axisSize) + kerfInt;
        if (size <= 0 || size > cap) continue;

        for (let c = cap; c >= size; c -= 1) {
            const sourceCap = c - size;
            const prevArea = dpArea[sourceCap];
            if (prevArea < 0) continue;

            const candidateArea = prevArea + entry.area;
            if (candidateArea > dpArea[c]) {
                dpArea[c] = candidateArea;
                prevCap[c] = sourceCap;
                pickedIdx[c] = idx;
            }
        }
    }

    let bestCap = 0;
    for (let c = 1; c <= cap; c += 1) {
        if (dpArea[c] > dpArea[bestCap]) bestCap = c;
    }

    if (dpArea[bestCap] <= 0) return [];

    const picks = [];
    let cursor = bestCap;
    while (cursor > 0 && pickedIdx[cursor] >= 0) {
        picks.push(pickedIdx[cursor]);
        cursor = prevCap[cursor];
    }

    picks.reverse();
    return picks;
};

const getPieceArea = (piece) => toNonNegativeNumber(piece?.width) * toNonNegativeNumber(piece?.height);

const pickLargestFittingTargetForPiece = (partsPool, piece, allowRotation, cache) => {
    if (!Array.isArray(partsPool) || partsPool.length === 0 || !piece) return null;

    let bestPart = null;
    let bestMetrics = null;

    for (let i = 0; i < partsPool.length; i += 1) {
        const candidatePart = partsPool[i];
        const oriented = chooseBestOrientationForBounds(
            candidatePart,
            piece.width,
            piece.height,
            allowRotation,
            cache
        );
        if (!oriented) continue;

        const metrics = getPartMetrics(oriented, cache);
        if (!bestPart) {
            bestPart = candidatePart;
            bestMetrics = metrics;
            continue;
        }

        if (metrics.width > bestMetrics.width || (metrics.width === bestMetrics.width && metrics.height > bestMetrics.height)) {
            bestPart = candidatePart;
            bestMetrics = metrics;
        }
    }

    return bestPart;
};

/**
 * Runs one target pass and optional recursive fill on generated leftovers.
 * Returns placements, leftovers, remaining pool and recursion diagnostics.
 */
const runTargetPassInternal = ({
    piece,
    targetPart,
    partsPool,
    cuttingTool = 0,
    axis = CUT_AXIS.VERTICAL,
    allowRotation = false,
    enableRecursiveFill = true,
    recursionDepth = 0,
    maxRecursionDepth = 64,
    cache,
}) => {
    const normalizedAxis = normalizeAxis(axis);
    const kerf = toNonNegativeNumber(cuttingTool);
    const safePool = Array.isArray(partsPool) ? partsPool : [];
    const runtimeCache = cache || createRuntimeCache();

    if (!piece || !targetPart || piece.width <= 0 || piece.height <= 0) {
        return createPassResult({
            success: false,
            placements: [],
            leftovers: getSingleValidLeftover(piece),
            remainingParts: safePool,
            maxRecursionDepthReached: false,
            maxRecursionDepthObserved: recursionDepth,
        });
    }

    const orientedTarget = chooseBestOrientationForBounds(
        targetPart,
        piece.width,
        piece.height,
        allowRotation,
        runtimeCache
    );
    if (!orientedTarget) {
        return createPassResult({
            success: false,
            placements: [],
            leftovers: getSingleValidLeftover(piece),
            remainingParts: safePool,
            maxRecursionDepthReached: false,
            maxRecursionDepthObserved: recursionDepth,
        });
    }

    const targetMetrics = getPartMetrics(orientedTarget, runtimeCache);
    const targetPlacement = createPartPlacement(orientedTarget, piece.x, piece.y);
    const { strip: targetStrip, mainRemainder } = buildTargetStripAndMainRemainder(
        piece,
        targetMetrics,
        normalizedAxis,
        kerf
    );

    const poolWithoutTarget = removeTargetPartFromPool(safePool, targetPart);
    const orientedCandidates = [];
    const stripWidth = targetStrip.width;
    const stripHeight = targetStrip.height;

    for (let sourceIndex = 0; sourceIndex < poolWithoutTarget.length; sourceIndex += 1) {
        const part = poolWithoutTarget[sourceIndex];
        const oriented = chooseBestOrientationForBounds(
            part,
            stripWidth,
            stripHeight,
            allowRotation,
            runtimeCache
        );
        if (!oriented) continue;

        const metrics = getPartMetrics(oriented, runtimeCache);
        orientedCandidates.push({
            sourceIndex,
            oriented,
            width: metrics.width,
            height: metrics.height,
            area: metrics.area,
            axisSize: normalizedAxis === CUT_AXIS.VERTICAL ? metrics.height : metrics.width,
        });
    }

    const targetAxisSize = normalizedAxis === CUT_AXIS.VERTICAL ? targetMetrics.height : targetMetrics.width;
    const stripAxisSize = normalizedAxis === CUT_AXIS.VERTICAL ? stripHeight : stripWidth;
    const freeAxisCapacity = Math.max(0, stripAxisSize - targetAxisSize);

    const selectedCandidateIndexes = pickBestSubsetByAxisCapacity(orientedCandidates, freeAxisCapacity, kerf);
    const selectedEntries = selectedCandidateIndexes.map((idx) => orientedCandidates[idx]);

    if (selectedEntries.length > 1) {
        selectedEntries.sort((left, right) => {
            if (right.width !== left.width) return right.width - left.width;
            return right.height - left.height;
        });
    }

    const selectedSourceMarks = new Uint8Array(poolWithoutTarget.length);
    const additionalPlacements = [];
    const stripInnerLeftovers = [];
    let axisCursor = targetAxisSize + kerf;

    for (let i = 0; i < selectedEntries.length; i += 1) {
        const entry = selectedEntries[i];
        selectedSourceMarks[entry.sourceIndex] = 1;

        if (normalizedAxis === CUT_AXIS.VERTICAL) {
            const placementX = targetStrip.x;
            const placementY = targetStrip.y + axisCursor;
            additionalPlacements.push(createPartPlacement(entry.oriented, placementX, placementY));

            const rightRemainder = toMaterialPieceIfValid({
                id: `${targetStrip.id}_right_${entry.sourceIndex}`,
                x: placementX + entry.width + kerf,
                y: placementY,
                width: stripWidth - entry.width - kerf,
                height: entry.height,
            });
            if (rightRemainder) stripInnerLeftovers.push(rightRemainder);

            axisCursor += entry.height + kerf;
        } else {
            const placementX = targetStrip.x + axisCursor;
            const placementY = targetStrip.y;
            additionalPlacements.push(createPartPlacement(entry.oriented, placementX, placementY));

            const bottomRemainder = toMaterialPieceIfValid({
                id: `${targetStrip.id}_bottom_${entry.sourceIndex}`,
                x: placementX,
                y: placementY + entry.height + kerf,
                width: entry.width,
                height: stripHeight - entry.height - kerf,
            });
            if (bottomRemainder) stripInnerLeftovers.push(bottomRemainder);

            axisCursor += entry.width + kerf;
        }
    }

    const stripTailRemainder = normalizedAxis === CUT_AXIS.VERTICAL
        ? toMaterialPieceIfValid({
            id: `${targetStrip.id}_tail`,
            x: targetStrip.x,
            y: targetStrip.y + axisCursor,
            width: stripWidth,
            height: stripHeight - axisCursor,
        })
        : toMaterialPieceIfValid({
            id: `${targetStrip.id}_tail`,
            x: targetStrip.x + axisCursor,
            y: targetStrip.y,
            width: stripWidth - axisCursor,
            height: stripHeight,
        });

    const remainingParts = [];
    for (let i = 0; i < poolWithoutTarget.length; i += 1) {
        if (selectedSourceMarks[i] === 0) remainingParts.push(poolWithoutTarget[i]);
    }

    const placements = [targetPlacement, ...additionalPlacements];
    const mainRemainderPiece = toMaterialPieceIfValid(mainRemainder);

    const stripGeneratedLeftovers = [];
    if (stripTailRemainder) stripGeneratedLeftovers.push(stripTailRemainder);
    if (stripInnerLeftovers.length > 0) stripGeneratedLeftovers.push(...stripInnerLeftovers);

    const immediateLeftovers = [];
    if (mainRemainderPiece) immediateLeftovers.push(mainRemainderPiece);
    if (stripGeneratedLeftovers.length > 0) immediateLeftovers.push(...stripGeneratedLeftovers);

    const maxDepthReached = recursionDepth >= maxRecursionDepth;
    if (!enableRecursiveFill || maxDepthReached || remainingParts.length === 0 || immediateLeftovers.length === 0) {
        return createPassResult({
            success: true,
            placements,
            leftovers: immediateLeftovers,
            remainingParts,
            maxRecursionDepthReached: maxDepthReached,
            maxRecursionDepthObserved: recursionDepth,
        });
    }

    const recursiveSeedPieces = recursionDepth === 0 ? stripGeneratedLeftovers : immediateLeftovers;
    if (recursiveSeedPieces.length === 0) {
        return createPassResult({
            success: true,
            placements,
            leftovers: immediateLeftovers,
            remainingParts,
            maxRecursionDepthReached: false,
            maxRecursionDepthObserved: recursionDepth,
        });
    }

    const recursivePieces = [...recursiveSeedPieces].sort((left, right) => getPieceArea(right) - getPieceArea(left));
    const recursivePlacements = [...placements];
    const recursiveLeftovers = recursionDepth === 0 && mainRemainderPiece ? [mainRemainderPiece] : [];
    let recursiveRemainingParts = remainingParts;
    let recursionLimitHit = false;
    let maxObservedDepth = recursionDepth;

    for (let i = 0; i < recursivePieces.length; i += 1) {
        const remainderPiece = recursivePieces[i];

        if (recursiveRemainingParts.length === 0) {
            recursiveLeftovers.push(remainderPiece);
            continue;
        }

        const nestedTargetPart = pickLargestFittingTargetForPiece(
            recursiveRemainingParts,
            remainderPiece,
            allowRotation,
            runtimeCache
        );

        if (!nestedTargetPart) {
            recursiveLeftovers.push(remainderPiece);
            continue;
        }

        const nestedResult = runTargetPassInternal({
            piece: remainderPiece,
            targetPart: nestedTargetPart,
            partsPool: recursiveRemainingParts,
            cuttingTool: kerf,
            axis: getOppositeAxis(normalizedAxis),
            allowRotation,
            enableRecursiveFill: true,
            recursionDepth: recursionDepth + 1,
            maxRecursionDepth,
            cache: runtimeCache,
        });

        if (!nestedResult.success) {
            recursiveLeftovers.push(remainderPiece);
            continue;
        }

        if (nestedResult.placements.length > 0) recursivePlacements.push(...nestedResult.placements);
        if (nestedResult.leftovers.length > 0) recursiveLeftovers.push(...nestedResult.leftovers);
        recursiveRemainingParts = nestedResult.remainingParts;
        recursionLimitHit = recursionLimitHit || nestedResult.maxRecursionDepthReached;
        if (nestedResult.maxRecursionDepthObserved > maxObservedDepth) {
            maxObservedDepth = nestedResult.maxRecursionDepthObserved;
        }
    }

    return createPassResult({
        success: true,
        placements: recursivePlacements,
        leftovers: recursiveLeftovers,
        remainingParts: recursiveRemainingParts,
        maxRecursionDepthReached: recursionLimitHit,
        maxRecursionDepthObserved: maxObservedDepth,
    });
};

export const runTargetPass = ({
    piece,
    targetPart,
    partsPool,
    cuttingTool = 0,
    axis = CUT_AXIS.VERTICAL,
    allowRotation = false,
    enableRecursiveFill = true,
    maxRecursionDepth = 64,
}) => runTargetPassInternal({
    piece,
    targetPart,
    partsPool,
    cuttingTool,
    axis,
    allowRotation,
    enableRecursiveFill,
    recursionDepth: 0,
    maxRecursionDepth: Math.max(0, Math.floor(maxRecursionDepth)),
    cache: createRuntimeCache(),
});
