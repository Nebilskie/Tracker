require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const pool = require("./db");   

const app = express();

if (!fs.existsSync("C:/Temp")) {
  fs.mkdirSync("C:/Temp", { recursive: true });
}

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-device-id"],
  })
);

app.use(express.json());
// allow raw text/csv bodies to be parsed into req.body as string
app.use(express.text({ type: ['text/csv', 'text/plain'] }));

app.use((req, res, next) => {
  const deviceId = req.headers["x-device-id"];
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (deviceId) console.log(`📱 Device: ${deviceId}`);
  next();
});

// Quick health route for debugging
app.get('/ping', (req, res) => {
  console.log('[PING] received');
  res.json({ success: true, now: new Date().toISOString() });
});

const validStatuses = ["N", "I", "R", "C"];
const ROOM_PLACEHOLDER_LABEL = "__ROOM__";

function normalizeRequestStatus(input) {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (validStatuses.includes(upper)) return upper;

  const compact = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "new") return "N";
  if (compact === "inprogress") return "I";
  if (compact === "rejected") return "R";
  if (compact === "completed") return "C";

  return null;
}

/* =========================
   INIT TABLES
========================= */
async function initializeTables() {
  const conn = await pool.getConnection();

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        username VARCHAR(255) NOT NULL,
        request_text LONGTEXT NOT NULL,
        reason LONGTEXT,
        status VARCHAR(1) NOT NULL DEFAULT 'N' COMMENT '''N''-New, ''I''-In-Progress, ''R''-Rejected, ''C''-Completed',
        inventory_table VARCHAR(100) NULL DEFAULT NULL,
        inventory_item_id INT NULL DEFAULT NULL,
        inventory_item_name VARCHAR(255) NULL DEFAULT NULL,
        previous_inventory_item_name VARCHAR(255) NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        inprogress_at DATETIME NULL DEFAULT NULL,
        completed_at DATETIME NULL DEFAULT NULL,
        rejected_at DATETIME NULL DEFAULT NULL,
        rejected_from ENUM('N','I') NULL DEFAULT NULL
      )
    `);

    // ---- migrate legacy status schema/data (older builds used a statuses FK + string values) ----
    try {
      const [dbRows] = await conn.query("SELECT DATABASE() AS db");
      const dbName = dbRows?.[0]?.db;

      if (dbName) {
        const [fkRows] = await conn.query(
          `
          SELECT DISTINCT kcu.CONSTRAINT_NAME AS constraintName
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          WHERE kcu.TABLE_SCHEMA = ?
            AND kcu.TABLE_NAME = 'requests'
            AND kcu.COLUMN_NAME = 'status'
            AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
          `,
          [dbName]
        );

        for (const r of fkRows) {
          const name = r?.constraintName;
          if (!name) continue;
          try {
            await conn.query(`ALTER TABLE requests DROP FOREIGN KEY \`${name}\``);
          } catch (_e) {
            // best-effort: constraint may already be gone / different permissions
          }
        }
      }

      // Convert old string statuses to the new 1-char codes.
      await conn.query(`
        UPDATE requests
        SET status = CASE
          WHEN status = 'new' THEN 'N'
          WHEN status = 'inprogress' THEN 'I'
          WHEN status = 'rejected' THEN 'R'
          WHEN status = 'completed' THEN 'C'
          ELSE status
        END
        WHERE status IN ('new','inprogress','rejected','completed')
      `);

      // Convert rejected_from legacy values.
      await conn.query(`
        UPDATE requests
        SET rejected_from = CASE
          WHEN rejected_from = 'new' THEN 'N'
          WHEN rejected_from = 'inprogress' THEN 'I'
          ELSE rejected_from
        END
        WHERE rejected_from IN ('new','inprogress')
      `);

      // Ensure the columns use the new enums (CREATE TABLE IF NOT EXISTS won't update existing schemas).
      await conn.query(
        `ALTER TABLE requests MODIFY status VARCHAR(1) NOT NULL DEFAULT 'N' COMMENT '''N''-New, ''I''-In-Progress, ''R''-Rejected, ''C''-Completed'`
      );
      await conn.query(`ALTER TABLE requests MODIFY rejected_from ENUM('N','I') NULL DEFAULT NULL`);

      // Best-effort: add a check constraint for valid status codes (ignored if unsupported).
      try {
        await conn.query(
          "ALTER TABLE requests ADD CONSTRAINT requests_status_chk CHECK (status IN ('N','I','R','C'))"
        );
      } catch (_e) {
        // ignore (older MySQL, constraint already exists, etc.)
      }
    } catch (e) {
      console.warn("⚠️ requests status migration skipped:", e?.message || e);
    }

    const [columnsInventoryTable] = await conn.query(
      "SHOW COLUMNS FROM requests LIKE 'inventory_table'"
    );
    if (!columnsInventoryTable.length) {
      await conn.query(
        "ALTER TABLE requests ADD COLUMN inventory_table VARCHAR(100) NULL DEFAULT NULL"
      );
    }

    const [columnsInventoryItemId] = await conn.query(
      "SHOW COLUMNS FROM requests LIKE 'inventory_item_id'"
    );
    if (!columnsInventoryItemId.length) {
      await conn.query(
        "ALTER TABLE requests ADD COLUMN inventory_item_id INT NULL DEFAULT NULL"
      );
    }

    const [columnsInventoryItemName] = await conn.query(
      "SHOW COLUMNS FROM requests LIKE 'inventory_item_name'"
    );
    if (!columnsInventoryItemName.length) {
      await conn.query(
        "ALTER TABLE requests ADD COLUMN inventory_item_name VARCHAR(255) NULL DEFAULT NULL"
      );
    }

    const [columnsPreviousInventoryItemName] = await conn.query(
      "SHOW COLUMNS FROM requests LIKE 'previous_inventory_item_name'"
    );
    if (!columnsPreviousInventoryItemName.length) {
      await conn.query(
        "ALTER TABLE requests ADD COLUMN previous_inventory_item_name VARCHAR(255) NULL DEFAULT NULL"
      );
    }

     // ---- migrate legacy table name floorplan_rooms -> mst_room ----
     try {
       const [oldRooms] = await conn.query("SHOW TABLES LIKE 'floorplan_rooms'");
       const [newRooms] = await conn.query("SHOW TABLES LIKE 'mst_room'");
       if (oldRooms.length && !newRooms.length) {
         await conn.query("RENAME TABLE floorplan_rooms TO mst_room");
       }
     } catch (e) {
       console.warn("⚠️ mst_room table rename skipped:", e?.message || e);
     }

     await conn.query(`
      CREATE TABLE IF NOT EXISTS mst_room (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100),
        room_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room_name (user_id, room_name)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS mst_building (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL DEFAULT 'GLOBAL',
        building_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_building_name (user_id, building_name)
      )
    `);

    // Ensure we always have a default "storage" building.
    await conn.query(
      "INSERT IGNORE INTO mst_building (user_id, building_name) VALUES ('GLOBAL', 'storage')"
    );

    // ---- rooms belong to buildings (mst_room.building_id) ----
    // Add building_id column if missing
    try {
      const [buildingIdCol] = await conn.query("SHOW COLUMNS FROM mst_room LIKE 'building_id'");
      if (!buildingIdCol.length) {
        await conn.query("ALTER TABLE mst_room ADD COLUMN building_id INT NULL AFTER user_id");
      }
    } catch (e) {
      console.warn("⚠️ mst_room building_id migration skipped:", e?.message || e);
    }

    // Prefer uniqueness scoped to building + user (allow same room name in different buildings)
    try {
      // Drop legacy unique key if present and replace with scoped unique
      const [idx] = await conn.query("SHOW INDEX FROM mst_room WHERE Key_name = 'uniq_user_room_name'");
      if (idx.length) {
        await conn.query("ALTER TABLE mst_room DROP INDEX uniq_user_room_name");
      }
      const [scopedIdx] = await conn.query("SHOW INDEX FROM mst_room WHERE Key_name = 'uniq_user_building_room_name'");
      if (!scopedIdx.length) {
        await conn.query("ALTER TABLE mst_room ADD UNIQUE KEY uniq_user_building_room_name (user_id, building_id, room_name)");
      }
    } catch (e) {
      console.warn("⚠️ mst_room unique index migration skipped:", e?.message || e);
    }

    // Best-effort foreign key (may fail if existing data is inconsistent)
    try {
      const [fk] = await conn.query(
        "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mst_room' AND COLUMN_NAME = 'building_id' AND REFERENCED_TABLE_NAME = 'mst_building' LIMIT 1"
      );
      if (!fk.length) {
        await conn.query(
          "ALTER TABLE mst_room ADD CONSTRAINT fk_mst_room_building FOREIGN KEY (building_id) REFERENCES mst_building(id) ON DELETE SET NULL"
        );
      }
    } catch (e) {
      console.warn("⚠️ mst_room building FK migration skipped:", e?.message || e);
    }

    // ---- migrate legacy table name floorplans/cubicles -> mst_cubicles ----
    try {
      const [floorplanTables] = await conn.query("SHOW TABLES LIKE 'floorplans'");
      const [cubiclesTables] = await conn.query("SHOW TABLES LIKE 'cubicles'");
      const [mstCubiclesTables] = await conn.query("SHOW TABLES LIKE 'mst_cubicles'");

      if (!mstCubiclesTables.length) {
        if (cubiclesTables.length) {
          await conn.query("RENAME TABLE cubicles TO mst_cubicles");
        } else if (floorplanTables.length) {
          await conn.query("RENAME TABLE floorplans TO mst_cubicles");
        }
      }
    } catch (e) {
      console.warn("⚠️ cubicles table rename skipped:", e?.message || e);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS mst_cubicles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100),
        label VARCHAR(100),
        item_type VARCHAR(50) DEFAULT 'cubicle',
        room_id INT,
        x INT,
        y INT,
        w INT,
        h INT,
        created_order INT DEFAULT 0,
        version INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room_label (user_id, room_id, label),
        FOREIGN KEY (room_id) REFERENCES mst_room(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS mst_brand (
        id INT AUTO_INCREMENT PRIMARY KEY,
        brand_name VARCHAR(255) NOT NULL,
        UNIQUE KEY uniq_brand_name (brand_name)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS mst_item (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_type VARCHAR(50) NOT NULL,
        code VARCHAR(255) NOT NULL,
        item_details VARCHAR(255) NULL,
        brand_id INT NULL,
        building_id INT NOT NULL,
        room_id INT NULL,
        cubicle_id INT NULL,
        status TINYINT NOT NULL DEFAULT 1 COMMENT '0=Defect,1=Available,2=Used',
        location VARCHAR(255) DEFAULT NULL,
        last_update DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_item_type_code (item_type, code),
        KEY idx_item_brand_id (brand_id),
        KEY idx_item_building_id (building_id),
        KEY idx_item_room_id (room_id),
        KEY idx_item_cubicle_id (cubicle_id),
        CONSTRAINT fk_mst_item_brand FOREIGN KEY (brand_id) REFERENCES mst_brand(id) ON DELETE SET NULL,
        CONSTRAINT fk_mst_item_building FOREIGN KEY (building_id) REFERENCES mst_building(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mst_item_room FOREIGN KEY (room_id) REFERENCES mst_room(id) ON DELETE SET NULL,
        CONSTRAINT fk_mst_item_cubicle FOREIGN KEY (cubicle_id) REFERENCES mst_cubicles(id) ON DELETE SET NULL
      )
    `);

    // Backfill schema for older databases (CREATE TABLE IF NOT EXISTS won't alter existing).
    const [itemDetailsCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'item_details'");
    if (!itemDetailsCol.length) {
      await conn.query("ALTER TABLE mst_item ADD COLUMN item_details VARCHAR(255) NULL AFTER code");
    }

    const [itemStatusCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'status'");
    if (!itemStatusCol.length) {
      await conn.query(
        "ALTER TABLE mst_item ADD COLUMN status TINYINT NOT NULL DEFAULT 1 COMMENT '0=Defect,1=Available,2=Used' AFTER brand_id"
      );
    }

    // Ensure storage building exists and capture its id for backfill.
    const [storageRows] = await conn.query(
      "SELECT id FROM mst_building WHERE user_id = 'GLOBAL' AND LOWER(TRIM(building_name)) = 'storage' LIMIT 1"
    );
    const storageBuildingId = storageRows?.[0]?.id || null;

    const [buildingIdCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'building_id'");
    if (!buildingIdCol.length) {
      // Add nullable first so we can backfill, then enforce NOT NULL.
      await conn.query("ALTER TABLE mst_item ADD COLUMN building_id INT NULL AFTER brand_id");
    }

    const [roomIdCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'room_id'");
    if (!roomIdCol.length) {
      await conn.query("ALTER TABLE mst_item ADD COLUMN room_id INT NULL AFTER building_id");
    }

    const [cubicleIdCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'cubicle_id'");
    if (!cubicleIdCol.length) {
      await conn.query("ALTER TABLE mst_item ADD COLUMN cubicle_id INT NULL AFTER room_id");
    }

    if (storageBuildingId) {
      await conn.query(
        "UPDATE mst_item SET building_id = ? WHERE building_id IS NULL",
        [storageBuildingId]
      );
    }

    // Enforce not-null building_id (default location is storage).
    try {
      await conn.query("ALTER TABLE mst_item MODIFY building_id INT NOT NULL");
    } catch (_e) {
      // best-effort: may fail if there are still NULLs or permissions
    }

    // Best-effort: add foreign keys for older databases.
    try {
      await conn.query(
        "ALTER TABLE mst_item ADD CONSTRAINT fk_mst_item_building FOREIGN KEY (building_id) REFERENCES mst_building(id) ON DELETE RESTRICT"
      );
    } catch (_e) {}
    try {
      await conn.query(
        "ALTER TABLE mst_item ADD CONSTRAINT fk_mst_item_room FOREIGN KEY (room_id) REFERENCES mst_room(id) ON DELETE SET NULL"
      );
    } catch (_e) {}
    try {
      await conn.query(
        "ALTER TABLE mst_item ADD CONSTRAINT fk_mst_item_cubicle FOREIGN KEY (cubicle_id) REFERENCES mst_cubicles(id) ON DELETE SET NULL"
      );
    } catch (_e) {}

    // Clean up legacy room placeholder entries in the mst_cubicles table.

    const [createdOrderCol] = await conn.query(
      "SHOW COLUMNS FROM mst_cubicles LIKE 'created_order'"
    );
    if (!createdOrderCol.length) {
      await conn.query(
        "ALTER TABLE mst_cubicles ADD COLUMN created_order INT DEFAULT 0 AFTER h"
      );
    }

    const [itemTypeCol] = await conn.query(
      "SHOW COLUMNS FROM mst_cubicles LIKE 'item_type'"
    );
    if (!itemTypeCol.length) {
      await conn.query(
        "ALTER TABLE mst_cubicles ADD COLUMN item_type VARCHAR(50) DEFAULT 'cubicle' AFTER label"
      );
    }

    // Ensure inventory is a simple mapping table (label per room)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100),
        room_id INT,
        label VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room_label (user_id, room_id, label),
        FOREIGN KEY (room_id) REFERENCES mst_room(id) ON DELETE CASCADE
      )
    `);

    // Drop legacy per-item-type tables (we now use mst_item)
    try {
      await conn.query("DROP TABLE IF EXISTS monitors");
      await conn.query("DROP TABLE IF EXISTS headsets");
      await conn.query("DROP TABLE IF EXISTS cameras");
      await conn.query("DROP TABLE IF EXISTS mouse");
      await conn.query("DROP TABLE IF EXISTS keyboards");
      await conn.query("DROP TABLE IF EXISTS computers");
    } catch (_e) {
      // ignore drop errors
    }

    console.log("✅ Tables ready");
  } finally {
    conn.release();
  }
}

