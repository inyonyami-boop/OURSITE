import { normalizeNodes } from "./grid-model.js";

const EPSILON = 1e-7;

function requireRatio(value, label, defaultValue = 0) {
    const ratio = value === undefined || value === null ? defaultValue : value;
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        throw new RangeError(`${label} must be a finite number between 0 and 1.`);
    }
    return ratio;
}

function getPadding(padding) {
    if (padding === undefined || padding === null) {
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }
    const values = typeof padding === "number"
        ? { top: padding, right: padding, bottom: padding, left: padding }
        : {
            top: padding.top ?? 0,
            right: padding.right ?? 0,
            bottom: padding.bottom ?? 0,
            left: padding.left ?? 0
        };

    for (const [side, value] of Object.entries(values)) {
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError(`Node padding.${side} must be a finite non-negative number.`);
        }
    }
    return values;
}

function getContentRect(rect, padding) {
    return {
        x: rect.x + padding.left,
        y: rect.y + padding.top,
        width: Math.max(0, rect.width - padding.left - padding.right),
        height: Math.max(0, rect.height - padding.top - padding.bottom)
    };
}

function calculateBaseRect(node, parentRect) {
    const horizontal = node.horizontal ?? { mode: "ratio" };
    const vertical = node.vertical ?? { mode: "topOffset" };
    const padding = getPadding(node.padding);
    let x;
    let width;

    if (horizontal.mode === "ratio") {
        const leftRatio = requireRatio(horizontal.leftRatio, `Node "${node.id}" leftRatio`);
        const rightRatio = requireRatio(horizontal.rightRatio, `Node "${node.id}" rightRatio`);
        if (leftRatio + rightRatio >= 1) {
            throw new RangeError(`Node "${node.id}" leftRatio + rightRatio must be less than 1.`);
        }
        x = parentRect.x + leftRatio * parentRect.width;
        if (horizontal.widthRatio !== undefined && horizontal.widthRatio !== null) {
            width = requireRatio(horizontal.widthRatio, `Node "${node.id}" widthRatio`) * parentRect.width;
        } else {
            width = (1 - leftRatio - rightRatio) * parentRect.width;
        }
    } else if (horizontal.mode === "align") {
        const align = horizontal.align ?? "left";
        if (!["left", "center", "right"].includes(align)) {
            throw new TypeError(`Node "${node.id}" horizontal.align must be left, center, or right.`);
        }
        const offsetRatio = requireRatio(horizontal.offsetRatio, `Node "${node.id}" offsetRatio`);
        if (horizontal.widthRatio !== undefined && horizontal.widthRatio !== null) {
            width = requireRatio(horizontal.widthRatio, `Node "${node.id}" widthRatio`) * parentRect.width;
        } else {
            width = node.contentWidth ?? node.width ?? 0;
            if (!Number.isFinite(width) || width < 0) {
                throw new RangeError(`Node "${node.id}" contentWidth must be finite and non-negative.`);
            }
        }

        const offset = offsetRatio * parentRect.width;
        if (align === "left") {
            x = parentRect.x + offset;
        } else if (align === "center") {
            x = parentRect.x + (parentRect.width - width) / 2 + offset;
        } else {
            x = parentRect.x + parentRect.width - width - offset;
        }
    } else {
        throw new TypeError(`Node "${node.id}" horizontal.mode must be "ratio" or "align".`);
    }

    let y;
    let height;
    if (vertical.mode === "topOffset") {
        const topOffset = vertical.topOffset ?? 0;
        if (!Number.isFinite(topOffset)) {
            throw new TypeError(`Node "${node.id}" topOffset must be finite.`);
        }
        // Negative offsets intentionally place a node above the parent's content origin.
        y = parentRect.y + topOffset;
        if (vertical.autoHeight === true) {
            height = vertical.contentHeight ?? node.contentHeight ?? node.height ?? 0;
        } else if (vertical.heightRatio !== undefined && vertical.heightRatio !== null) {
            height = requireRatio(vertical.heightRatio, `Node "${node.id}" heightRatio`) * parentRect.height;
        } else {
            height = vertical.contentHeight ?? node.contentHeight ?? node.height ??
                Math.max(0, parentRect.height - topOffset);
        }
        if (!Number.isFinite(height) || height < 0) {
            throw new RangeError(`Node "${node.id}" content height must be finite and non-negative.`);
        }
    } else if (vertical.mode === "ratio") {
        const topRatio = requireRatio(vertical.topRatio, `Node "${node.id}" topRatio`);
        const bottomRatio = requireRatio(vertical.bottomRatio, `Node "${node.id}" bottomRatio`);
        if (topRatio + bottomRatio >= 1) {
            throw new RangeError(`Node "${node.id}" topRatio + bottomRatio must be less than 1.`);
        }
        y = parentRect.y + topRatio * parentRect.height;
        height = vertical.heightRatio !== undefined && vertical.heightRatio !== null
            ? requireRatio(vertical.heightRatio, `Node "${node.id}" heightRatio`) * parentRect.height
            : (1 - topRatio - bottomRatio) * parentRect.height;
    } else {
        throw new TypeError(`Node "${node.id}" vertical.mode must be "topOffset" or "ratio".`);
    }

    if (!Number.isFinite(width) || width < 0) {
        throw new RangeError(`Node "${node.id}" width must be finite and non-negative.`);
    }
    return { x, y, width, height, padding };
}

