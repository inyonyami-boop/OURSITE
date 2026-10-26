import { normalizeNodes } from "./grid-model.js";

/**
 * Current serialized object-store schema version.
 *
 * @type {number}
 */
export const OBJECT_SCHEMA_VERSION = 1;

const OBJECT_TYPES = new Set(["rect", "ellipse"]);
const APPEARANCE_FIELDS = new Set(["fill", "stroke", "strokeWidth"]);

function validateAppearance(appearance, objectId) {
    if (appearance === undefined) {
        return {};
    }
    if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
        throw new TypeError(`Object "${objectId}" appearance must be an object.`);
    }

    for (const key of Object.keys(appearance)) {
        if (!APPEARANCE_FIELDS.has(key)) {
            throw new TypeError(`Unsupported appearance property "${key}" on object "${objectId}".`);
        }
    }

    const normalized = {};
    for (const field of ["fill", "stroke"]) {
        const value = appearance[field];
        if (value !== undefined) {
            if (typeof value !== "string" || value.trim() === "") {
                throw new TypeError(`Object "${objectId}" appearance.${field} must be a non-empty string.`);
            }
            normalized[field] = value;
        }
    }

    if (appearance.strokeWidth !== undefined) {
        if (!Number.isFinite(appearance.strokeWidth) || appearance.strokeWidth < 0) {
            throw new RangeError(`Object "${objectId}" appearance.strokeWidth must be finite and non-negative.`);
        }
        normalized.strokeWidth = appearance.strokeWidth;
    }
    return normalized;
}

/**
 * Validates and copies a versioned visible-object store.
 *
 * Object geometry and layout position are intentionally not stored here.
 * Image/resource data is not part of this first schema; future resource support
 * should use separate metadata records and references rather than embedding bytes.
 *
 * @param {{version: number, objects: object[]}} objectStore Serialized object store.
 * @returns {{version: number, objects: object[]}} A validated defensive copy.
 * @throws {TypeError|RangeError} If the schema, IDs, types, or appearance are invalid.
 */
export function normalizeObjectStore(objectStore) {
    if (!objectStore || typeof objectStore !== "object" || Array.isArray(objectStore)) {
        throw new TypeError("Object store must be an object.");
    }
    if (objectStore.version !== OBJECT_SCHEMA_VERSION) {
        throw new RangeError(
            `Unsupported object store version "${objectStore.version}"; expected ${OBJECT_SCHEMA_VERSION}.`
        );
    }
    if (!Array.isArray(objectStore.objects)) {
        throw new TypeError("Object store objects must be an array.");
    }

    const ids = new Set();
    const objects = objectStore.objects.map((object) => {
        if (!object || typeof object !== "object" || Array.isArray(object)) {
            throw new TypeError("Every visible object must be an object.");
        }
        if (typeof object.id !== "string" || object.id.trim() === "") {
            throw new TypeError("Every visible object must have a non-empty string id.");
        }
        if (ids.has(object.id)) {
            throw new Error(`Duplicate visible object id: "${object.id}".`);
        }
        ids.add(object.id);

        if (!OBJECT_TYPES.has(object.type)) {
            throw new TypeError(
                `Unsupported type "${object.type}" on object "${object.id}"; supported types are rect and ellipse.`
            );
        }

        for (const key of Object.keys(object)) {
            if (!["id", "type", "appearance"].includes(key)) {
                throw new TypeError(`Unsupported property "${key}" on object "${object.id}".`);
            }
        }

        return {
            id: object.id,
            type: object.type,
            appearance: validateAppearance(object.appearance, object.id)
        };
    });

    return { version: OBJECT_SCHEMA_VERSION, objects };
}

/**
 * Resolves layout-node objectId references to validated object records.
 *
 * Each node may reference at most one object because objectId is a scalar.
 * An object may be referenced by at most one node. Objects without references
 * remain valid in the object store and are omitted from the returned map.
 *
 * @param {{version: number, objects: object[]}} objectStore Versioned object store.
 * @param {object|object[]} layoutNodes Flat nodes or a supported nested layout tree.
 * @returns {Map<string, object>} A map from layout node ID to its visible object record.
 * @throws {Error|TypeError} If a reference is missing, duplicated, or malformed.
 */
export function buildObjectBindings(objectStore, layoutNodes) {
    const normalizedStore = normalizeObjectStore(objectStore);
    const nodes = normalizeNodes(layoutNodes);
    const objectsById = new Map(normalizedStore.objects.map((object) => [object.id, object]));
    const bindings = new Map();
    const referencedObjectIds = new Set();

    for (const node of nodes) {
        if (node.objectId === undefined || node.objectId === null) {
            continue;
        }
        if (typeof node.objectId !== "string" || node.objectId.trim() === "") {
            throw new TypeError(`Node "${node.id}" objectId must be a non-empty string when provided.`);
        }
        const object = objectsById.get(node.objectId);
        if (!object) {
            throw new Error(`Node "${node.id}" references missing visible object "${node.objectId}".`);
        }
        if (referencedObjectIds.has(node.objectId)) {
            throw new Error(`Visible object "${node.objectId}" is referenced by more than one layout node.`);
        }
        referencedObjectIds.add(node.objectId);
        bindings.set(node.id, object);
    }

    return bindings;
}

/**
 * Returns a new object store with an unbound object removed.
 *
 * Referenced objects cannot be deleted; callers must first clear the node's
 * objectId reference and rebuild the bindings.
 *
 * @param {{version: number, objects: object[]}} objectStore Versioned object store.
 * @param {string} objectId ID of the object to remove.
 * @param {object|object[]} layoutNodes Layout nodes used to detect references.
 * @returns {{version: number, objects: object[]}} A copied store without the object.
 * @throws {Error|TypeError} If the object is missing, still referenced, or inputs are invalid.
 */
export function removeUnboundObject(objectStore, objectId, layoutNodes) {
    const normalizedStore = normalizeObjectStore(objectStore);
    if (typeof objectId !== "string" || objectId.trim() === "") {
        throw new TypeError("objectId must be a non-empty string.");
    }
    if (!normalizedStore.objects.some((object) => object.id === objectId)) {
        throw new Error(`Cannot remove missing visible object "${objectId}".`);
    }

    const bindings = buildObjectBindings(normalizedStore, layoutNodes);
    for (const [nodeId, object] of bindings) {
        if (object.id === objectId) {
            throw new Error(`Cannot remove visible object "${objectId}"; it is referenced by node "${nodeId}".`);
        }
    }

    return {
        version: normalizedStore.version,
        objects: normalizedStore.objects.filter((object) => object.id !== objectId)
    };
}