// Simple CSV parser: returns array of objects using header row
function parseCSVTextToObjects(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
  if (!lines.length) return [];
  const headers = parseCSVLineToArray(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLineToArray(lines[i]);
    if (cols.length === 0) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] == null ? '' : cols[j];
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLineToArray(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result.map(s => s.trim());
}

/* =========================
   HELPERS
========================= */
async function upsertFloorplanInventory(conn, userId, roomId, floorItems) {
  if (!Array.isArray(floorItems)) return;

  await conn.query("DELETE FROM inventory WHERE room_id = ?", [roomId]);

  for (const item of floorItems) {
    // 🔥 SKIP ROOM + INVALID
    if (!item?.label || item.label === ROOM_PLACEHOLDER_LABEL) continue;

    if ((item.type || item.itemType || "cubicle") !== "cubicle") continue;

    await conn.query(
      `INSERT INTO inventory (user_id, room_id, label) VALUES (?, ?, ?)`,
      [userId, roomId, item.label]
    );
  }
}

function resolveInventoryTableFromRequestText(requestText) {
  const text = (requestText || "").toLowerCase();
  const mapping = {
    monitor: "monitor",
    headset: "headset",
    webcam: "camera",
    camera: "camera",
    mouse: "mouse",
    keyboard: "keyboard",
    computer: "computer",
  };

  for (const key of Object.keys(mapping)) {
    if (text.includes(key)) return mapping[key];
  }
  return null;
}

function extractCubicleLabel(requestText) {
  if (!requestText) return null;
  const match = requestText.match(/for\s+Cubicle\s+([\w-]+)/i);
  if (match) return match[1];
  const match2 = requestText.match(/for\s+([\w-]+)/i);
  return match2 ? match2[1] : null;
}

// not needed anymore: inventory columns removed; use mst_item for actual items

async function setFloorplanInventoryValue(conn, roomId, label, itemType, itemCode) {
  if (!roomId || !label || !itemType) return;

  // Find cubicle id for the label
  const [cubRows] = await conn.query(
    "SELECT id FROM mst_cubicles WHERE label = ? LIMIT 1",
    [label]
  );
  const cubicleId = cubRows?.[0]?.id || null;

  if (itemCode) {
    // assign the item to the cubicle
    await conn.query(
      `UPDATE mst_item SET room_id = ?, cubicle_id = ?, updated_at = CURRENT_TIMESTAMP WHERE item_type = ? AND code = ?`,
      [roomId, cubicleId, itemType, itemCode]
    );
  } else {
    // clear assignment for any item of this type assigned to this cubicle
    if (cubicleId) {
      await conn.query(
        `UPDATE mst_item SET cubicle_id = NULL, room_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE item_type = ? AND cubicle_id = ?`,
        [itemType, cubicleId]
      );
    }
  }

  // Update location text on the item row (optional) by calling updateItemLocation
  if (itemCode) {
    await updateItemLocation(conn, 'mst_item', itemCode);
  }
}


async function reserveRequestedItem(conn, requestId, requestText) {
  const itemType = resolveInventoryTableFromRequestText(requestText);
  if (!itemType) return;

  const [reqRows] = await conn.query(
    "SELECT user_id FROM requests WHERE id = ?",
    [requestId]
  );

  const userId = reqRows?.[0]?.user_id || null;

  try {
    // find an available mst_item of this type
    const [availableRows] = await conn.query(
      `SELECT id, code FROM mst_item WHERE item_type = ? AND status = 1 ORDER BY last_update ASC LIMIT 1`,
      [itemType]
    );

    if (!availableRows.length) return;

    const itemId = availableRows[0].id;
    const itemName = availableRows[0].code || null;

    await conn.query(
      `UPDATE mst_item SET status = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [itemId]
    );

    await conn.query(
      `UPDATE requests SET inventory_table = ?, inventory_item_id = ?, inventory_item_name = ? WHERE id = ?`,
      ['mst_item', itemId, itemName, requestId]
    );

    const cubicleLabel = extractCubicleLabel(requestText);

    if (cubicleLabel && userId) {
      const [cubRows] = await conn.query(
        "SELECT id AS cubicle_id, room_id FROM mst_cubicles WHERE label = ? LIMIT 1",
        [cubicleLabel]
      );
      const cubicleId = cubRows?.[0]?.cubicle_id || null;
      const roomId = cubRows?.[0]?.room_id || null;

      if (roomId) {
        // previous item assigned to this cubicle for this type
        const [prev] = await conn.query(
          `SELECT id, code FROM mst_item WHERE cubicle_id = ? AND item_type = ? LIMIT 1`,
          [cubicleId, itemType]
        );

        const previousItemName = prev?.[0]?.code || null;
        if (previousItemName && previousItemName !== itemName) {
          await conn.query(
            `UPDATE requests SET previous_inventory_item_name = ? WHERE id = ?`,
            [previousItemName, requestId]
          );
          // detach previous item from cubicle
          await conn.query(
            `UPDATE mst_item SET cubicle_id = NULL, room_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [prev[0].id]
          );
        }

        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, itemType, itemName);
      }
    }
  } catch (err) {
    console.error(`❌ Error reserving inventory for request ${requestId}:`, err);
  }
}

