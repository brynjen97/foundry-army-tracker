import { MODULE_ID, SETTING_DATA } from "./constants.mjs";
import { docClass } from "./util.mjs";

/**
 * Where the army data actually lives.
 *
 * By default it is a world setting, which only a GM may write — so every
 * player edit is relayed to the GM's client and nothing saves when no GM is
 * connected. That is the right shape for a game being run, and the wrong shape
 * for a shared notebook the table fills in between sessions.
 *
 * With player editing switched on, the same blob moves into a JournalEntry
 * owned by everyone. Players can then write it directly, with no GM online at
 * all. Nothing else in the module needs to know which of the two is in use:
 * everything reads through `readStore` and writes through `writeStore`.
 *
 * The blob is kept as a JSON string rather than a live object, because flag
 * updates merge rather than replace — a stored object would quietly keep keys
 * that were meant to be deleted.
 */

/** Flag marking the JournalEntry that carries the data. */
const STORE_FLAG = "store";
const DATA_FLAG = "data";

const OWNER_LEVEL = () => globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

export function playerEditingEnabled() {
  return game.settings.get(MODULE_ID, "playerEditing") === true;
}

/** The JournalEntry holding the data, if one has been created. */
export function storeDoc() {
  return game.journal?.find((j) => j.getFlag(MODULE_ID, STORE_FLAG) === true) ?? null;
}

/**
 * Whether this user can save changes themselves, rather than asking a GM to.
 * A GM always can; a player only once the shared document exists and they own it.
 */
export function canWriteDirectly() {
  if (game.user.isGM) return true;
  if (!playerEditingEnabled()) return false;
  return !!storeDoc()?.isOwner;
}

/** Whether players are allowed to add and edit roster entries at all. */
export function playerRosterEditing() {
  return playerEditingEnabled();
}

/* -------------------------------------------- */
/*  Reading and writing                         */
/* -------------------------------------------- */

/** The stored blob, from whichever backing store is in use. */
export function readStore() {
  if (playerEditingEnabled()) {
    const raw = storeDoc()?.getFlag(MODULE_ID, DATA_FLAG);
    const parsed = parse(raw);
    if (parsed) return parsed;
  }
  return game.settings.get(MODULE_ID, SETTING_DATA) ?? {};
}

/**
 * Persist the blob.
 * @returns {Promise<boolean>} false when this user was not allowed to write,
 *   which is the caller's cue to relay the change to a GM instead.
 */
export async function writeStore(data) {
  if (playerEditingEnabled()) {
    const doc = storeDoc();
    if (doc?.isOwner) {
      await doc.setFlag(MODULE_ID, DATA_FLAG, JSON.stringify(data));
      return true;
    }
  }
  if (!game.user.isGM) return false;
  await game.settings.set(MODULE_ID, SETTING_DATA, data);
  return true;
}

function parse(raw) {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch (err) {
    console.error(`${MODULE_ID} | Shared data could not be read`, err);
    return null;
  }
}

/** Whether a document update touched the shared store, for re-render hooks. */
export function isStoreDoc(doc) {
  return doc?.getFlag?.(MODULE_ID, STORE_FLAG) === true;
}

/* -------------------------------------------- */
/*  Setting the store up and taking it down     */
/* -------------------------------------------- */

/**
 * GM-only: make the backing store match the setting.
 *
 * Turning player editing on copies the current data into a shared journal
 * entry and hands every player ownership of it. Turning it off copies whatever
 * the table wrote back into the world setting. The journal entry is left in
 * place either way — deleting a document full of the party's notes because a
 * toggle flipped would be an unpleasant surprise.
 */
export async function syncStore() {
  if (!game.user.isGM) return null;
  const enabled = playerEditingEnabled();
  const doc = storeDoc();

  if (enabled) {
    if (!doc) return createStore(game.settings.get(MODULE_ID, SETTING_DATA) ?? {});
    // Repair ownership, in case the entry was edited by hand.
    if ((doc.ownership?.default ?? 0) < OWNER_LEVEL()) {
      await doc.update({ [`ownership.default`]: OWNER_LEVEL() });
    }
    // A journal that has never been written falls back to the setting; seed it
    // so the two do not disagree the moment someone edits.
    if (!parse(doc.getFlag(MODULE_ID, DATA_FLAG))) {
      await doc.setFlag(MODULE_ID, DATA_FLAG,
        JSON.stringify(game.settings.get(MODULE_ID, SETTING_DATA) ?? {}));
    }
    return doc;
  }

  // Switched off: fold the shared copy back into the setting so the work the
  // table did while it was on is not stranded in a document nothing reads.
  const stored = parse(doc?.getFlag(MODULE_ID, DATA_FLAG));
  if (stored) await game.settings.set(MODULE_ID, SETTING_DATA, stored);
  return null;
}

async function createStore(data) {
  try {
    const created = await docClass("JournalEntry").create({
      name: game.i18n.localize("ARMY.Store.docName"),
      ownership: { default: OWNER_LEVEL() },
      flags: { [MODULE_ID]: { [STORE_FLAG]: true, [DATA_FLAG]: JSON.stringify(data) } }
    });
    return created ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not create the shared data journal`, err);
    ui.notifications?.error(game.i18n.localize("ARMY.Store.createFailed"));
    return null;
  }
}
