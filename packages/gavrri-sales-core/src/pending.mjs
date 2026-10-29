/** Local-only pending storage adapter; never exposed to Gadget callers. */
/** @param {D1Database} db */
export function createPendingStore(db) {
  return {
    /** @param {string} scope @param {import("./capability.mjs").Action} action */
    async put(scope,action) {
      const result=await db.prepare('INSERT INTO local_pending_actions(scope,payload) VALUES(?,?)').bind(scope,JSON.stringify(action)).run();
      return result.meta.last_row_id;
    },
    /** @param {string} scope @param {number} id @returns {Promise<import("./capability.mjs").Action|null>} */
    async get(scope,id) {
      const row=/** @type {{payload:string}|null} */ (await db.prepare('SELECT payload FROM local_pending_actions WHERE scope=? AND id=?').bind(scope,id).first());
      return row?JSON.parse(row.payload):null;
    },
    /** @param {string} scope @param {number} id */
    async remove(scope,id) {
      await db.prepare('DELETE FROM local_pending_actions WHERE scope=? AND id=?').bind(scope,id).run();
    },
  };
}