function applyAspectRatio(rect, aspectRatio, parentRect, nodeId) {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        throw new RangeError(`Node "${nodeId}" aspectRatio must be a positive finite number.`);
    }

    const baseWidth = rect.width;
    const baseHeight = rect.height;
    const fittedHeight = Math.min(baseHeight, baseWidth / aspectRatio);
    rect.width = fittedHeight * aspectRatio;
    rect.height = fittedHeight;

    let clamped = false;
    const maxX = parentRect.x + parentRect.width;
    const maxY = parentRect.y + parentRect.height;
    const originalX = rect.x;
    const originalY = rect.y;
    rect.x = Math.min(Math.max(rect.x, parentRect.x), maxX);
    rect.y = Math.min(Math.max(rect.y, parentRect.y), maxY);
    clamped ||= Math.abs(rect.x - originalX) > EPSILON || Math.abs(rect.y - originalY) > EPSILON;

    const availableWidth = Math.max(0, maxX - rect.x);
    const availableHeight = Math.max(0, maxY - rect.y);
    const boundaryScale = Math.min(
        1,
        availableWidth / (rect.width || Infinity),
        availableHeight / (rect.height || Infinity)
    );
    if (boundaryScale < 1) {
        rect.width *= boundaryScale;
        rect.height *= boundaryScale;
        clamped = true;
    }
    return clamped;
}

function calculateTree(nodes, width, height) {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const childrenMap = new Map(nodes.map((node) => [node.id, []]));
    const rootIds = [];
    for (const node of nodes) {
        if (node.parentId === null) {
            rootIds.push(node.id);
        } else {
            childrenMap.get(node.parentId).push(node.id);
        }
    }

    function layoutNode(id, parentRect) {
        const node = nodeMap.get(id);
        const base = calculateBaseRect(node, parentRect);
        const rect = {
            id,
            x: base.x,
            y: base.y,
            width: base.width,
            height: base.height,
            clamped: false
        };
        const childIds = childrenMap.get(id);

        function layoutChildren() {
            const contentRect = getContentRect(rect, base.padding);
            return childIds.flatMap((childId) => layoutNode(childId, contentRect));
        }

        let descendants = layoutChildren();
        if (node.vertical?.mode === "topOffset" && node.vertical.autoHeight === true) {
            const childBottom = descendants.reduce(
                (bottom, child) => Math.max(bottom, child.y + child.height - (rect.y + base.padding.top)),
                0
            );
            const contentHeight = node.vertical.contentHeight ?? node.contentHeight ?? node.height ?? 0;
            const derivedHeight = Math.max(contentHeight, childBottom + base.padding.bottom);
            if (Math.abs(derivedHeight - rect.height) > EPSILON) {
                rect.height = derivedHeight;
                descendants = layoutChildren();
            }
        }

        if (node.aspectRatio !== undefined && node.aspectRatio !== null) {
            rect.clamped = applyAspectRatio(rect, node.aspectRatio, parentRect, node.id);
            descendants = layoutChildren();
        }
        return [rect, ...descendants];
    }

    const rootRect = { x: 0, y: 0, width, height };
    return rootIds.flatMap((id) => layoutNode(id, rootRect));
}

