import { normalizeNodes } from "./grid-model.js";
import { computeLayout } from "./grid-layout.js";

const layers = new WeakMap();

function measureContentBox(containerEl) {
    const style = typeof getComputedStyle === "function" ? getComputedStyle(containerEl) : null;
    const paddingX = style
        ? (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
        : 0;
    const paddingY = style
        ? (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
        : 0;
    return {
        width: Math.max(0, containerEl.clientWidth - paddingX),
        height: Math.max(0, containerEl.clientHeight - paddingY)
    };
}

function createLayer(containerEl) {
    let state = layers.get(containerEl);
    if (state) {
        return state;
    }

    const layer = containerEl.ownerDocument.createElement("div");
    layer.dataset.gridPreviewLayer = "";
    Object.assign(layer.style, {
        position: "absolute",
        inset: "0",
        overflow: "hidden",
        pointerEvents: "none",
        boxSizing: "border-box"
    });
    containerEl.append(layer);
    state = { layer, elements: new Map() };
    layers.set(containerEl, state);
    return state;
}

/**
 * Renders pixel rectangles as debug divs in a dedicated overlay layer.
 *
 * @param {HTMLElement} containerEl The positioned container element.
 * @param {{id: string, x: number, y: number, width: number, height: number, clamped?: boolean}[]} rects
 *   Rectangles returned by computeLayout.
 * @param {Map<string, object>} nodeMap A lookup of rectangle IDs to node data.
 * @returns {void}
 */
export function renderRects(containerEl, rects, nodeMap) {
    if (!containerEl || !containerEl.ownerDocument) {
        throw new TypeError("renderRects requires a DOM container element.");
    }
    if (!Array.isArray(rects) || !(nodeMap instanceof Map)) {
        throw new TypeError("renderRects requires a rectangle array and a node Map.");
    }

    const state = createLayer(containerEl);
    const activeIds = new Set();
    const colors = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777"];

    rects.forEach((rect, index) => {
        activeIds.add(rect.id);
        let element = state.elements.get(rect.id);
        if (!element) {
            element = containerEl.ownerDocument.createElement("div");
            element.dataset.gridNodeId = rect.id;
            element.setAttribute("aria-hidden", "true");
            state.elements.set(rect.id, element);
            state.layer.append(element);
        }

        const node = nodeMap.get(rect.id) ?? {};
        Object.assign(element.style, {
            position: "absolute",
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            boxSizing: "border-box",
            overflow: "hidden",
            padding: "6px",
            border: "2px solid rgba(15, 23, 42, 0.75)",
            background: node.background ?? colors[index % colors.length],
            color: node.color ?? "#ffffff",
            font: "12px/1.3 sans-serif",
            opacity: "0.84"
        });
        element.dataset.clamped = String(rect.clamped === true);
        element.textContent = `${rect.id}${rect.clamped ? " (clamped)" : ""}`;
    });

    for (const [id, element] of state.elements) {
        if (!activeIds.has(id)) {
            element.remove();
            state.elements.delete(id);
        }
    }
}

/**
 * Creates an independent layout runtime for a DOM container.
 *
 * @param {HTMLElement} containerEl The element whose content box is the root layout area.
 * @param {object|object[]} rootNode Initial root node, nested tree, or flat node list.
 * @param {{renderRects?: Function}} [options] Optional renderer receiving container, rects, and node map.
 * @returns {{
 *   setRoot: (rootNode: object|object[]) => void,
 *   updateNode: (id: string, patch: object) => void,
 *   resize: (width: number, height: number) => void,
 *   observe: () => void,
 *   destroy: () => void,
 *   getRects: () => object[]
 * }} Runtime instance methods.
 */
export function createGrid(containerEl, rootNode, options = {}) {
    if (!containerEl || !containerEl.ownerDocument) {
        throw new TypeError("createGrid requires a DOM container element.");
    }
    if (options.renderRects !== undefined && typeof options.renderRects !== "function") {
        throw new TypeError("options.renderRects must be a function.");
    }

    let nodes = normalizeNodes(rootNode);
    let rects = [];
    let observer = null;
    let destroyed = false;
    let explicitSize = null;
    const renderer = options.renderRects ?? renderRects;
    const originalPosition = containerEl.style.position;
    const hadInlinePosition = originalPosition !== "";

    function ensurePositioning() {
        if (typeof getComputedStyle === "function" && getComputedStyle(containerEl).position === "static") {
            containerEl.style.position = "relative";
        }
    }

    function reflow(width, height) {
        if (destroyed) {
            throw new Error("Cannot use a destroyed grid instance.");
        }
        rects = computeLayout(nodes, width, height);
        ensurePositioning();
        renderer(containerEl, rects, new Map(nodes.map((node) => [node.id, node])));
        return rects;
    }

    function currentSize() {
        return explicitSize ?? measureContentBox(containerEl);
    }

    function clearDefaultLayer() {
        const state = layers.get(containerEl);
        if (state) {
            state.layer.remove();
            layers.delete(containerEl);
        }
    }

    const initialSize = measureContentBox(containerEl);
    reflow(initialSize.width, initialSize.height);

    return {
        /**
         * Replaces the complete node tree and recalculates its rectangles.
         *
         * @param {object|object[]} nextRootNode New root node or node list.
         * @returns {void}
         */
        setRoot(nextRootNode) {
            const nextNodes = normalizeNodes(nextRootNode);
            nodes = nextNodes;
            const size = currentSize();
            reflow(size.width, size.height);
        },

        /**
         * Applies a shallow patch to one node, validates the resulting tree, and reflows.
         *
         * @param {string} id ID of the node to update.
         * @param {object} patch Properties to merge into the node.
         * @returns {void}
         */
        updateNode(id, patch) {
            if (typeof id !== "string" || !patch || typeof patch !== "object" || Array.isArray(patch)) {
                throw new TypeError("updateNode requires a string ID and a patch object.");
            }
            const found = nodes.some((node) => node.id === id);
            if (!found) {
                throw new Error(`Cannot update missing layout node "${id}".`);
            }
            if (patch.id !== undefined && patch.id !== id) {
                throw new Error("updateNode cannot change a node ID.");
            }
            const nextNodes = normalizeNodes(nodes.map((node) =>
                node.id === id ? { ...node, ...patch, id } : node
            ));
            nodes = nextNodes;
            const size = currentSize();
            reflow(size.width, size.height);
        },

        /**
         * Recalculates using explicit dimensions, useful for breakpoint previews.
         *
         * @param {number} width Container width in CSS pixels.
         * @param {number} height Container height in CSS pixels.
         * @returns {void}
         */
        resize(width, height) {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
                throw new RangeError("resize dimensions must be finite non-negative numbers.");
            }
            explicitSize = { width, height };
            reflow(width, height);
        },

        /**
         * Starts observing the container's content-box dimensions.
         *
         * @returns {void}
         * @throws {Error} If ResizeObserver is unavailable.
         */
        observe() {
            if (destroyed) {
                throw new Error("Cannot observe a destroyed grid instance.");
            }
            if (typeof ResizeObserver !== "function") {
                throw new Error("ResizeObserver is not available in this environment.");
            }
            observer?.disconnect();
            observer = new ResizeObserver((entries) => {
                const entry = entries.find((item) => item.target === containerEl);
                if (!entry) {
                    return;
                }
                const { width, height } = entry.contentRect;
                explicitSize = null;
                reflow(width, height);
            });
            observer.observe(containerEl);
        },

        /**
         * Disconnects resize observation and removes the default debug overlay.
         *
         * @returns {void}
         */
        destroy() {
            if (destroyed) {
                return;
            }
            observer?.disconnect();
            observer = null;
            if (renderer === renderRects) {
                clearDefaultLayer();
            }
            if (!hadInlinePosition && containerEl.style.position === "relative") {
                containerEl.style.position = originalPosition;
            }
            destroyed = true;
        },

        /**
         * Returns a defensive copy of the most recently calculated rectangles.
         *
         * @returns {object[]} The latest computed rectangles.
         */
        getRects() {
            return rects.map((rect) => ({ ...rect }));
        }
    };
}
