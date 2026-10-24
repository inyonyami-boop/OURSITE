const enterButton = document.querySelector("#enter-edit");
const exitButton = document.querySelector("#exit-edit");
const toolbar = document.querySelector("#editor-toolbar");

function setEditMode(enabled) {
    document.body.classList.toggle("editing", enabled);

    toolbar.style.display = enabled ? "block" : "none";

    enterButton.hidden = enabled;
    exitButton.hidden = !enabled;
}

enterButton.addEventListener("click", () => {
    setEditMode(true);
});

exitButton.addEventListener("click", () => {
    setEditMode(false);
});