/**
 * Computes absolute pixel rectangles for a flat or nested layout tree.
 *
 * Ratios are relative to each parent's content box. Auto-height nodes use their
 * contentHeight or the deepest first-pass child bottom; their children are then
 * recalculated once using the resulting height to keep the algorithm predictable.
 *
 * @param {object|object[]} rootNode A root node, nested node tree, or flat node list.
 * @param {number} containerWidth Root content width in CSS pixels.
 * @param {number} containerHeight Root content height in CSS pixels.
 * @returns {{id: string, x: number, y: number, width: number, height: number, clamped: boolean}[]}
 *   Parent-first pixel rectangles; clamped is true when aspect-ratio fitting had to
 *   move or shrink a node to keep it within its parent content box.
 */
export function computeLayout(rootNode, containerWidth, containerHeight) {
    if (!Number.isFinite(containerWidth) || !Number.isFinite(containerHeight) ||
        containerWidth < 0 || containerHeight < 0) {
        throw new RangeError("Container width and height must be finite non-negative numbers.");
    }
    const nodes = normalizeNodes(rootNode);
    if (containerWidth === 0 || containerHeight === 0) {
        console.warn("Grid layout skipped because the container has a zero dimension.");
        return [];
    }
    return calculateTree(nodes, containerWidth, containerHeight);
}

/**
 * Returns the highest minimum-width breakpoint matching a viewport width.
 *
 * @param {number} viewportWidth The viewport width in CSS pixels.
 * @param {{name: string, minWidth: number}[]} breakpoints Breakpoint definitions, in any order.
 * @returns {string|null} The matching breakpoint name, or null when none match.
 */
export function resolveBreakpoint(viewportWidth, breakpoints) {
    if (!Number.isFinite(viewportWidth) || viewportWidth < 0) {
        throw new RangeError("viewportWidth must be a finite non-negative number.");
    }
    if (!Array.isArray(breakpoints)) {
        throw new TypeError("breakpoints must be an array.");
    }
    const matching = breakpoints.filter((point) => {
        if (!point || typeof point.name !== "string" || !Number.isFinite(point.minWidth)) {
            throw new TypeError("Each breakpoint must have a string name and finite minWidth.");
        }
        return point.minWidth <= viewportWidth;
    });
    if (matching.length === 0) {
        return null;
    }
    return matching.reduce((best, point) => point.minWidth > best.minWidth ? point : best).name;
}

/**
 * Maps a node's layout constraints to CSS declarations for the given parent size.
 * Aspect-locked dimensions are emitted in pixels so the result matches this
 * parentRect exactly; other constraints remain percentages or pixel offsets.
 *
 * @param {object} node A layout node configuration.
 * @param {{x?: number, y?: number, width: number, height: number}} parentRect Parent content rectangle.
 * @returns {Record<string, string>} Declarations suitable for Object.assign(element.style, result).
 */
