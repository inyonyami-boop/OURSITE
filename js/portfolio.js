import { normalizeObjectStore, buildObjectBindings, removeUnboundObject } from "./object-model.js";
import { normalizeNodes } from "./grid-model.js";
import { createGrid } from "./grid-runtime.js";
import { createObjectRenderer } from "./object-renderer.js";

const enterButton = document.querySelector("#enter-edit");
const exitButton = document.querySelector("#exit-edit");
const toolbar = document.querySelector("#editor-toolbar");
const canvas = document.querySelector("#portfolio-canvas");
const status = document.querySelector("#editor-status");
const addRectButton = document.querySelector("#add-rect");
const addEllipseButton = document.querySelector("#add-ellipse");
const moveBackwardButton = document.querySelector("#move-backward");
const moveForwardButton = document.querySelector("#move-forward");
const deleteButton = document.querySelector("#delete-selected");

const rootId = "portfolio-root";
let objectStore = normalizeObjectStore({ version: 1, objects: [] });
let layoutNodes = normalizeNodes([{
    id: rootId,
    parentId: null,
    horizontal: { mode: "ratio", leftRatio: 0, rightRatio: 0 },
    vertical: { mode: "ratio", topRatio: 0, bottomRatio: 0 },
    children: []
}]);
let layerOrder = [];
let selectedNodeId = null;
let idCounter = 0;

const grid = createGrid(canvas, layoutNodes);
const objectRenderer = createObjectRenderer(canvas);
grid.observe();

function updateControls() {
    const selectedIndex = layerOrder.indexOf(selectedNodeId);
    const hasSelection = selectedIndex >= 0;
    deleteButton.disabled = !hasSelection;
    moveBackwardButton.disabled = !hasSelection || selectedIndex === 0;
    moveForwardButton.disabled = !hasSelection || selectedIndex === layerOrder.length - 1;
}

function renderObjects() {
    const bindings = buildObjectBindings(objectStore, layoutNodes);
    objectRenderer.render(grid.getRects(), bindings, {
        order: layerOrder,
        selectedNodeId,
        interactive: true
    });
    updateControls();
}

function showError(error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    console.error("Portfolio object operation failed:", error);
}

function showMessage(message) {
    status.textContent = message;
}

function makeId(prefix, usedIds) {
    let id;
    do {
        idCounter += 1;
        const token = globalThis.crypto?.randomUUID?.() ??
            `${Date.now().toString(36)}-${idCounter.toString(36)}`;
        id = `${prefix}-${token}`;
    } while (usedIds.has(id));
    return id;
}

function updateCanvasHeight(objectCount) {
    const rowCount = Math.max(1, Math.ceil(objectCount / 2));
    canvas.style.height = `${Math.max(480, 40 + rowCount * 140)}px`;
}

function refreshGrid(nextNodes, nextObjectStore, nextOrder, nextSelection) {
    const validatedNodes = normalizeNodes(nextNodes);
    const validatedStore = normalizeObjectStore(nextObjectStore);
    buildObjectBindings(validatedStore, validatedNodes);

    const previousHeight = canvas.style.height;
    updateCanvasHeight(validatedStore.objects.length);
    try {
        grid.setRoot(validatedNodes);
    } catch (error) {
        canvas.style.height = previousHeight;
        throw error;
    }

    layoutNodes = validatedNodes;
    objectStore = validatedStore;
    layerOrder = nextOrder;
    selectedNodeId = nextSelection;
    renderObjects();
}

function createShape(type) {
    const usedObjectIds = new Set(objectStore.objects.map((object) => object.id));
    const usedNodeIds = new Set(layoutNodes.map((node) => node.id));
    const objectId = makeId("object", usedObjectIds);
    const nodeId = makeId("layout", usedNodeIds);
    const shapeCount = objectStore.objects.length;
    const column = shapeCount % 2;
    const row = Math.floor(shapeCount / 2);
    const color = type === "rect" ? "#2563eb" : "#059669";
    const object = {
        id: objectId,
        type,
        appearance: {
            fill: color,
            stroke: type === "rect" ? "#1e3a8a" : "#064e3b",
            strokeWidth: 3
        }
    };
    const node = {
        id: nodeId,
        parentId: rootId,
        objectId,
        horizontal: {
            mode: "ratio",
            // The second column overlaps slightly so stacking order is visible.
            leftRatio: column === 0 ? 0.06 : 0.42,
            rightRatio: 0.02,
            widthRatio: 0.42
        },
        vertical: { mode: "topOffset", topOffset: 20 + row * 140 },
        height: 100,
        children: []
    };
    const nextNodes = layoutNodes.map((item) =>
        item.id === rootId
            ? { ...item, children: [...item.children, nodeId] }
            : item
    );
    nextNodes.push(node);

    refreshGrid(
        nextNodes,
        { version: objectStore.version, objects: [...objectStore.objects, object] },
        [...layerOrder, nodeId],
        nodeId
    );
    showMessage(`${type === "rect" ? "矩形" : "椭圆"}已添加。`);
}

