import { MODULE_ID } from "./constants.mjs";
import { getArmyData, registerSettings, seedDefaults, onSocketMessage } from "./data.mjs";
import { ArmyTrackerApp } from "./app.mjs";
import { ArmyConfigApp } from "./config-app.mjs";

Hooks.once("init", () => {
  registerSettings();

  game.settings.registerMenu(MODULE_ID, "configMenu", {
    name: "ARMY.Config.menuName",
    label: "ARMY.Config.menuLabel",
    hint: "ARMY.Config.menuHint",
    icon: "fa-solid fa-sliders",
    type: ArmyConfigApp,
    restricted: true
  });

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

Hooks.once("ready", async () => {
  game.socket.on(`module.${MODULE_ID}`, onSocketMessage);
  const module = game.modules.get(MODULE_ID);
  module.api = {
    open: () => ArmyTrackerApp.open(),
    configure: () => new ArmyConfigApp().render({ force: true })
  };
  // Writes the built-in ranks and deductions into settings once, so the config
  // menu opens with something to edit instead of an empty form.
  await seedDefaults();
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