export function toCSSLayout(node, parentRect) {
    if (!node || typeof node !== "object" || !parentRect ||
        !Number.isFinite(parentRect.width) || !Number.isFinite(parentRect.height)) {
        throw new TypeError("toCSSLayout requires a node and a parentRect with finite dimensions.");
    }
    const horizontal = node.horizontal ?? { mode: "ratio" };
    const vertical = node.vertical ?? { mode: "topOffset" };
    const declarations = { position: "absolute", boxSizing: "border-box" };

    let width;
    if (horizontal.mode === "ratio") {
        const left = requireRatio(horizontal.leftRatio, `Node "${node.id}" leftRatio`);
        const right = requireRatio(horizontal.rightRatio, `Node "${node.id}" rightRatio`);
        if (left + right >= 1) {
            throw new RangeError(`Node "${node.id}" leftRatio + rightRatio must be less than 1.`);
        }
        declarations.left = `${left * 100}%`;
        width = horizontal.widthRatio === undefined || horizontal.widthRatio === null
            ? 1 - left - right
            : requireRatio(horizontal.widthRatio, `Node "${node.id}" widthRatio`);
    } else if (horizontal.mode === "align") {
        const align = horizontal.align ?? "left";
        const offset = requireRatio(horizontal.offsetRatio, `Node "${node.id}" offsetRatio`);
        if (horizontal.widthRatio !== undefined && horizontal.widthRatio !== null) {
            width = requireRatio(horizontal.widthRatio, `Node "${node.id}" widthRatio`);
        } else {
            const contentWidth = node.contentWidth ?? node.width ?? 0;
            if (!Number.isFinite(contentWidth) || contentWidth < 0) {
                throw new RangeError(`Node "${node.id}" contentWidth must be finite and non-negative.`);
            }
            width = null;
            declarations.width = `${contentWidth}px`;
        }

        if (align === "left") {
            declarations.left = `${offset * 100}%`;
        } else if (align === "center") {
            const halfWidth = width === null
                ? `${((node.contentWidth ?? node.width ?? 0) / 2)}px`
                : `${width * 50}%`;
            declarations.left = `calc(50% - ${halfWidth} + ${offset * 100}%)`;
        } else if (align === "right") {
            declarations.right = `${offset * 100}%`;
        } else {
            throw new TypeError(`Node "${node.id}" horizontal.align must be left, center, or right.`);
        }
    } else {
        throw new TypeError(`Node "${node.id}" horizontal.mode must be "ratio" or "align".`);
    }
    if (width !== null) {
        declarations.width = `${width * 100}%`;
    }

    if (vertical.mode === "topOffset") {
        const topOffset = vertical.topOffset ?? 0;
        if (!Number.isFinite(topOffset)) {
            throw new TypeError(`Node "${node.id}" topOffset must be finite.`);
        }
        declarations.top = `${topOffset}px`;
        if (vertical.autoHeight === true) {
            const contentHeight = vertical.contentHeight ?? node.contentHeight ?? node.height;
            declarations.height = contentHeight === undefined ? "auto" : `${contentHeight}px`;
        } else if (vertical.heightRatio !== undefined && vertical.heightRatio !== null) {
            declarations.height = `${requireRatio(vertical.heightRatio, `Node "${node.id}" heightRatio`) * 100}%`;
        } else {
            const contentHeight = vertical.contentHeight ?? node.contentHeight ?? node.height;
            declarations.height = contentHeight === undefined
                ? `max(0px, calc(100% - ${topOffset}px))`
                : `${contentHeight}px`;
        }
    } else if (vertical.mode === "ratio") {
        const top = requireRatio(vertical.topRatio, `Node "${node.id}" topRatio`);
        const bottom = requireRatio(vertical.bottomRatio, `Node "${node.id}" bottomRatio`);
        if (top + bottom >= 1) {
            throw new RangeError(`Node "${node.id}" topRatio + bottomRatio must be less than 1.`);
        }
        declarations.top = `${top * 100}%`;
        declarations.height = vertical.heightRatio !== undefined && vertical.heightRatio !== null
            ? `${requireRatio(vertical.heightRatio, `Node "${node.id}" heightRatio`) * 100}%`
            : `${(1 - top - bottom) * 100}%`;
    } else {
        throw new TypeError(`Node "${node.id}" vertical.mode must be "topOffset" or "ratio".`);
    }

    if (node.aspectRatio !== undefined && node.aspectRatio !== null) {
        if (!Number.isFinite(node.aspectRatio) || node.aspectRatio <= 0) {
            throw new RangeError(`Node "${node.id}" aspectRatio must be a positive finite number.`);
        }
        const computed = computeLayout([{
            ...node,
            parentId: null,
            children: []
        }], parentRect.width, parentRect.height)[0];
        declarations.left = `${computed.x}px`;
        declarations.top = `${computed.y}px`;
        declarations.width = `${computed.width}px`;
        declarations.height = `${computed.height}px`;
    }
    return declarations;
}