function deleteSelected() {
    if (!selectedNodeId) {
        return;
    }
    const selectedNode = layoutNodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode || !selectedNode.objectId) {
        throw new Error(`Selected layout node "${selectedNodeId}" has no associated object.`);
    }
    const nextNodes = layoutNodes
        .filter((node) => node.id !== selectedNodeId)
        .map((node) => node.id === rootId
            ? { ...node, children: node.children.filter((id) => id !== selectedNodeId) }
            : node);
    const nextStore = removeUnboundObject(objectStore, selectedNode.objectId, nextNodes);
    const deletedId = selectedNodeId;
    refreshGrid(
        nextNodes,
        nextStore,
        layerOrder.filter((id) => id !== deletedId),
        null
    );
    showMessage("已删除选中对象。");
}

function moveSelectedLayer(direction) {
    const index = layerOrder.indexOf(selectedNodeId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= layerOrder.length) {
        return;
    }
    const nextOrder = [...layerOrder];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    layerOrder = nextOrder;
    renderObjects();
    showMessage("图层顺序已更新（当前仅保存在页面内存中）。");
}

function setEditMode(enabled) {
    document.body.classList.toggle("editing", enabled);

    toolbar.style.display = enabled ? "block" : "none";

    enterButton.hidden = enabled;
    exitButton.hidden = !enabled;
    if (!enabled) {
        selectedNodeId = null;
        renderObjects();
    }
}

enterButton.addEventListener("click", () => {
    setEditMode(true);
});

exitButton.addEventListener("click", () => {
    setEditMode(false);
});

addRectButton.addEventListener("click", () => {
    try {
        createShape("rect");
    } catch (error) {
        showError(error);
    }
});

addEllipseButton.addEventListener("click", () => {
    try {
        createShape("ellipse");
    } catch (error) {
        showError(error);
    }
});

deleteButton.addEventListener("click", () => {
    try {
        deleteSelected();
    } catch (error) {
        showError(error);
    }
});

moveBackwardButton.addEventListener("click", () => {
    try {
        moveSelectedLayer(-1);
    } catch (error) {
        showError(error);
    }
});
moveForwardButton.addEventListener("click", () => {
    try {
        moveSelectedLayer(1);
    } catch (error) {
        showError(error);
    }
});

function handleCanvasClick(event) {
    if (!document.body.classList.contains("editing")) {
        return;
    }
    const shape = event.target instanceof Element
        ? event.target.closest("[data-layout-node-id]")
        : null;
    selectedNodeId = shape?.dataset.layoutNodeId ?? null;
    try {
        renderObjects();
        if (selectedNodeId) {
            showMessage("已选中对象。");
        } else {
            showMessage("");
        }
    } catch (error) {
        showError(error);
    }
}

function handleDeleteKey(event) {
    if (
        !document.body.classList.contains("editing") ||
        !selectedNodeId ||
        (event.key !== "Delete" && event.key !== "Backspace") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
    ) {
        return;
    }
    const target = event.target;
    if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
        return;
    }
    event.preventDefault();
    try {
        deleteSelected();
    } catch (error) {
        showError(error);
    }
}

canvas.addEventListener("click", handleCanvasClick);
document.addEventListener("keydown", handleDeleteKey);

const objectResizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(() => {
        try {
            renderObjects();
        } catch (error) {
            showError(error);
        }
    });
});
objectResizeObserver.observe(canvas);

window.addEventListener("pagehide", () => {
    objectResizeObserver.disconnect();
    canvas.removeEventListener("click", handleCanvasClick);
    document.removeEventListener("keydown", handleDeleteKey);
    objectRenderer.destroy();
    grid.destroy();
}, { once: true });

renderObjects();