async function releaseReservedItem(conn, requestId, requestText) {
  try {
    const [reqRows] = await conn.query(
      "SELECT user_id, inventory_table, inventory_item_id FROM requests WHERE id = ?",
      [requestId]
    );

    const userId = reqRows?.[0]?.user_id || null;
    const itemId = reqRows?.[0]?.inventory_item_id;

    if (!itemId) return;

    const [existing] = await conn.query(
      `SELECT status, item_type, code FROM mst_item WHERE id = ?`,
      [itemId]
    );

    if (!existing.length) return;

    const row = existing[0];
    if (row.status === 2) {
      // mark available
      await conn.query(`UPDATE mst_item SET status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [itemId]);

      const cubicleLabel = extractCubicleLabel(requestText);
      const itemType = row.item_type;

      if (cubicleLabel && itemType && userId) {
        const [cubRows] = await conn.query(
          "SELECT id AS cubicle_id, room_id FROM mst_cubicles WHERE label = ? LIMIT 1",
          [cubicleLabel]
        );
        const roomId = cubRows?.[0]?.room_id || null;

        if (roomId) {
          await setFloorplanInventoryValue(conn, roomId, cubicleLabel, itemType, null);
          await updateItemLocation(conn, 'mst_item', null);
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error releasing reserved item for request ${requestId}:`, err);
  }
}

async function markRequestedItemUsed(conn, requestId, requestText) {
  try {
    const [reqRows] = await conn.query(
      "SELECT user_id, inventory_table, inventory_item_id FROM requests WHERE id = ?",
      [requestId]
    );

    const userId = reqRows?.[0]?.user_id || null;
    const itemId = reqRows?.[0]?.inventory_item_id || null;
    const itemTypeFromText = resolveInventoryTableFromRequestText(requestText);

    if (!itemId) return;

    await conn.query(`UPDATE mst_item SET status = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [itemId]);

    const [itemRows] = await conn.query(`SELECT code, item_type FROM mst_item WHERE id = ?`, [itemId]);
    const itemName = itemRows?.[0]?.code || null;
    const itemType = itemRows?.[0]?.item_type || itemTypeFromText;

    const cubicleLabel = extractCubicleLabel(requestText);

    if (cubicleLabel && itemType && userId) {
      const [roomRows] = await conn.query(
        "SELECT id AS cubicle_id, room_id FROM mst_cubicles WHERE label = ? LIMIT 1",
        [cubicleLabel]
      );
      const roomId = roomRows?.[0]?.room_id || null;

      if (roomId) {
        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, itemType, itemName);
        await updateItemLocation(conn, 'mst_item', itemName);
      }
    }
  } catch (err) {
    console.error(`❌ Error marking item used for request ${requestId}:`, err);
  }
}

async function updateItemLocation(conn, table, itemName) {
  // table currently expected to be 'mst_item' when used
  if (table !== 'mst_item' || !itemName) return;

  // find item by code
  const [items] = await conn.query(
    `SELECT room_id, cubicle_id FROM mst_item WHERE LOWER(code) = LOWER(?) LIMIT 1`,
    [itemName]
  );

  if (!items.length) return;

  const item = items[0];

  let location = null;

  if (item.cubicle_id) {
    const [cub] = await conn.query(
      `SELECT label, room_id FROM mst_cubicles WHERE id = ? LIMIT 1`,
      [item.cubicle_id]
    );
    if (cub.length) {
      const [rr] = await conn.query(
        `SELECT room_name FROM mst_room WHERE id = ? LIMIT 1`,
        [cub[0].room_id]
      );
      const roomName = rr?.[0]?.room_name || cub[0].room_id;
      location = `${cub[0].label} Room ${roomName}`;
    }
  } else if (item.room_id) {
    const [roomRows] = await conn.query(`SELECT room_name FROM mst_room WHERE id = ? LIMIT 1`, [item.room_id]);
    const roomName = roomRows?.[0]?.room_name || item.room_id;
    location = `Room ${roomName}`;
  }

  await conn.query(
    `UPDATE mst_item SET location = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(code) = LOWER(?)`,
    [location, itemName]
  );
}

/* =========================
   AUTH
========================= */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT id,username,role FROM users WHERE username=? AND password=? LIMIT 1",
      [username, password]
    );

    if (!rows.length) return res.json({ success: false });
    res.json({ success: true, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

/* =========================
   REQUESTS
========================= */
// Inventory GET by type (also handles legacy /api/inventory/summary requests when routed here)
app.get('/api/inventory/:type', async (req, res) => {
  const typeParam = String(req.params.type || '').trim();
  const conn = await pool.getConnection();

  try {
    // If client accidentally hits this route with 'summary', return the aggregated summary
    if (typeParam.toLowerCase() === 'summary') {
      const [sumRows] = await conn.query(
        `SELECT TRIM(item_type) AS name,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS defects,
                SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS used,
                SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS available
         FROM mst_item
         GROUP BY TRIM(item_type)
         ORDER BY TRIM(item_type) ASC`
      );

      const summary = (sumRows || []).map(r => ({
        name: r.name || 'Unknown',
        total: Number(r.total || 0),
        defects: Number(r.defects || 0),
        used: Number(r.used || 0),
        available: Number(r.available || 0)
      }));

      return res.json({ success: true, summary });
    }

    // Normal per-type listing — compute a human-friendly location from cubicle/room/building
    console.log(`[inventory] requested type='${typeParam}'`);
    const [rows] = await conn.query(
      `SELECT i.id,
              i.item_type,
              i.code,
              i.item_details,
              i.status,
              CASE
                WHEN c.id IS NOT NULL AND COALESCE(rm_cub.room_name,'') <> '' THEN CONCAT(c.label, ' Room ', COALESCE(rm_cub.room_name,''))
                WHEN i.room_id IS NOT NULL AND COALESCE(rm_item.room_name,'') <> '' THEN CONCAT('Room ', COALESCE(rm_item.room_name,''))
                WHEN bld.building_name IS NOT NULL THEN bld.building_name
                ELSE ''
              END AS location,
              i.last_update,
              b.brand_name AS manufacturer
       FROM mst_item i
       LEFT JOIN mst_brand b ON b.id = i.brand_id
       LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
       LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
       LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
       LEFT JOIN mst_building bld ON bld.id = i.building_id
       WHERE LOWER(TRIM(COALESCE(i.item_type,''))) = LOWER(TRIM(?))
       ORDER BY i.code ASC`,
      [typeParam]
    );

    console.log(`[inventory] primary query returned ${rows.length} rows`);

    // Fallback: if primary query returned nothing, try a permissive LIKE match (handles variants)
    if (!rows.length) {
      const [fallbackRows] = await conn.query(
        `SELECT i.id,
                i.item_type,
                i.code,
                i.item_details,
                i.status,
                CASE
                  WHEN c.id IS NOT NULL AND COALESCE(rm_cub.room_name,'') <> '' THEN CONCAT(c.label, ' Room ', COALESCE(rm_cub.room_name,''))
                  WHEN i.room_id IS NOT NULL AND COALESCE(rm_item.room_name,'') <> '' THEN CONCAT('Room ', COALESCE(rm_item.room_name,''))
                  WHEN bld.building_name IS NOT NULL THEN bld.building_name
                  ELSE ''
                END AS location,
                i.last_update,
                b.brand_name AS manufacturer
         FROM mst_item i
         LEFT JOIN mst_brand b ON b.id = i.brand_id
         LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
         LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
         LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
         LEFT JOIN mst_building bld ON bld.id = i.building_id
         WHERE LOWER(COALESCE(i.item_type,'')) LIKE LOWER(CONCAT('%', ?, '%'))
         ORDER BY i.code ASC`,
        [typeParam]
      );

      console.log(`[inventory] fallback LIKE query returned ${fallbackRows.length} rows`);
      if (fallbackRows.length) return res.json({ success: true, items: fallbackRows });
    }

    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('❌ /api/inventory/:type error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post("/rooms", async (req, res) => {
  const { roomId, userId } = req.body;
  if (!roomId || !userId) {
    return res.status(400).json({ success:false, error:"roomId and userId required" });
  }

  const conn = await pool.getConnection();

  try {
    const [existing] = await conn.query(
      "SELECT id FROM mst_room WHERE user_id=? AND room_name=? LIMIT 1",
      [userId, roomId]
    );

    let roomRecordId;

    if (existing.length) {
      roomRecordId = existing[0].id;
    } else {
      const [result] = await conn.query(
        "INSERT INTO mst_room (user_id, room_name) VALUES (?,?)",
        [userId, roomId]
      );
      roomRecordId = result.insertId;
    }

    // 🔥 CLEAN ANY BAD ROOM DATA IN FLOORPLANS
    await conn.query(
      "DELETE FROM mst_cubicles WHERE room_id = ? AND (item_type = 'room' OR label = '__ROOM__')",
      [roomRecordId]
    );

    res.json({ success:true, roomId:roomRecordId });

  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, error:"Server error creating room" });
  } finally {
    conn.release();
  }
});

async function handleGetCubicles(req,res){
  const roomIdParam = req.params.roomId;
  const conn = await pool.getConnection();

  try {
    let roomId;
    if (/^\d+$/.test(roomIdParam)) roomId = parseInt(roomIdParam,10);
    else {
      const [roomRecord] = await conn.query(
        "SELECT id FROM mst_room WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1",
        [roomIdParam]
      );
      if(!roomRecord.length) return res.json({success:true,floorplan:null});
      roomId = roomRecord[0].id;
    }

    const [rows] = await conn.query(
      "SELECT * FROM mst_cubicles WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__') ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    // Fetch items assigned to cubicles in this room and map by cubicle_id
    const [itemRows] = await conn.query(
      `SELECT id, item_type, code, cubicle_id FROM mst_item WHERE room_id = ? AND cubicle_id IS NOT NULL`,
      [roomId]
    );

    const cubMap = new Map();
    for (const it of itemRows) {
      const key = it.cubicle_id;
      if (!cubMap.has(key)) cubMap.set(key, {});
      cubMap.get(key)[it.item_type] = it.code;
    }

    const cubicles = rows.map(row => {
      const items = cubMap.get(row.id) || {};
      return {
        id: Number(row.id),
        type: row.item_type || "cubicle",
        label: row.item_type === "cubicle" ? row.label : "",
        x: Number(row.x || 0),
        y: Number(row.y || 0),
        w: Number(row.w || 60),
        h: Number(row.h || 40),
        createdOrder: Number(row.created_order || 0),
        monitors: items.monitor || null,
        headsets: items.headset || null,
        cameras: items.camera || null,
        mouse: items.mouse || null,
        keyboards: items.keyboard || null,
        computers: items.computer || null,
      };
    });

    res.json({ success:true, floorplan:{ roomId, userId:rows[0]?.user_id||null, layout:{cubicles} } });
  } catch(e){
    console.error(e);
    res.status(500).json({ success:false, error:"Server error loading floorplan" });
  } finally { conn.release(); }
}

app.get("/cubicles/:roomId", handleGetCubicles);
// Back-compat alias
app.get("/floorplans/:roomId", handleGetCubicles);

async function handleSaveCubicles(req, res) {
  const roomIdParam = req.params.roomId;
  const { userId, layout, cubicles } = req.body;

  if (!roomIdParam || !userId) {
    return res.status(400).json({ success: false, error: "roomId and userId are required" });
  }

  const floorItems = Array.isArray(cubicles)
    ? cubicles
    : Array.isArray(layout?.cubicles)
    ? layout.cubicles
    : [];

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let roomId;

    if (/^\d+$/.test(roomIdParam)) {
      roomId = parseInt(roomIdParam, 10);
    } else {
      const [roomRecord] = await conn.query(
        "SELECT id FROM mst_room WHERE user_id = ? AND room_name = ? LIMIT 1",
        [userId, roomIdParam]
      );

      if (!roomRecord.length) {
        const [insertResult] = await conn.query(
          "INSERT INTO mst_room (user_id, room_name) VALUES (?, ?)",
          [userId, roomIdParam]
        );
        roomId = insertResult.insertId;
      } else {
        roomId = roomRecord[0].id;
      }
    }

    // 🔥 HARD CLEAN BEFORE INSERT
    await conn.query(
      "DELETE FROM mst_cubicles WHERE room_id = ?",
      [roomId]
    );

    // 🔥 FILTER OUT ROOM ITEMS
    const itemsToSave = floorItems.filter(
      (item) =>
        (item?.type || item?.itemType || "cubicle").toLowerCase() !== "room" &&
        item?.label !== "__ROOM__"
    );

    // 🔥 INSERT ONLY VALID ITEMS
    for (const item of itemsToSave) {
      const itemType = (item?.type || item?.itemType || "cubicle").toLowerCase();

      await conn.query(
        `INSERT INTO mst_cubicles
        (user_id, label, item_type, room_id, x, y, w, h, created_order, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          item?.label || null,
          itemType,
          roomId,
          Number(item?.x ?? 0),
          Number(item?.y ?? 0),
          Number(item?.w ?? 60),
          Number(item?.h ?? 40),
          Number(item?.createdOrder ?? item?.created_order ?? 0),
          1,
        ]
      );
    }

    await upsertFloorplanInventory(conn, userId, roomId, itemsToSave);

    await conn.commit();
    res.json({ success: true });

  } catch (e) {
    await conn.rollback();
    console.error("❌ Save floorplan error:", e);
    res.status(500).json({ success: false, error: "Server error saving floorplan" });
  } finally {
    conn.release();
  }
}

