/**
 * Converts a flat node list or a node with nested child objects into a flat,
 * validated list. Flat lists use parentId and optional child-ID arrays.
 *
 * @param {object|object[]} rootNode A root node, nested node tree, or flat node list.
 * @returns {object[]} A new flat list of nodes with consistent parentId and children values.
 */
export function normalizeNodes(rootNode) {
    if (!rootNode || (typeof rootNode !== "object" && !Array.isArray(rootNode))) {
        throw new TypeError("rootNode must be a node object or an array of nodes.");
    }

    const nodes = [];
    const declaredChildren = new Set();

    function visit(node, inferredParentId, ancestors) {
        if (!node || typeof node !== "object" || Array.isArray(node)) {
            throw new TypeError("Every layout node must be an object.");
        }
        if (ancestors.has(node)) {
            throw new Error("Nested children contain a cycle.");
        }

        const nextAncestors = new Set(ancestors);
        nextAncestors.add(node);
        const childItems = Array.isArray(node.children) ? node.children : [];
        const childObjects = childItems.filter((child) => child && typeof child === "object");
        const childIds = childItems.filter((child) => typeof child === "string");

        if (childObjects.length > 0 && childIds.length > 0) {
            throw new Error(`Node "${node.id}" cannot mix nested child objects and child IDs.`);
        }

        const parentId = node.parentId === undefined ? inferredParentId : node.parentId;
        const copy = { ...node, parentId };
        if (Array.isArray(node.children)) {
            declaredChildren.add(copy);
        }
        if (childObjects.length > 0) {
            copy.children = childObjects.map((child) => child.id);
        } else {
            copy.children = childIds;
        }
        nodes.push(copy);

        for (const child of childObjects) {
            visit(child, node.id, nextAncestors);
        }
    }

    if (Array.isArray(rootNode)) {
        for (const node of rootNode) {
            visit(node, null, new Set());
        }
    } else {
        visit(rootNode, null, new Set());
    }

    const nodeMap = new Map();
    for (const node of nodes) {
        if (typeof node.id !== "string" || node.id.trim() === "") {
            throw new TypeError("Every layout node must have a non-empty string id.");
        }
        if (nodeMap.has(node.id)) {
            throw new Error(`Duplicate layout node id: "${node.id}".`);
        }
        if (node.parentId !== null && typeof node.parentId !== "string") {
            throw new TypeError(`Node "${node.id}" parentId must be a string or null.`);
        }
        nodeMap.set(node.id, node);
    }

    const childrenMap = new Map();
    for (const node of nodes) {
        childrenMap.set(node.id, []);
    }

    for (const node of nodes) {
        if (node.parentId !== null) {
            const parent = nodeMap.get(node.parentId);
            if (!parent) {
                throw new Error(`Node "${node.id}" references missing parent "${node.parentId}".`);
            }
            childrenMap.get(node.parentId).push(node.id);
        }
    }

    for (const node of nodes) {
        const actualChildren = childrenMap.get(node.id);
        if (!declaredChildren.has(node)) {
            node.children = actualChildren;
            continue;
        }
        const childIds = node.children;
        if (new Set(childIds).size !== childIds.length) {
            throw new Error(`Node "${node.id}" lists a child more than once.`);
        }
        for (const childId of childIds) {
            if (typeof childId !== "string" || !nodeMap.has(childId)) {
                throw new Error(`Node "${node.id}" references missing child "${childId}".`);
            }
        }
        if (
            childIds.length !== actualChildren.length ||
            childIds.some((childId) => !actualChildren.includes(childId))
        ) {
            throw new Error(`Node "${node.id}" children and child parentId values do not agree.`);
        }
    }

    assertAcyclic(nodeMap);
    return nodes;
}

/**
 * Checks parentId links for cycles.
 *
 * @param {Map<string, object>} nodeMap A map of node IDs to node objects.
 * @returns {void}
 * @throws {Error} If any node has a missing parent or belongs to a parent cycle.
 */
export function assertAcyclic(nodeMap) {
    const state = new Map();

    function visit(id) {
        const currentState = state.get(id);
        if (currentState === "visiting") {
            throw new Error(`Cycle detected in parentId chain at node "${id}".`);
        }
        if (currentState === "visited") {
            return;
        }

        state.set(id, "visiting");
        const node = nodeMap.get(id);
        if (node.parentId !== null) {
            if (!nodeMap.has(node.parentId)) {
                throw new Error(`Node "${id}" references missing parent "${node.parentId}".`);
            }
            visit(node.parentId);
        }
        state.set(id, "visited");
    }

    for (const id of nodeMap.keys()) {
        visit(id);
    }
}

/**
 * Creates a lookup map for a validated node tree.
 *
 * @param {object|object[]} rootNode A root node, nested node tree, or flat node list.
 * @returns {Map<string, object>} A map keyed by node ID.
 */
export function buildNodeMap(rootNode) {
    return new Map(normalizeNodes(rootNode).map((node) => [node.id, node]));
}

/**
 * Builds a parent-ID to child-ID lookup for a validated node tree.
 *
 * @param {object|object[]} rootNode A root node, nested node tree, or flat node list.
 * @returns {Map<string|null, string[]>} Child IDs grouped by parent ID.
 */
export function buildChildrenMap(rootNode) {
    const childrenMap = new Map([[null, []]]);
    for (const node of normalizeNodes(rootNode)) {
        if (!childrenMap.has(node.parentId)) {
            childrenMap.set(node.parentId, []);
        }
        if (!childrenMap.has(node.id)) {
            childrenMap.set(node.id, []);
        }
        childrenMap.get(node.parentId).push(node.id);
    }
    return childrenMap;
}
