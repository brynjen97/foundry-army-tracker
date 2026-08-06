import { MODULE_ID } from "./constants.mjs";
import { isPF2e } from "./currency.mjs";

/**
 * "Army shop" — opens the Pathfinder 2e compendium browser on the equipment
 * tab, filtered to common items the army could plausibly source at its level.
 *
 * The browser is part of the PF2e system rather than core Foundry, and its
 * API has shifted between system versions, so everything here is probed
 * rather than assumed: if a step is not available the next one still runs,
 * and the worst case is the browser opening unfiltered instead of not at all.
 */

/** PF2e item levels top out at 30. */
export const MAX_ITEM_LEVEL = 30;

export function shopAvailable() {
  return isPF2e() && !!game.pf2e?.compendiumBrowser;
}

export function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_ITEM_LEVEL, Math.max(0, n));
}

/**
 * Open the shop for an army of the given level.
 * @returns {Promise<boolean>} whether the browser was opened.
 */
export async function openArmyShop(level) {
  const browser = game.pf2e?.compendiumBrowser;
  if (!browser) {
    ui.notifications.warn(game.i18n.localize("ARMY.Shop.unavailable"));
    return false;
  }

  const capped = clampLevel(level);
  const filter = await buildEquipmentFilter(browser, capped);
  const opened = await openEquipmentTab(browser, filter);

  if (!opened) {
    ui.notifications.error(game.i18n.localize("ARMY.Shop.failed"));
    return false;
  }
  if (!filter) {
    // The browser is open but we could not narrow it — say so rather than
    // letting the GM assume the list is already restricted.
    ui.notifications.warn(game.i18n.format("ARMY.Shop.unfiltered", { level: capped }));
  }
  return true;
}

/** Build equipment filter data set to common items at or below `level`. */
async function buildEquipmentFilter(browser, level) {
  const tab = browser.tabs?.equipment;
  if (typeof tab?.getFilterData !== "function") return null;
  try {
    const filter = await tab.getFilterData();

    const slider = filter?.sliders?.level;
    if (slider?.values) {
      slider.values.min = 0;
      slider.values.max = level;
      slider.isExpanded = true;
    }

    const rarity = filter?.checkboxes?.rarity;
    if (rarity) {
      rarity.selected = ["common"];
      if (rarity.options?.common) rarity.options.common.selected = true;
      rarity.isExpanded = true;
    }

    // Only claim a filter if at least one of the two actually applied.
    if (!slider?.values && !rarity) return null;
    return filter;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not build equipment filter`, err);
    return null;
  }
}

/**
 * Open the equipment tab. `openTab` has taken both `(name, {filter})` and
 * `(name, filter)` across PF2e versions, so try the current shape first and
 * fall back, ending with an unfiltered open.
 */
async function openEquipmentTab(browser, filter) {
  const attempts = [];
  if (filter) {
    attempts.push(() => browser.openTab("equipment", { filter }));
    attempts.push(() => browser.openTab("equipment", filter));
  }
  attempts.push(() => browser.openTab("equipment"));
  attempts.push(() => browser.render(true));

  for (const attempt of attempts) {
    try {
      await attempt();
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Compendium browser call failed, trying next form`, err);
    }
  }
  return false;
}