app.post("/cubicles/:roomId", handleSaveCubicles);
// Back-compat alias
app.post("/floorplans/:roomId", handleSaveCubicles);

app.get("/cubicles", async (req,res)=>{
  const roomId = req.query.roomId;
  if(!roomId) return res.status(400).json({success:false,error:"roomId required"});

  try {
    const [rows] = await pool.query(
      "SELECT * FROM mst_cubicles WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__') ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    const cubicles = rows.map(row=>({
      ...row,
      type:row.item_type||"cubicle",
      label:row.item_type==="cubicle"?row.label:"",
      x:Number(row.x||0),
      y:Number(row.y||0),
      w:Number(row.w||60),
      h:Number(row.h||40),
      createdOrder:Number(row.created_order||0)
    }));
    res.json({success:true,cubicles});
  } catch(e){
    console.error(e);
    res.status(500).json({success:false,error:"Server error fetching cubicles"});
  }
});

async function handleListCubicles(_req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT f.room_id, f.label, fr.room_name,
             IF(fr.room_name IS NOT NULL, fr.room_name, f.room_id) as display_room_id
      FROM mst_cubicles f
      LEFT JOIN mst_room fr ON f.room_id = fr.id
      WHERE f.item_type != 'room' AND f.label IS NOT NULL AND TRIM(f.label) != '' AND f.label != ?
      ORDER BY display_room_id ASC, f.label ASC
    `, ['__ROOM__']);

    // Map to return room_id as the display room name for frontend compatibility
    const mappedRows = rows.map((row) => ({
      room_id: row.room_name || row.room_id,
      label: row.label
    }));

    return res.json({ success: true, cubicles: mappedRows });
  } catch (e) {
    console.error("❌ List floorplans error:", e);
    return res.status(500).json({ success: false, error: "Server error listing floorplans" });
  }
}

app.get("/floorplans", handleListCubicles);
app.get("/cubicles/list", handleListCubicles);

app.get("/floorplan-rooms", async (req,res)=>{
  try {
    const userId = req.query.userId;
    let query = "SELECT id, room_name FROM mst_room";
    const params = [];
    if(userId){
      query += " WHERE user_id=?"; 
      params.push(userId);
    }
    query += " ORDER BY room_name ASC";
    const [rows] = await pool.query(query,params);
    res.json({ success:true, rooms:rows });
  } catch(e){
    console.error(e);
    res.status(500).json({ success:false, error:"Server error listing rooms" });
  }
});

app.get("/floorplan-inventory", async (req,res)=>{
  const roomIdParam = req.query.roomId;
  if(!roomIdParam) return res.status(400).json({success:false,error:"roomId required"});

  try {
    let roomId;
    if (/^\d+$/.test(String(roomIdParam))) {
      roomId = parseInt(String(roomIdParam), 10);
    } else {
      const [roomRecord] = await pool.query(
        "SELECT id FROM mst_room WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1",
        [roomIdParam]
      );
      if (!roomRecord.length) {
        return res.json({ success:true, inventory: [] });
      }
      roomId = roomRecord[0].id;
    }

    const [rows] = await pool.query("SELECT * FROM inventory WHERE room_id=? ORDER BY id ASC", [roomId]);
    res.json({success:true,inventory:rows});
  } catch(e){
    console.error(e);
    res.status(500).json({success:false,error:"Server error listing inventory"});
  }
});

// Removed duplicate /cubicles handler (it referenced undefined `rows`).

/* =========================
   INVENTORY (via mst_item)
========================= */

// Inventory summary endpoint removed per request



/* =========================
   BUILDINGS (mst_building)
========================= */
app.get("/api/buildings", async (req, res) => {
  try {
    const userId = req.query.userId;
    let q =
      "SELECT id, user_id, building_name, created_at FROM mst_building WHERE 1=1";
    const params = [];
    if (userId !== undefined && userId !== null && String(userId).trim() !== "") {
      q += " AND (user_id = ? OR user_id = 'GLOBAL')";
      params.push(String(userId));
    } else {
      q += " AND user_id = 'GLOBAL'";
    }
    q += " ORDER BY (user_id = 'GLOBAL') ASC, building_name ASC";
    const [rows] = await pool.query(q, params);
    res.json({ success: true, buildings: rows });
  } catch (e) {
    console.error("❌ /api/buildings GET error:", e);
    res.status(500).json({ success: false, error: "Server error listing buildings" });
  }
});

app.post("/api/buildings", async (req, res) => {
  const { userId, building_name } = req.body || {};
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    return res
      .status(400)
      .json({ success: false, error: "userId required" });
  }
  const name = String(building_name || "").trim();
  if (!name) {
    return res
      .status(400)
      .json({ success: false, error: "building_name required" });
  }
  const uid = String(userId);
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      "SELECT id, user_id, building_name FROM mst_building WHERE user_id = ? AND LOWER(TRIM(building_name)) = LOWER(TRIM(?)) LIMIT 1",
      [uid, name]
    );
    if (existing.length) {
      return res.json({
        success: true,
        building: existing[0],
        existing: true,
      });
    }
    const [result] = await conn.query(
      "INSERT INTO mst_building (user_id, building_name) VALUES (?, ?)",
      [uid, name]
    );
    res.json({
      success: true,
      building: {
        id: result.insertId,
        user_id: uid,
        building_name: name,
      },
    });
  } catch (e) {
    console.error("❌ /api/buildings POST error:", e);
    res.status(500).json({ success: false, error: "Server error creating building" });
  } finally {
    conn.release();
  }
});

/* =========================
   BUILDING ROOMS (mst_room)
========================= */
app.get("/api/buildings/:buildingId/rooms", async (req, res) => {
  const buildingId = Number(req.params.buildingId);
  if (!Number.isFinite(buildingId) || buildingId <= 0) {
    return res.status(400).json({ success: false, error: "Invalid buildingId" });
  }

  try {
    // Quick preview stats:
    // - cubicles: count of mst_cubicles rows with item_type='cubicle'
    // - itemsAssigned: count of mst_item rows assigned to that room
    const [rows] = await pool.query(
      `
      SELECT
        r.id,
        r.room_name,
        r.user_id,
        r.building_id,
        COUNT(DISTINCT CASE WHEN c.item_type = 'cubicle' THEN c.id END) AS cubicles,
        COUNT(DISTINCT i.id) AS itemsAssigned
      FROM mst_room r
      LEFT JOIN mst_cubicles c ON c.room_id = r.id
      LEFT JOIN mst_item i ON i.room_id = r.id
      WHERE r.building_id = ?
      GROUP BY r.id, r.room_name, r.user_id, r.building_id
      ORDER BY r.room_name ASC
      `,
      [buildingId]
    );
    return res.json({ success: true, rooms: rows });
  } catch (e) {
    console.error("❌ /api/buildings/:buildingId/rooms GET error:", e);
    return res.status(500).json({ success: false, error: "Server error listing rooms" });
  }
});

app.post("/api/buildings/:buildingId/rooms", async (req, res) => {
  const buildingId = Number(req.params.buildingId);
  const { userId, room_name } = req.body || {};

  if (!Number.isFinite(buildingId) || buildingId <= 0) {
    return res.status(400).json({ success: false, error: "Invalid buildingId" });
  }
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    return res.status(400).json({ success: false, error: "userId required" });
  }
  const name = String(room_name || "").trim();
  if (!name) return res.status(400).json({ success: false, error: "room_name required" });

  const uid = String(userId);
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      "SELECT id, room_name, user_id, building_id FROM mst_room WHERE user_id = ? AND building_id = ? AND LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1",
      [uid, buildingId, name]
    );
    if (existing.length) {
      return res.json({ success: true, room: existing[0], existing: true });
    }

    const [result] = await conn.query(
      "INSERT INTO mst_room (user_id, building_id, room_name) VALUES (?,?,?)",
      [uid, buildingId, name]
    );

    return res.json({
      success: true,
      room: { id: result.insertId, user_id: uid, building_id: buildingId, room_name: name },
    });
  } catch (e) {
    console.error("❌ /api/buildings/:buildingId/rooms POST error:", e);
    return res.status(500).json({ success: false, error: "Server error creating room" });
  } finally {
    conn.release();
  }
});

/* =========================
   BRANDS (MASTER)
========================= */
app.get("/api/brands", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, brand_name AS brandName FROM mst_brand ORDER BY brand_name ASC"
    );
    res.json({ success: true, brands: rows });
  } catch (e) {
    console.error("❌ Brands fetch error:", e);
    res.status(500).json({ success: false });
  }
});

app.post("/api/brands", async (req, res) => {
  const brandName = String(req.body?.brandName || "").trim();
  if (!brandName) return res.status(400).json({ success: false, error: "brandName required" });

  try {
    await pool.query("INSERT INTO mst_brand (brand_name) VALUES (?)", [brandName]);
    const [rows] = await pool.query(
      "SELECT id, brand_name AS brandName FROM mst_brand WHERE brand_name = ? LIMIT 1",
      [brandName]
    );
    return res.json({ success: true, brand: rows[0] });
  } catch (e) {
    // Duplicate brand (unique constraint) -> return existing record.
    if (e?.code === "ER_DUP_ENTRY") {
      const [rows] = await pool.query(
        "SELECT id, brand_name AS brandName FROM mst_brand WHERE brand_name = ? LIMIT 1",
        [brandName]
      );
      return res.json({ success: true, brand: rows[0] });
    }

    console.error("❌ Brand create error:", e);
    return res.status(500).json({ success: false });
  }
});

app.put("/api/brands/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid id" });
  }

  const brandNameRaw = req.body?.brandName;

  const updates = [];
  const params = [];

  if (brandNameRaw != null) {
    const brandName = String(brandNameRaw).trim();
    if (!brandName) return res.status(400).json({ success: false, error: "brandName cannot be empty" });
    updates.push("brand_name = ?");
    params.push(brandName);
  }

  if (!updates.length) {
    return res.status(400).json({ success: false, error: "No fields to update" });
  }

  try {
    const [result] = await pool.query(
      `UPDATE mst_brand SET ${updates.join(", ")} WHERE id = ?`,
      [...params, id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false });

    const [rows] = await pool.query(
      "SELECT id, brand_name AS brandName FROM mst_brand WHERE id = ? LIMIT 1",
      [id]
    );

    return res.json({ success: true, brand: rows[0] });
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, error: "Brand name already exists" });
    }
    console.error("❌ Brand update error:", e);
    return res.status(500).json({ success: false });
  }
});

app.delete("/api/brands/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid id" });
  }

  try {
    const [result] = await pool.query("DELETE FROM mst_brand WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false });
    return res.json({ success: true });
  } catch (e) {
    console.error("❌ Brand delete error:", e);
    return res.status(500).json({ success: false });
  }
});

/* =========================
  ITEMS (MASTER)
  Note: allowed item types are now dynamic and come from `mst_item.item_type` values.
========================= */

async function ensureStorageBuildingId(q) {
  await q.query(
    "INSERT IGNORE INTO mst_building (user_id, building_name) VALUES ('GLOBAL', 'storage')"
  );
  const [rows] = await q.query(
    "SELECT id FROM mst_building WHERE user_id = 'GLOBAL' AND LOWER(TRIM(building_name)) = 'storage' LIMIT 1"
  );
  return rows?.[0]?.id || null;
}

app.get('/api/items', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT i.id, i.item_type, i.code, i.item_details, i.status,
              CASE
                WHEN c.id IS NOT NULL AND COALESCE(rm_cub.room_name,'') <> '' THEN CONCAT(c.label, ' Room ', COALESCE(rm_cub.room_name,''))
                WHEN i.room_id IS NOT NULL AND COALESCE(rm_item.room_name,'') <> '' THEN CONCAT('Room ', COALESCE(rm_item.room_name,''))
                WHEN bld.building_name IS NOT NULL THEN bld.building_name
                ELSE ''
                    END AS location,
                    i.last_update, b.brand_name AS manufacturer
       FROM mst_item i
       LEFT JOIN mst_brand b ON b.id = i.brand_id
       LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
       LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
       LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
       LEFT JOIN mst_building bld ON bld.id = i.building_id
       ORDER BY i.code ASC`
    );
    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('❌ /api/items error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

// Return distinct item types present in mst_item
app.get('/api/items/types', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT DISTINCT TRIM(item_type) AS item_type FROM mst_item WHERE item_type IS NOT NULL AND TRIM(item_type) <> '' ORDER BY item_type ASC`
    );
    const types = rows.map(r => r.item_type).filter(Boolean);
    res.json({ success: true, types });
  } catch (e) {
    console.error('❌ /api/items/types error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/items', async (req, res) => {
  // Creating master items is not supported via this endpoint in current build
  res.status(410).json({ success: false, error: 'Endpoint not supported' });
});

app.post('/api/items/import', async (req, res) => {
  // Importing master items is disabled in this build
  res.status(410).json({ success: false, error: 'Endpoint not supported' });
});

app.post('/api/inventory/:type/import', async (req, res) => {
  res.status(410).json({ success: false, error: 'Endpoint not supported' });
});

// Bulk inventory import endpoint disabled
app.post('/api/inventory/import', async (req, res) => {
  res.status(410).json({ success: false, error: 'Endpoint not supported' });
});

// Inventory summary grouped by item_type
app.get('/api/inventory/summary', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT item_type AS name,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS defects,
              SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS used,
              SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS available
       FROM mst_item
       GROUP BY item_type
       ORDER BY item_type ASC`
    );

    const summary = (rows || []).map(r => ({
      name: r.name || 'Unknown',
      total: Number(r.total || 0),
      defects: Number(r.defects || 0),
      used: Number(r.used || 0),
      available: Number(r.available || 0)
    }));

    res.json({ success: true, summary });
  } catch (e) {
    console.error('❌ /api/inventory/summary error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

/* =========================
   IT REQUESTS (LIST + CREATE)
========================= */
function statusCodeToLabel(code) {
  const raw = code == null ? '' : String(code).trim();
  const upper = raw.toUpperCase();
  if (upper === 'N') return 'new';
  if (upper === 'I') return 'inprogress';
  if (upper === 'C') return 'completed';
  if (upper === 'R') return 'rejected';

  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'new') return 'new';
  if (compact === 'inprogress') return 'inprogress';
  if (compact === 'completed') return 'completed';
  if (compact === 'rejected') return 'rejected';
  return 'new';
}

app.get('/api/it-requests', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT id, user_id, username, request_text, reason, status,
              created_at, updated_at, inprogress_at, completed_at, rejected_at, rejected_from,
              inventory_table, inventory_item_id, inventory_item_name, previous_inventory_item_name
         FROM requests
        ORDER BY created_at DESC, id DESC`
    );

    const requests = (rows || []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      username: r.username,
      request_text: r.request_text,
      reason: r.reason,
      status: statusCodeToLabel(r.status),
      created_at: r.created_at,
      updated_at: r.updated_at,
      inprogress_at: r.inprogress_at,
      completed_at: r.completed_at,
      rejected_at: r.rejected_at,
      rejected_from: r.rejected_from,
      inventory_table: r.inventory_table,
      inventory_item_id: r.inventory_item_id,
      inventory_item_name: r.inventory_item_name,
      previous_inventory_item_name: r.previous_inventory_item_name,
    }));

    res.json({ success: true, requests });
  } catch (e) {
    console.error('❌ /api/it-requests GET error', e);
    res.status(500).json({ success: false, error: e.message || 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/it-requests', async (req, res) => {
  const userId = req.body?.userId ?? req.body?.user_id ?? null;
  const username = String(req.body?.username || '').trim();
  const requestText = String(req.body?.requestText || req.body?.request_text || '').trim();
  const reason = String(req.body?.reason || '').trim();

  if (!username) {
    return res.status(400).json({ success: false, error: 'username is required' });
  }

  if (!requestText) {
    return res.status(400).json({ success: false, error: 'requestText is required' });
  }

  const conn = await pool.getConnection();
  try {
    const uid = userId == null || userId === '' ? null : Number(userId);
    const safeUid = Number.isFinite(uid) ? uid : null;

    const [result] = await conn.query(
      `INSERT INTO requests (user_id, username, request_text, reason, status)
       VALUES (?, ?, ?, ?, 'N')`,
      [safeUid, username, requestText, reason || null]
    );

    res.json({ success: true, id: result?.insertId });
  } catch (e) {
    console.error('❌ /api/it-requests POST error', e);
    res.status(500).json({ success: false, error: e.message || 'Database error' });
  } finally {
    conn.release();
  }
});

/* =========================
   UPDATE REQUEST STATUS
========================= */
app.put('/api/it-requests/:id', async (req, res) => {
  const requestId = Number(req.params.id);
  const normalizedStatus = normalizeRequestStatus(req.body?.status);

  if (!normalizedStatus) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT status FROM requests WHERE id = ?',
      [requestId]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false });
    }

    const currentStatus = rows[0].status;
    const now = new Date();

    const updateFields = ['status = ?'];
    const updateValues = [normalizedStatus];

    if (normalizedStatus === 'I') {
      updateFields.push('inprogress_at = ?');
      updateValues.push(now);
    }

    if (normalizedStatus === 'C') {
      updateFields.push('completed_at = ?');
      updateValues.push(now);
    }

    if (normalizedStatus === 'R') {
      updateFields.push('rejected_at = ?');
      updateValues.push(now);
      updateFields.push('rejected_from = ?');
      updateValues.push(currentStatus === 'N' || currentStatus === 'I' ? currentStatus : null);
    }

    const sql = `UPDATE requests SET ${updateFields.join(', ')} WHERE id = ?`;
    await conn.query(sql, [...updateValues, requestId]);

    const [reqRows] = await conn.query('SELECT request_text FROM requests WHERE id = ?', [requestId]);
    const requestText = reqRows?.[0]?.request_text || '';

    if (normalizedStatus === 'I') {
      await reserveRequestedItem(conn, requestId, requestText);
    }

    if (normalizedStatus === 'C') {
      await markRequestedItemUsed(conn, requestId, requestText);
    }

    if (normalizedStatus === 'R') {
      await releaseReservedItem(conn, requestId, requestText);
    }

    await conn.commit();

    res.json({ success: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('❌ Update status error:', e);
    res.status(500).json({ success: false, error: e.message || 'Database error' });
  } finally {
    conn.release();
  }
});

/* =========================
   START SERVER
========================= */
(async () => {
  try {
    await initializeTables();

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();