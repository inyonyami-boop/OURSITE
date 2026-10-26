const renderers = new WeakMap();
const supportedTypes = new Set(["rect", "ellipse"]);

function validateRect(rect) {
    if (
        !rect ||
        typeof rect.id !== "string" ||
        !Number.isFinite(rect.x) ||
        !Number.isFinite(rect.y) ||
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width < 0 ||
        rect.height < 0
    ) {
        throw new TypeError("Every rendered rectangle must have an ID and finite non-negative dimensions.");
    }
}

function validateObject(nodeId, object) {
    if (!object || typeof object !== "object" || !supportedTypes.has(object.type)) {
        throw new TypeError(`Layout node "${nodeId}" is bound to an unsupported visible object.`);
    }
    const appearance = object.appearance ?? {};
    if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
        throw new TypeError(`Visible object "${object.id}" appearance must be an object.`);
    }
    for (const field of ["fill", "stroke"]) {
        if (appearance[field] !== undefined &&
            (typeof appearance[field] !== "string" || appearance[field].trim() === "")) {
            throw new TypeError(`Visible object "${object.id}" appearance.${field} must be a non-empty string.`);
        }
    }
    if (appearance.strokeWidth !== undefined &&
        (!Number.isFinite(appearance.strokeWidth) || appearance.strokeWidth < 0)) {
        throw new RangeError(
            `Visible object "${object.id}" appearance.strokeWidth must be finite and non-negative.`
        );
    }
}

function createRenderer(containerEl) {
    const layer = containerEl.ownerDocument.createElement("div");
    layer.dataset.gridObjectLayer = "";
    Object.assign(layer.style, {
        position: "absolute",
        inset: "0",
        overflow: "hidden",
        pointerEvents: "none",
        boxSizing: "border-box"
    });
    containerEl.append(layer);

    const elements = new Map();
    let destroyed = false;
    const renderer = {
        /**
         * Renders the objects associated with layout rectangle IDs.
         *
         * @param {{id: string, x: number, y: number, width: number, height: number}[]} rects
         *   Pixel rectangles returned by computeLayout.
         * @param {Map<string, object>} bindings
         *   Layout node ID to visible object map from buildObjectBindings.
         * @param {{order?: string[], selectedNodeId?: string|null, interactive?: boolean}} [options]
         *   Bottom-to-top layout-node order, optional selection, and pointer interaction.
         * @returns {void}
         */
        render(rects, bindings, options = {}) {
            if (destroyed) {
                throw new Error("Cannot render with a destroyed object renderer.");
            }
            if (!Array.isArray(rects) || !(bindings instanceof Map)) {
                throw new TypeError("render requires a rectangle array and a bindings Map.");
            }
            if (!options || typeof options !== "object" || Array.isArray(options)) {
                throw new TypeError("render options must be an object.");
            }
            const order = options.order ?? [];
            if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) {
                throw new TypeError("render options.order must be an array of layout node IDs.");
            }
            if (new Set(order).size !== order.length) {
                throw new Error("render options.order cannot contain duplicate layout node IDs.");
            }
            if (
                options.selectedNodeId !== undefined &&
                options.selectedNodeId !== null &&
                typeof options.selectedNodeId !== "string"
            ) {
                throw new TypeError("render options.selectedNodeId must be a string or null.");
            }

            const activeIds = new Set();
            for (const rect of rects) {
                validateRect(rect);
                const object = bindings.get(rect.id);
                if (!object) {
                    continue;
                }
                validateObject(rect.id, object);
                activeIds.add(rect.id);

                let element = elements.get(rect.id);
                if (element && element.dataset.objectType !== object.type) {
                    element.remove();
                    elements.delete(rect.id);
                    element = null;
                }
                if (!element) {
                    element = containerEl.ownerDocument.createElement("div");
                    element.dataset.layoutNodeId = rect.id;
                    element.dataset.objectId = object.id;
                    element.dataset.objectType = object.type;
                    Object.assign(element.style, {
                        position: "absolute",
                        boxSizing: "border-box",
                        pointerEvents: options.interactive === true ? "auto" : "none"
                    });
                    elements.set(rect.id, element);
                    layer.append(element);
                }

                const appearance = object.appearance ?? {};
                Object.assign(element.style, {
                    left: `${rect.x}px`,
                    top: `${rect.y}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                    borderRadius: object.type === "ellipse" ? "50%" : "0",
                    backgroundColor: appearance.fill ?? "transparent",
                    borderStyle: appearance.stroke === undefined ? "none" : "solid",
                    borderColor: appearance.stroke ?? "transparent",
                    borderWidth: `${appearance.strokeWidth ?? (appearance.stroke === undefined ? 0 : 1)}px`,
                    pointerEvents: options.interactive === true ? "auto" : "none"
                });
                element.dataset.objectId = object.id;
                element.setAttribute("aria-selected", String(rect.id === options.selectedNodeId));
            }

            const renderOrder = order.filter((id) => activeIds.has(id));
            for (const id of activeIds) {
                if (!renderOrder.includes(id)) {
                    renderOrder.push(id);
                }
            }
            renderOrder.forEach((nodeId, zIndex) => {
                const element = elements.get(nodeId);
                element.style.zIndex = String(zIndex);
                element.style.outline = nodeId === options.selectedNodeId
                    ? "3px solid #f59e0b"
                    : "none";
                element.style.outlineOffset = "2px";
            });

            for (const [nodeId, element] of elements) {
                if (!activeIds.has(nodeId)) {
                    element.remove();
                    elements.delete(nodeId);
                }
            }
        },

        /**
         * Removes this renderer's layer and all of its elements.
         *
         * @returns {void}
         */
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            elements.clear();
            layer.remove();
            if (renderers.get(containerEl) === renderer) {
                renderers.delete(containerEl);
            }
        }
    };
    return renderer;
}

/**
 * Creates or reuses an object renderer isolated from the grid debug layer.
 *
 * The container should already be positioned (for example, initialized by
 * createGrid). One active renderer is maintained per container.
 *
 * @param {HTMLElement} containerEl Container for a dedicated object layer.
 * @returns {{
 *   render: (rects: object[], bindings: Map<string, object>, options?: {
 *     order?: string[], selectedNodeId?: string|null, interactive?: boolean
 *   }) => void,
 *   destroy: () => void
 * }} An object renderer instance.
 */
export function createObjectRenderer(containerEl) {
    if (!containerEl || !containerEl.ownerDocument) {
        throw new TypeError("createObjectRenderer requires a DOM container element.");
    }
    const existing = renderers.get(containerEl);
    if (existing) {
        return existing;
    }
    const renderer = createRenderer(containerEl);
    renderers.set(containerEl, renderer);
    return renderer;
}
