import { MODULE_ID } from "./constants.mjs";
import { getArmyData, registerSettings, seedDefaults, onSocketMessage } from "./data.mjs";
import { isStoreDoc, syncStore } from "./store.mjs";
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

  // loadTemplates moved under foundry.applications.handlebars and the bare
  // global is on its way out; reach for the namespaced one first and treat
  // its absence as non-fatal, since the partial also loads on first render.
  const load = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  if (typeof load === "function") {
    Promise.resolve(load([`modules/${MODULE_ID}/templates/unit.hbs`]))
      .catch((err) => console.error(`${MODULE_ID} | Could not preload templates`, err));
  } else {
    console.warn(`${MODULE_ID} | No loadTemplates available; partials will load on demand.`);
  }

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
  // Create or repair the shared data journal if player editing is on. Needs a
  // GM, so it happens on the first GM login after the toggle is flipped.
  await syncStore();
});

/** The hook's second argument is jQuery on v12 and an HTMLElement from v13 on. */
function rootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function makeOpenButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "at-open-button";
  button.innerHTML = `<i class="fa-solid fa-flag"></i> <span>${game.i18n.localize("ARMY.OpenButton")}</span>`;
  button.addEventListener("click", () => ArmyTrackerApp.open());
  return button;
}

/**
 * Add an "Army Tracker" button to the Actors directory.
 * Sidebar markup shifts between major versions, so several known header
 * shapes are tried before falling back to the directory root — appearing in
 * an odd spot beats not appearing at all. Wrapped so a failure here cannot
 * break other listeners on the same hook.
 */
Hooks.on("renderActorDirectory", (app, html) => {
  try {
    const root = rootElement(html);
    if (!root || root.querySelector(".at-open-button")) return;
    const header = root.querySelector(".directory-header .header-actions")
      ?? root.querySelector(".directory-header .action-buttons")
      ?? root.querySelector(".directory-header")
      ?? root.querySelector("header")
      ?? root;
    header.append(makeOpenButton());
  } catch (err) {
    console.error(`${MODULE_ID} | Could not add the directory button`, err);
  }
});

/**
 * A second way in, from the Game Settings sidebar. Cheap insurance: if the
 * actors-directory markup changes and that button lands somewhere useless,
 * the tracker is still reachable without resorting to a macro.
 */
Hooks.on("renderSettings", (app, html) => {
  try {
    const root = rootElement(html);
    if (!root || root.querySelector(".at-open-button")) return;
    const section = document.createElement("div");
    section.className = "at-settings-entry";
    section.append(makeOpenButton());
    (root.querySelector("#settings-game") ?? root).append(section);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not add the settings button`, err);
  }
});

/** World settings sync to every client; re-render the tracker whenever our data changes anywhere. */
Hooks.on("updateSetting", (setting) => {
  if (!setting.key?.startsWith(`${MODULE_ID}.`)) return;
  ArmyTrackerApp.instance?.render();
});

/** With player editing on the data lives in a journal entry, so watch that too. */
Hooks.on("updateJournalEntry", (doc) => {
  if (isStoreDoc(doc)) ArmyTrackerApp.instance?.render();
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
