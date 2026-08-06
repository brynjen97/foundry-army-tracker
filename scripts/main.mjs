import { MODULE_ID } from "./constants.mjs";
import { getArmyData, registerSettings, onSocketMessage } from "./data.mjs";
import { ArmyTrackerApp } from "./app.mjs";

Hooks.once("init", () => {
  registerSettings();

  const load = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  load([`modules/${MODULE_ID}/templates/unit.hbs`]);

  game.keybindings.register(MODULE_ID, "openTracker", {
    name: "ARMY.Keybind.open",
    hint: "ARMY.Keybind.openHint",
    editable: [],
    onDown: () => {
      ArmyTrackerApp.open();
      return true;
    }
  });
});

Hooks.once("ready", () => {
  game.socket.on(`module.${MODULE_ID}`, onSocketMessage);
  const module = game.modules.get(MODULE_ID);
  module.api = {
    open: () => ArmyTrackerApp.open()
  };
});

/** Add an "Army Tracker" button to the Actors directory (works with both v12 jQuery and v13 HTMLElement hooks). */
Hooks.on("renderActorDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".at-open-button")) return;
  const header = root.querySelector(".directory-header .header-actions")
    ?? root.querySelector(".directory-header")
    ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "at-open-button";
  button.innerHTML = `<i class="fa-solid fa-flag"></i> <span>${game.i18n.localize("ARMY.OpenButton")}</span>`;
  button.addEventListener("click", () => ArmyTrackerApp.open());
  header.append(button);
});

/** World settings sync to every client; re-render the tracker whenever our data changes anywhere. */
Hooks.on("updateSetting", (setting) => {
  if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
  ArmyTrackerApp.instance?.render();
});

/** Keep the "carried by character" figure current as coin moves on linked sheets. */
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item) => {
    const app = ArmyTrackerApp.instance;
    if (!app?.rendered) return;
    const actorId = item?.parent?.id;
    if (!actorId) return;
    if (getArmyData().roster.some((m) => m.actorId === actorId)) app.render();
  });
}
