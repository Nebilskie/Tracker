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
  if (deviceId) console.log(`Device: ${deviceId}`);
  next();
});

// Quick health route for debugging
app.get('/ping', (req, res) => {
  console.log('[PING] received');
  res.json({ success: true, now: new Date().toISOString() });
});

const validStatuses = ["N", "I", "R", "C", "P"];
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
  if (compact === "pending") return "P";

  return null;
}

async function hasColumn(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
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
        rejected_reason LONGTEXT,
        status VARCHAR(1) NOT NULL DEFAULT 'N' COMMENT '''N''-New, ''I''-In-Progress, ''R''-Rejected, ''C''-Completed, ''P''-Pending',
        inventory_table VARCHAR(100) NULL DEFAULT NULL,
        inventory_item_id INT NULL DEFAULT NULL,
        inventory_item_name VARCHAR(255) NULL DEFAULT NULL,
        previous_inventory_item_name VARCHAR(255) NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        inprogress_at DATETIME NULL DEFAULT NULL,
        completed_at DATETIME NULL DEFAULT NULL,
        rejected_at DATETIME NULL DEFAULT NULL,
        pending_at DATETIME NULL DEFAULT NULL,
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
          WHEN status = 'pending' THEN 'P'
          ELSE status
        END
        WHERE status IN ('new','inprogress','rejected','completed','pending')
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
        `ALTER TABLE requests MODIFY status VARCHAR(1) NOT NULL DEFAULT 'N' COMMENT '''N''-New, ''I''-In-Progress, ''R''-Rejected, ''C''-Completed, ''P''-Pending'`
      );
      await conn.query(`ALTER TABLE requests MODIFY rejected_from ENUM('N','I') NULL DEFAULT NULL`);

      // Best-effort: replace legacy status check constraints so 'P' is allowed.
      try {
        const [statusChecks] = await conn.query(`
          SELECT tc.CONSTRAINT_NAME AS constraint_name
          FROM information_schema.TABLE_CONSTRAINTS tc
          JOIN information_schema.CHECK_CONSTRAINTS cc
            ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
           AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
          WHERE tc.TABLE_SCHEMA = DATABASE()
            AND tc.TABLE_NAME = 'requests'
            AND tc.CONSTRAINT_TYPE = 'CHECK'
            AND UPPER(cc.CHECK_CLAUSE) LIKE '%STATUS%'
        `);

        for (const row of statusChecks) {
          const constraintName = row?.constraint_name;
          if (!constraintName) continue;

          try {
            await conn.query(`ALTER TABLE requests DROP CHECK \`${constraintName}\``);
            continue;
          } catch (_dropCheckErr) {
            // fall through and try DROP CONSTRAINT (MariaDB syntax)
          }

          try {
            await conn.query(`ALTER TABLE requests DROP CONSTRAINT \`${constraintName}\``);
          } catch (_dropConstraintErr) {
            // ignore if not supported by engine/version
          }
        }
      } catch (_e) {
        // ignore if INFORMATION_SCHEMA check tables are unavailable
      }

      try {
        await conn.query(
          "ALTER TABLE requests ADD CONSTRAINT requests_status_chk CHECK (status IN ('N','I','R','C','P'))"
        );
      } catch (_e) {
        // ignore if the server does not support check constraints or it already exists
      }
    } catch (e) {
      console.warn("requests status migration skipped:", e?.message || e);
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

    const [columnsPendingAt] = await conn.query(
      "SHOW COLUMNS FROM requests LIKE 'pending_at'"
    );
    if (!columnsPendingAt.length) {
      await conn.query(
        "ALTER TABLE requests ADD COLUMN pending_at DATETIME NULL DEFAULT NULL"
      );
    }

    const [columnsRejectedReason] = await conn.query(
      "SHOW COLUMNS FROM requests LIKE 'rejected_reason'"
    );
    if (!columnsRejectedReason.length) {
      await conn.query(
        "ALTER TABLE requests ADD COLUMN rejected_reason LONGTEXT NULL AFTER reason"
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
       console.warn("mst_room table rename skipped:", e?.message || e);
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
      console.warn("mst_room building_id migration skipped:", e?.message || e);
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
      console.warn("mst_room unique index migration skipped:", e?.message || e);
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
      console.warn("mst_room building FK migration skipped:", e?.message || e);
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
      console.warn("cubicles table rename skipped:", e?.message || e);
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
        added DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

    const [itemLocationCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'location'");
    if (!itemLocationCol.length) {
      await conn.query(
        "ALTER TABLE mst_item ADD COLUMN location VARCHAR(255) DEFAULT NULL AFTER cubicle_id"
      );
    }

    const [itemAddedCol] = await conn.query("SHOW COLUMNS FROM mst_item LIKE 'added'");
    if (!itemAddedCol.length) {
      await conn.query(
        "ALTER TABLE mst_item ADD COLUMN added DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER location"
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
    } catch (_e) {
      // ignore if foreign key cannot be added or already exists
    }
    try {
      await conn.query(
        "ALTER TABLE mst_item ADD CONSTRAINT fk_mst_item_room FOREIGN KEY (room_id) REFERENCES mst_room(id) ON DELETE SET NULL"
      );
    } catch (_e) {
      // ignore if foreign key cannot be added or already exists
    }
    try {
      await conn.query(
        "ALTER TABLE mst_item ADD CONSTRAINT fk_mst_item_cubicle FOREIGN KEY (cubicle_id) REFERENCES mst_cubicles(id) ON DELETE SET NULL"
      );
    } catch (_e) {
      // ignore if foreign key cannot be added or already exists
    }

    // Ensure users can be assigned to buildings, rooms, and cubicles.
    try {
      const [userTableExists] = await conn.query("SHOW TABLES LIKE 'mst_users'");
      if (userTableExists.length) {
        const [addedColUser] = await conn.query("SHOW COLUMNS FROM mst_users LIKE 'added'");
        if (!addedColUser.length) {
          await conn.query("ALTER TABLE mst_users ADD COLUMN added DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER role");
        }

        const [buildingIdColUser] = await conn.query("SHOW COLUMNS FROM mst_users LIKE 'building_id'");
        if (!buildingIdColUser.length) {
          await conn.query("ALTER TABLE mst_users ADD COLUMN building_id INT NULL AFTER added");
        }

        const [roomIdColUser] = await conn.query("SHOW COLUMNS FROM mst_users LIKE 'room_id'");
        if (!roomIdColUser.length) {
          await conn.query("ALTER TABLE mst_users ADD COLUMN room_id INT NULL AFTER building_id");
        }

        const [cubicleIdColUser] = await conn.query("SHOW COLUMNS FROM mst_users LIKE 'cubicle_id'");
        if (!cubicleIdColUser.length) {
          await conn.query("ALTER TABLE mst_users ADD COLUMN cubicle_id INT NULL AFTER room_id");
        }
      }
    } catch (e) {
      console.warn("mst_users location assignment migration skipped:", e?.message || e);
    }

    // Ensure mst_users.id is auto-incrementing (fix for older schemas)
    try {
      const [idCol] = await conn.query("SHOW COLUMNS FROM mst_users LIKE 'id'");
      if (idCol.length) {
        const extra = String(idCol[0].Extra || '');
        if (!/auto_increment/i.test(extra)) {
          try {
            await conn.query("ALTER TABLE mst_users MODIFY id INT NOT NULL AUTO_INCREMENT");
            console.log('Enabled AUTO_INCREMENT on mst_users.id');
          } catch (e) {
          console.error('/api/it-requests POST error', e);
          }
        }
      }
    } catch (e) {
      console.warn('mst_users id auto-increment migration skipped:', e?.message || e);
    }

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

    // Transfer history tracking for items
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trk_item (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        from_building_id INT,
        from_room_id INT,
        from_cubicle_id INT,
        to_building_id INT NOT NULL,
        to_room_id INT,
        to_cubicle_id INT,
        transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transferred_by_user_id INT,
        KEY idx_item_id (item_id),
        KEY idx_transferred_at (transferred_at),
        CONSTRAINT fk_trk_item_item FOREIGN KEY (item_id) REFERENCES mst_item(id) ON DELETE CASCADE
      )
    `);
    const [hasNotes] = await conn.query("SHOW COLUMNS FROM trk_item LIKE 'notes'");
    if (hasNotes.length) {
      await conn.query('ALTER TABLE trk_item DROP COLUMN notes');
    }

    // Transfer history tracking for users
    await conn.query(`
      CREATE TABLE IF NOT EXISTS trk_user (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        from_building_id INT,
        from_room_id INT,
        from_cubicle_id INT,
        to_building_id INT NOT NULL,
        to_room_id INT,
        to_cubicle_id INT,
        transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transferred_by_user_id INT,
        notes LONGTEXT,
        KEY idx_user_id (user_id),
        KEY idx_transferred_at (transferred_at),
        CONSTRAINT fk_trk_user_user FOREIGN KEY (user_id) REFERENCES mst_users(id) ON DELETE CASCADE
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
    } catch (e) {
      console.error('Update status error:', e);
    }

    console.log("Tables ready");
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

function normalizeInventoryHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function getCanonicalInventoryKey(key) {
  switch (String(key || '').trim().toLowerCase()) {
    case 'type':
    case 'itemtype':
    case 'item-type':
    case 'category':
      return 'item_type';
    case 'itemdetails':
    case 'details':
      return 'item_details';
    case 'itemcode':
    case 'item_code':
    case 'name':
      return 'code';
    case 'brand':
    case 'make':
      return 'brand_name';
    case 'building':
      return 'building_name';
    case 'room':
      return 'room_name';
    case 'cubicle':
    case 'cubicle_label':
      return 'cubicle_id';
    case 'serial':
      return 'serial_number';
    default:
      return key;
  }
}

function parseInventoryStatus(status) {
  const normalized = String(status ?? '').trim().toUpperCase();
  if (normalized === '') return null;
  if (['0', 'DEFECT', 'DEFECTS', 'DEFECTIVE'].includes(normalized)) return 0;
  if (['1', 'AVAILABLE'].includes(normalized)) return 1;
  if (['2', 'USED', 'IN_USE'].includes(normalized)) return 2;
  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) ? asNumber : null;
}

async function getOrCreateBrandId(conn, brandName) {
  const normalized = String(brandName || '').trim();
  if (!normalized) return null;
  const [rows] = await conn.query(
    'SELECT id FROM mst_brand WHERE LOWER(TRIM(brand_name)) = LOWER(TRIM(?)) LIMIT 1',
    [normalized]
  );
  if (rows.length) return rows[0].id;
  const [insertResult] = await conn.query(
    'INSERT IGNORE INTO mst_brand (brand_name) VALUES (?)',
    [normalized]
  );
  if (insertResult.insertId) return insertResult.insertId;
  const [recheck] = await conn.query(
    'SELECT id FROM mst_brand WHERE LOWER(TRIM(brand_name)) = LOWER(TRIM(?)) LIMIT 1',
    [normalized]
  );
  return recheck?.[0]?.id || null;
}

async function getOrCreateBuildingId(conn, buildingName, defaultBuildingId) {
  const normalized = String(buildingName || '').trim();
  if (!normalized) return defaultBuildingId;
  const [rows] = await conn.query(
    "SELECT id FROM mst_building WHERE LOWER(TRIM(building_name)) = LOWER(TRIM(?)) LIMIT 1",
    [normalized]
  );
  if (rows.length) return rows[0].id;
  const [insertResult] = await conn.query(
    "INSERT IGNORE INTO mst_building (user_id, building_name) VALUES ('GLOBAL', ?) ",
    [normalized]
  );
  if (insertResult.insertId) return insertResult.insertId;
  const [recheck] = await conn.query(
    "SELECT id FROM mst_building WHERE LOWER(TRIM(building_name)) = LOWER(TRIM(?)) LIMIT 1",
    [normalized]
  );
  return recheck?.[0]?.id || defaultBuildingId;
}

async function getOrCreateRoomId(conn, roomName, buildingId = null) {
  const normalized = String(roomName || '').trim();
  if (!normalized) return null;

  let query = "SELECT id FROM mst_room WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?))";
  const params = [normalized];
  if (buildingId != null) {
    query += " AND building_id = ?";
    params.push(buildingId);
  }
  query += " LIMIT 1";
1
  const [rows] = await conn.query(query, params);
  if (rows.length) return rows[0].id;

  if (buildingId != null) {
    const [insertResult] = await conn.query(
      "INSERT IGNORE INTO mst_room (user_id, building_id, room_name) VALUES ('GLOBAL', ?, ?)",
      [buildingId, normalized]
    );
    if (insertResult.insertId) return insertResult.insertId;
  } else {
    const [insertResult] = await conn.query(
      "INSERT IGNORE INTO mst_room (user_id, room_name) VALUES ('GLOBAL', ?) ",
      [normalized]
    );
    if (insertResult.insertId) return insertResult.insertId;
  }

  let recheckQuery = "SELECT id FROM mst_room WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?))";
  const recheckParams = [normalized];
  if (buildingId != null) {
    recheckQuery += " AND building_id = ?";
    recheckParams.push(buildingId);
  }
  recheckQuery += " LIMIT 1";

  const [recheck] = await conn.query(recheckQuery, recheckParams);
  return recheck?.[0]?.id || null;
}

async function normalizeAndInsertInventoryRows(conn, rows, typeParam) {
  const [columns] = await conn.query('SHOW COLUMNS FROM mst_item');
  const validColumns = columns.map((col) => col.Field);

  let [storageRows] = await conn.query(
    "SELECT id FROM mst_building WHERE user_id = 'GLOBAL' AND LOWER(TRIM(building_name)) = 'storage' LIMIT 1"
  );
  let storageBuildingId = storageRows?.[0]?.id || null;
  if (!storageBuildingId) {
    const [insertStorage] = await conn.query(
      "INSERT IGNORE INTO mst_building (user_id, building_name) VALUES ('GLOBAL', 'storage')"
    );
    storageBuildingId = insertStorage.insertId || null;
    if (!storageBuildingId) {
      const [recheck] = await conn.query(
        "SELECT id FROM mst_building WHERE user_id = 'GLOBAL' AND LOWER(TRIM(building_name)) = 'storage' LIMIT 1"
      );
      storageBuildingId = recheck?.[0]?.id || null;
    }
  }

  const normalizedRows = [];
  for (const row of rows) {
    const normalized = {};
    for (const header of Object.keys(row || {})) {
      const rawKey = normalizeInventoryHeader(header);
      if (!rawKey) continue;
      const key = getCanonicalInventoryKey(rawKey);
      const value = row[header];
      normalized[key] = typeof value === 'string' ? value.trim() : value;
    }

    if (typeParam) {
      normalized.item_type = typeParam;
    }

    if (!normalized.item_type || !normalized.code) {
      continue;
    }

    // Prefer building resolved from building_name when provided
    if (normalized.building_name) {
      normalized.building_id = await getOrCreateBuildingId(conn, normalized.building_name, storageBuildingId);
    }

    // Resolve room by name if provided, preserving any building association
    if (normalized.room_name) {
      normalized.room_id = await getOrCreateRoomId(conn, normalized.room_name, normalized.building_id);
    }

    if (normalized.status != null) {
      const statusValue = parseInventoryStatus(normalized.status);
      if (statusValue !== null) normalized.status = statusValue;
      else delete normalized.status;
    }

    // Parse numeric IDs
    if (normalized.brand_id != null) {
      const parsed = Number(normalized.brand_id);
      normalized.brand_id = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (normalized.building_id != null) {
      const parsed = Number(normalized.building_id);
      normalized.building_id = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (normalized.room_id != null) {
      const parsed = Number(normalized.room_id);
      normalized.room_id = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    // If room_id is present, prefer the room's building_id (guarantees correct mst_building.id)
    if (normalized.room_id) {
      const [roomRows] = await conn.query('SELECT building_id FROM mst_room WHERE id = ? LIMIT 1', [normalized.room_id]);
      if (roomRows.length && roomRows[0].building_id) {
        normalized.building_id = roomRows[0].building_id;
      }
    }

    // Ensure building_id falls back to storage if still missing
    if (!normalized.building_id) {
      normalized.building_id = storageBuildingId;
    }

    // Cubicle may be provided as an ID or as a label (e.g. 'C1'). Resolve label to id when possible.
    if (normalized.cubicle_id != null) {
        // numeric?
        const parsed = Number(normalized.cubicle_id);
        if (Number.isFinite(parsed) && parsed > 0) {
          normalized.cubicle_id = parsed;
        } else {
          // try to resolve by label within the provided room, then globally
          const label = String(normalized.cubicle_id || '').trim();
          let foundId = null;
          if (label) {
            if (normalized.room_id) {
              const [rows] = await conn.query(
                'SELECT id FROM mst_cubicles WHERE room_id = ? AND LOWER(TRIM(label)) = LOWER(TRIM(?)) LIMIT 1',
                [normalized.room_id, label]
              );
              if (rows.length) foundId = rows[0].id;
            }
            if (!foundId) {
              const [rows2] = await conn.query(
                'SELECT id FROM mst_cubicles WHERE LOWER(TRIM(label)) = LOWER(TRIM(?)) LIMIT 1',
                [label]
              );
              if (rows2.length) foundId = rows2[0].id;
            }
          }
          normalized.cubicle_id = foundId || null;
        }
      }

    const filtered = {};
    for (const key of Object.keys(normalized)) {
      if (validColumns.includes(key)) {
        filtered[key] = normalized[key];
      }
    }
    if (Object.keys(filtered).length === 0) continue;
    normalizedRows.push(filtered);
  }

  if (!normalizedRows.length) {
    return { success: true, imported: 0, skipped: rows.length };
  }

  const insertColumns = Array.from(
    normalizedRows.reduce((set, row) => {
      Object.keys(row).forEach((col) => set.add(col));
      return set;
    }, new Set())
  );

  const columnSql = insertColumns.map((col) => `\`${col}\``).join(', ');
  const placeholders = normalizedRows
    .map((row) => `(${insertColumns.map(() => '?').join(', ')})`)
    .join(', ');
  const values = normalizedRows.flatMap((row) => insertColumns.map((col) => row[col] ?? null));

  const [result] = await conn.query(
    `INSERT IGNORE INTO mst_item (${columnSql}) VALUES ${placeholders}`,
    values
  );

  const imported = Number(result.affectedRows || 0);
  const skipped = normalizedRows.length - imported;
  return { success: true, imported, skipped };
}

app.post('/api/admin/fix-item-building-ids', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT id, room_id, building_id FROM mst_item WHERE room_id IS NOT NULL');
    let updated = 0;
    for (const r of rows) {
      const itemId = r.id;
      const roomId = r.room_id;
      const currentBuilding = r.building_id;
      if (!roomId) continue;
      const [roomRows] = await conn.query('SELECT building_id FROM mst_room WHERE id = ? LIMIT 1', [roomId]);
      const roomBuilding = roomRows?.[0]?.building_id || null;
      if (roomBuilding && Number(roomBuilding) !== Number(currentBuilding)) {
        await conn.query('UPDATE mst_item SET building_id = ? WHERE id = ?', [roomBuilding, itemId]);
        updated++;
      }
    }
    res.json({ success: true, updated });
  } catch (e) {
    console.error('/api/admin/fix-item-building-ids error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

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

async function resolveInventoryTableFromRequestText(conn, requestText) {
  const text = (requestText || "").toLowerCase();
  if (!text) return null;

  const [rows] = await conn.query(
    `SELECT DISTINCT TRIM(LOWER(item_type)) AS item_type
     FROM mst_item
     WHERE item_type IS NOT NULL AND TRIM(item_type) <> ''
     ORDER BY CHAR_LENGTH(TRIM(item_type)) DESC`
  );

  if (!rows.length) return null;

  for (const row of rows) {
    const itemType = row?.item_type;
    if (!itemType) continue;
    if (text.includes(itemType)) return itemType;
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

function extractRoomAndBuildingFromRequestText(requestText) {
  const text = String(requestText || '').trim();
  if (!text) {
    return { roomName: null, buildingName: null };
  }

  const detailed = text.match(/in\s+Room\s+(.+?)(?:\s*\((.+?)\))?$/i);
  if (detailed) {
    return {
      roomName: String(detailed[1] || '').trim() || null,
      buildingName: String(detailed[2] || '').trim() || null,
    };
  }

  const basic = text.match(/in\s+Room\s+(.+)$/i);
  if (basic) {
    return {
      roomName: String(basic[1] || '').trim() || null,
      buildingName: null,
    };
  }

  return { roomName: null, buildingName: null };
}

async function resolveRequestCubicleTarget(conn, requestText) {
  const cubicleLabel = extractCubicleLabel(requestText);
  if (!cubicleLabel) {
    return { cubicleLabel: null, cubicleId: null, roomId: null };
  }

  const { roomName, buildingName } = extractRoomAndBuildingFromRequestText(requestText);

  const queryParts = [
    `SELECT c.id AS cubicle_id, c.room_id
     FROM mst_cubicles c
     LEFT JOIN mst_room r ON r.id = c.room_id
     LEFT JOIN mst_building b ON b.id = r.building_id
     WHERE LOWER(TRIM(c.label)) = LOWER(TRIM(?))`
  ];
  const params = [cubicleLabel];

  if (roomName) {
    queryParts.push('AND LOWER(TRIM(r.room_name)) = LOWER(TRIM(?))');
    params.push(roomName);
  }

  if (buildingName) {
    queryParts.push('AND LOWER(TRIM(b.building_name)) = LOWER(TRIM(?))');
    params.push(buildingName);
  }

  queryParts.push('ORDER BY c.id ASC LIMIT 1');

  const [resolvedRows] = await conn.query(queryParts.join('\n'), params);
  if (resolvedRows.length) {
    return {
      cubicleLabel,
      cubicleId: resolvedRows[0].cubicle_id || null,
      roomId: resolvedRows[0].room_id || null,
    };
  }

  const [fallbackRows] = await conn.query(
    `SELECT c.id AS cubicle_id, c.room_id
     FROM mst_cubicles c
     WHERE LOWER(TRIM(c.label)) = LOWER(TRIM(?))
     ORDER BY c.id ASC`,
    [cubicleLabel]
  );

  if (fallbackRows.length === 1) {
    return {
      cubicleLabel,
      cubicleId: fallbackRows[0].cubicle_id || null,
      roomId: fallbackRows[0].room_id || null,
    };
  }

  return { cubicleLabel, cubicleId: null, roomId: null };
}

function replaceRequestedItemTypeInText(requestText, itemType) {
  const value = String(requestText || '').trim();
  const type = String(itemType || '').trim();
  if (!type) return value;

  const marker = value.match(/\s+for\s+/i);
  if (marker && typeof marker.index === 'number') {
    return `${type}${value.substring(marker.index)}`;
  }
  return `${type} ${value}`.trim();
}

// not needed anymore: inventory columns removed; use mst_item for actual items

async function setFloorplanInventoryValue(conn, roomId, label, itemType, itemCode, transferredByUserId = null) {
  if (!roomId || !label || !itemType) return;

  // Find cubicle id for the label inside the target room
  const [cubRows] = await conn.query(
    "SELECT id FROM mst_cubicles WHERE room_id = ? AND LOWER(TRIM(label)) = LOWER(TRIM(?)) LIMIT 1",
    [roomId, label]
  );
  const cubicleId = cubRows?.[0]?.id || null;

  let resolvedBuildingId = null;
  if (roomId) {
    const [roomRows] = await conn.query("SELECT building_id FROM mst_room WHERE id = ? LIMIT 1", [roomId]);
    resolvedBuildingId = roomRows?.[0]?.building_id || null;
  }

  if (itemCode) {
    const [currentRows] = await conn.query(
      `SELECT id, building_id, room_id, cubicle_id FROM mst_item WHERE item_type = ? AND code = ? LIMIT 1`,
      [itemType, itemCode]
    );
    const currentItem = currentRows?.[0] || null;

    const fromBuildingId = currentItem?.building_id || null;
    const fromRoomId = currentItem?.room_id || null;
    const fromCubicleId = currentItem?.cubicle_id || null;

    if (currentItem && (fromBuildingId !== resolvedBuildingId || fromRoomId !== roomId || fromCubicleId !== cubicleId)) {
      try {
        await conn.query(
          `INSERT INTO trk_item
           (item_id, from_building_id, from_room_id, from_cubicle_id,
            to_building_id, to_room_id, to_cubicle_id, transferred_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            currentItem.id,
            fromBuildingId,
            fromRoomId,
            fromCubicleId,
            resolvedBuildingId,
            roomId,
            cubicleId,
            transferredByUserId
          ]
        );
      } catch (e) {
        console.warn('Failed to log item transfer during assignment for item', currentItem.id, e?.message || e);
      }

      // Assign the item to the target cubicle/room/building so location updates correctly
      try {
        const hasBuildingIdCol = await hasColumn(conn, 'mst_item', 'building_id');
        const hasRoomIdCol = await hasColumn(conn, 'mst_item', 'room_id');
        const hasCubicleIdCol = await hasColumn(conn, 'mst_item', 'cubicle_id');

        const setParts = [];
        const params = [];

        if (hasCubicleIdCol) {
          setParts.push('cubicle_id = ?');
          params.push(cubicleId);
        }
        if (hasRoomIdCol) {
          setParts.push('room_id = ?');
          params.push(roomId);
        }
        if (hasBuildingIdCol) {
          setParts.push('building_id = ?');
          params.push(resolvedBuildingId);
        }

        if (setParts.length) {
          setParts.push('last_update = CURRENT_TIMESTAMP');
          const updateSql = `UPDATE mst_item SET ${setParts.join(', ')} WHERE LOWER(TRIM(code)) = LOWER(TRIM(?)) AND LOWER(TRIM(item_type)) = LOWER(TRIM(?))`;
          params.push(itemCode, itemType);
          await conn.query(updateSql, params);
        }
      } catch (e) {
        console.warn('Failed to assign item location during assignment for item', currentItem.id, e?.message || e);
      }
    }
  }

  // Update location text on the item row (optional) by calling updateItemLocation
  if (itemCode) {
    await updateItemLocation(conn, 'mst_item', itemCode);
  }
}


async function reserveRequestedItem(conn, requestId, requestText) {
  const itemType = await resolveInventoryTableFromRequestText(conn, requestText);
  if (!itemType) return;

  const [reqRows] = await conn.query(
    "SELECT user_id FROM requests WHERE id = ?",
    [requestId]
  );

  const userId = reqRows?.[0]?.user_id || null;

  try {
    // find an available mst_item of this type that is not already reserved by another open request
    const [availableRows] = await conn.query(
      `SELECT i.id, i.code
       FROM mst_item i
       LEFT JOIN requests r
         ON r.inventory_item_id = i.id
        AND (
          r.status IN ('I','P')
          OR LOWER(TRIM(r.status)) IN ('inprogress','pending')
        )
       WHERE i.item_type = ?
         AND i.status = 1
         AND r.id IS NULL
       ORDER BY i.last_update ASC
       LIMIT 1`,
      [itemType]
    );

    if (!availableRows.length) return;

    const itemId = availableRows[0].id;
    const itemName = availableRows[0].code || null;

    await conn.query(
      `UPDATE mst_item SET last_update = CURRENT_TIMESTAMP WHERE id = ?`,
      [itemId]
    );

    await conn.query(
      `UPDATE requests SET inventory_table = ?, inventory_item_id = ?, inventory_item_name = ? WHERE id = ?`,
      ['mst_item', itemId, itemName, requestId]
    );

    const { cubicleLabel, cubicleId, roomId } = await resolveRequestCubicleTarget(conn, requestText);

    if (cubicleLabel && roomId) {

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
            `UPDATE mst_item SET cubicle_id = NULL, room_id = NULL, last_update = CURRENT_TIMESTAMP WHERE id = ?`,
            [prev[0].id]
          );
        }

        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, itemType, itemName, userId);
      }
    }
  } catch (err) {
    console.error(`Error reserving inventory for request ${requestId}:`, err);
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
    // keep rejected requests from leaving stale reservations on the floor plan
    await conn.query(`UPDATE mst_item SET status = 1, last_update = CURRENT_TIMESTAMP WHERE id = ?`, [itemId]);

    const { cubicleLabel, roomId } = await resolveRequestCubicleTarget(conn, requestText);
    const itemType = row.item_type;

    if (cubicleLabel && itemType && roomId) {
      if (roomId) {
        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, itemType, null);
      }
    }
  } catch (err) {
    console.error(`Error releasing reserved item for request ${requestId}:`, err);
  }
}

async function markRequestedItemUsed(conn, requestId, requestText, targetStatus = 2) {
  try {
    const [reqRows] = await conn.query(
      "SELECT user_id, inventory_table, inventory_item_id, inventory_item_name FROM requests WHERE id = ?",
      [requestId]
    );

    const userId = reqRows?.[0]?.user_id || null;
    let itemId = reqRows?.[0]?.inventory_item_id || null;
    let itemName = reqRows?.[0]?.inventory_item_name || null;
    let itemType = null;
    const requestTextValue = String(requestText || '').trim();
    const itemTypeFromText = await resolveInventoryTableFromRequestText(conn, requestTextValue);
    console.log(`[markRequestedItemUsed] requestId=${requestId} text='${requestTextValue}' itemId=${itemId} itemName=${itemName} itemTypeFromText=${itemTypeFromText} targetStatus=${targetStatus}`);

    if (!itemId && itemName) {
      const [itemRows] = await conn.query(
        `SELECT id, code, item_type FROM mst_item WHERE LOWER(TRIM(code)) = LOWER(TRIM(?)) LIMIT 1`,
        [itemName]
      );
      if (itemRows.length) {
        itemId = itemRows[0].id;
        itemName = itemRows[0].code || itemName;
        itemType = itemRows[0].item_type || null;
      }
    }

    if (!itemId && itemTypeFromText) {
      const [candidateRows] = await conn.query(
        `SELECT id, code, item_type FROM mst_item
         WHERE LOWER(TRIM(item_type)) = LOWER(TRIM(?)) AND status = 1
         ORDER BY last_update ASC
         LIMIT 1`,
        [itemTypeFromText]
      );

      console.log('[markRequestedItemUsed] candidateRows fetched, count=', candidateRows.length);
      if (candidateRows.length) {
        const candidate = candidateRows[0];
        const pickedId = candidate.id;
        const pickedCode = candidate.code || null;
        const pickedType = candidate.item_type || null;

        const [updateResult] = await conn.query(
          `UPDATE mst_item SET status = ?, last_update = CURRENT_TIMESTAMP WHERE id = ?`,
          [targetStatus, pickedId]
        );

        console.log('[markRequestedItemUsed] updateResult=', updateResult);

        if (updateResult?.affectedRows) {
          itemId = pickedId;
          itemName = pickedCode || itemName;
          itemType = pickedType || itemType;
        }
      }
    }

    if (!itemId && itemTypeFromText) {
      // Fallback: try any item of this type (ignoring current status)
      const [candidateRows2] = await conn.query(
        `SELECT id, code, item_type FROM mst_item
         WHERE LOWER(TRIM(item_type)) = LOWER(TRIM(?))
         ORDER BY last_update ASC
         LIMIT 1`,
        [itemTypeFromText]
      );

      console.log('[markRequestedItemUsed] fallback candidateRows2 count=', candidateRows2.length);
      if (candidateRows2.length) {
        const candidate2 = candidateRows2[0];
        const pickedId2 = candidate2.id;
        const pickedCode2 = candidate2.code || null;
        const pickedType2 = candidate2.item_type || null;

        const [updateResult2] = await conn.query(
          `UPDATE mst_item SET status = ?, last_update = CURRENT_TIMESTAMP WHERE id = ?`,
          [targetStatus, pickedId2]
        );
        console.log('[markRequestedItemUsed] fallback updateResult=', updateResult2);

        if (updateResult2?.affectedRows) {
          itemId = pickedId2;
          itemName = pickedCode2 || itemName;
          itemType = pickedType2 || itemType;
        }
      }
    }

    if (!itemId) {
      return;
    }

    await conn.query(
      `UPDATE mst_item SET status = ?, last_update = CURRENT_TIMESTAMP WHERE id = ?`,
      [targetStatus, itemId]
    );

    await conn.query(
      `UPDATE requests SET inventory_table = ?, inventory_item_id = ?, inventory_item_name = ? WHERE id = ?`,
      ['mst_item', itemId, itemName, requestId]
    );

    if (!itemName || !itemType) {
      const [itemRows] = await conn.query(`SELECT code, item_type FROM mst_item WHERE id = ?`, [itemId]);
      if (itemRows.length) {
        itemName = itemRows[0].code || itemName;
        itemType = itemRows[0].item_type || itemType;
      }
    }

    const { cubicleLabel, roomId } = await resolveRequestCubicleTarget(conn, requestTextValue);

    if (cubicleLabel && itemType && roomId) {
      if (roomId) {
        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, itemType, itemName, userId);
        await updateItemLocation(conn, 'mst_item', itemName);
      }
    }
  } catch (err) {
    console.error(`Error marking item used for request ${requestId}:`, err);
  }
}

async function setItemStatusByCode(conn, itemCode, statusValue) {
  const code = String(itemCode || '').trim();
  if (!code) return false;

  const [result] = await conn.query(
    `UPDATE mst_item
     SET status = ?, last_update = CURRENT_TIMESTAMP
     WHERE LOWER(TRIM(code)) = LOWER(TRIM(?))`,
    [statusValue, code]
  );

  return Number(result?.affectedRows || 0) > 0;
}

async function moveItemToStorageByCode(conn, itemCode) {
  const code = String(itemCode || '').trim();
  if (!code) return false;

  const storageBuildingId = await ensureStorageBuildingId(conn);
  if (!storageBuildingId) return false;

  const hasBuildingId = await hasColumn(conn, 'mst_item', 'building_id');
  const hasRoomId = await hasColumn(conn, 'mst_item', 'room_id');
  const hasCubicleId = await hasColumn(conn, 'mst_item', 'cubicle_id');
  const hasLocation = await hasColumn(conn, 'mst_item', 'location');

  const updateParts = ['last_update = CURRENT_TIMESTAMP'];
  const params = [];

  if (hasBuildingId) {
    updateParts.unshift('building_id = ?');
    params.push(storageBuildingId);
  }
  if (hasRoomId) {
    updateParts.push('room_id = NULL');
  }
  if (hasCubicleId) {
    updateParts.push('cubicle_id = NULL');
  }
  if (hasLocation) {
    updateParts.push(`location = 'storage'`);
  }

  const [result] = await conn.query(
    `UPDATE mst_item
     SET ${updateParts.join(', ')}
     WHERE LOWER(TRIM(code)) = LOWER(TRIM(?))`,
    [...params, code]
  );

  return Number(result?.affectedRows || 0) > 0;
}

async function applyCompletionAction(conn, requestId, requestText, completionAction, completionTargetItemCode = '') {
  const action = String(completionAction || 'add').trim().toLowerCase();
  const selectedTargetCode = String(completionTargetItemCode || '').trim();

  if (action === 'add') {
    await markRequestedItemUsed(conn, requestId, requestText, 2);
    return;
  }

  const [reqRows] = await conn.query(
    `SELECT user_id, inventory_item_name, previous_inventory_item_name
     FROM requests
     WHERE id = ?
     LIMIT 1`,
    [requestId]
  );

  const assignedItemCode = String(reqRows?.[0]?.inventory_item_name || '').trim();
  let previousUsedItemCode = String(reqRows?.[0]?.previous_inventory_item_name || '').trim();

  // Explicitly selected current-used item from UI takes priority when valid.
  if (selectedTargetCode && selectedTargetCode.toLowerCase() !== assignedItemCode.toLowerCase()) {
    const target = await resolveRequestCubicleTarget(conn, requestText);
    const requestedType = await resolveInventoryTableFromRequestText(conn, requestText);

    const targetWhere = [
      'LOWER(TRIM(code)) = LOWER(TRIM(?))',
      'status = 2'
    ];
    const targetParams = [selectedTargetCode];

    if (requestedType) {
      targetWhere.push('LOWER(TRIM(item_type)) = LOWER(TRIM(?))');
      targetParams.push(requestedType);
    }
    if (target?.cubicleId) {
      targetWhere.push('cubicle_id = ?');
      targetParams.push(target.cubicleId);
    }

    const [selectedRows] = await conn.query(
      `SELECT code FROM mst_item WHERE ${targetWhere.join(' AND ')} LIMIT 1`,
      targetParams
    );

    if (selectedRows.length) {
      previousUsedItemCode = String(selectedRows[0].code || '').trim();
    }
  }

  // Fallback: if previous item name is missing, resolve current used item from cubicle + type.
  if (!previousUsedItemCode || previousUsedItemCode.toLowerCase() === assignedItemCode.toLowerCase()) {
    const target = await resolveRequestCubicleTarget(conn, requestText);
    const requestedType = await resolveInventoryTableFromRequestText(conn, requestText);

    if (target?.cubicleId && requestedType) {
      const [currentUsedRows] = await conn.query(
        `SELECT code
         FROM mst_item
         WHERE cubicle_id = ?
           AND LOWER(TRIM(item_type)) = LOWER(TRIM(?))
           AND status = 2
           AND LOWER(TRIM(code)) <> LOWER(TRIM(?))
         ORDER BY last_update DESC
         LIMIT 1`,
        [target.cubicleId, requestedType, assignedItemCode || '']
      );

      if (currentUsedRows.length) {
        previousUsedItemCode = String(currentUsedRows[0].code || '').trim();
      }
    }
  }

  // change/defective should affect the previously used item, not the newly assigned one
  if (previousUsedItemCode && previousUsedItemCode.toLowerCase() !== assignedItemCode.toLowerCase()) {
    const previousStatus = action === 'defective' ? 0 : 1;
    await setItemStatusByCode(conn, previousUsedItemCode, previousStatus);

    // capture current item location before moving
    let prevItemRow = null;
    try {
      const [r] = await conn.query(
        `SELECT id, building_id, room_id, cubicle_id FROM mst_item WHERE LOWER(TRIM(code)) = LOWER(TRIM(?)) LIMIT 1`,
        [previousUsedItemCode]
      );
      prevItemRow = r?.[0] || null;
    } catch (fetchErr) {
      console.warn('[completionAction] Unable to fetch previous item location:', fetchErr?.message || fetchErr);
    }

    if (action === 'defective' || action === 'change') {
      try {
        await moveItemToStorageByCode(conn, previousUsedItemCode);

        // log transfer to trk_item so history shows storage move
        try {
          if (prevItemRow) {
            const storageBuildingId = await ensureStorageBuildingId(conn);
            await conn.query(
              `INSERT INTO trk_item
               (item_id, from_building_id, from_room_id, from_cubicle_id,
                to_building_id, to_room_id, to_cubicle_id, transferred_by_user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                prevItemRow.id,
                prevItemRow.building_id || null,
                prevItemRow.room_id || null,
                prevItemRow.cubicle_id || null,
                storageBuildingId || null,
                null,
                null,
                reqRows?.[0]?.user_id || null
              ]
            );
          }
        } catch (logErr) {
          console.warn('[completionAction] Failed to log trk_item for moved previous item', previousUsedItemCode, logErr?.message || logErr);
        }
      } catch (storageErr) {
        console.warn('[completionAction] Unable to move item to storage:', storageErr?.message || storageErr);
      }
    }

    await conn.query(
      `UPDATE requests
       SET previous_inventory_item_name = ?
       WHERE id = ?`,
      [previousUsedItemCode, requestId]
    );
  }

  // Only mark assigned item used when it is different from the currently used item being changed/defected.
  if (assignedItemCode && assignedItemCode.toLowerCase() !== previousUsedItemCode.toLowerCase()) {
    await markRequestedItemUsed(conn, requestId, requestText, 2);
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
  let resolvedBuildingId = null;

  if (item.cubicle_id) {
    const [cub] = await conn.query(
      `SELECT label, room_id FROM mst_cubicles WHERE id = ? LIMIT 1`,
      [item.cubicle_id]
    );
    if (cub.length) {
      const [rr] = await conn.query(
        `SELECT room_name, building_id FROM mst_room WHERE id = ? LIMIT 1`,
        [cub[0].room_id]
      );
      const roomName = rr?.[0]?.room_name || cub[0].room_id;
      location = `${cub[0].label} Room ${roomName}`;
      resolvedBuildingId = rr?.[0]?.building_id || null;
    }
  } else if (item.room_id) {
    const [roomRows] = await conn.query(`SELECT room_name, building_id FROM mst_room WHERE id = ? LIMIT 1`, [item.room_id]);
    const roomName = roomRows?.[0]?.room_name || item.room_id;
    location = `Room ${roomName}`;
    resolvedBuildingId = roomRows?.[0]?.building_id || null;
  }

  await conn.query(
    `UPDATE mst_item SET location = ?, building_id = COALESCE(?, building_id), last_update = CURRENT_TIMESTAMP WHERE LOWER(code) = LOWER(?)`,
    [location, resolvedBuildingId, itemName]
  );
}

/* =========================
   AUTH
========================= */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT id,username,role FROM mst_users WHERE username=? AND password=? LIMIT 1",
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
  const availableOnly = String(req.query?.availableOnly || '').trim() === '1';
  const rawRequestId = Number(req.query?.requestId);
  const requestId = Number.isFinite(rawRequestId) && rawRequestId > 0 ? rawRequestId : null;
  const conn = await pool.getConnection();

  try {
    // If client accidentally hits this route with 'summary', return the aggregated summary
    if (typeParam.toLowerCase() === 'summary') {
      const [sumRows] = await conn.query(
        `SELECT TRIM(i.item_type) AS name,
                COUNT(*) AS total,
                SUM(CASE WHEN i.status = 0 THEN 1 ELSE 0 END) AS defects,
                SUM(CASE WHEN i.status = 2 THEN 1 ELSE 0 END) AS used,
                SUM(CASE WHEN i.status = 1 AND open_req.inventory_item_id IS NULL THEN 1 ELSE 0 END) AS available
         FROM mst_item i
         LEFT JOIN (
           SELECT DISTINCT inventory_item_id
           FROM requests
           WHERE inventory_item_id IS NOT NULL
             AND (
               status IN ('I','P')
               OR LOWER(TRIM(status)) IN ('inprogress','pending')
             )
         ) open_req ON open_req.inventory_item_id = i.id
         GROUP BY TRIM(i.item_type)
         ORDER BY TRIM(item_type) ASC`
      );

      const [typeRows] = await conn.query(
        `SELECT DISTINCT TRIM(LOWER(item_type)) AS item_type
         FROM mst_item
         WHERE item_type IS NOT NULL AND TRIM(item_type) <> ''
         ORDER BY CHAR_LENGTH(TRIM(item_type)) DESC`
      );

      const itemTypes = (typeRows || []).map(r => String(r.item_type || '').toLowerCase()).filter(Boolean);

      const [pendingRows] = await conn.query(
        `SELECT request_text
         FROM requests
         WHERE status = 'P' OR LOWER(TRIM(status)) = 'pending'`
      );

      const pendingByType = {};
      for (const row of (pendingRows || [])) {
        const itemType = resolveInventoryTypeFromText(row?.request_text, itemTypes);
        if (!itemType) continue;
        pendingByType[itemType] = (pendingByType[itemType] || 0) + 1;
      }

      const summary = (sumRows || []).map(r => ({
        name: r.name || 'Unknown',
        total: Number(r.total || 0),
        defects: Number(r.defects || 0),
        used: Number(r.used || 0),
        available: Number(r.available || 0),
        pending: Number(pendingByType[String(r.name || '').toLowerCase()] || 0)
      }));

      return res.json({ success: true, summary });
    }

    // Normal per-type listing — compute a human-friendly location from cubicle/room/building
    console.log(`[inventory] requested type='${typeParam}'`);
    const primaryWhere = [
      `LOWER(TRIM(COALESCE(i.item_type,''))) = LOWER(TRIM(?))`
    ];
    const primaryParams = [];
    let primaryReservationJoin = '';
    if (availableOnly) {
      primaryWhere.push('i.status = 1');
      primaryWhere.push('open_req.id IS NULL');
      primaryReservationJoin = `
       LEFT JOIN requests open_req
         ON open_req.inventory_item_id = i.id
        AND (
          open_req.status IN ('I','P')
          OR LOWER(TRIM(open_req.status)) IN ('inprogress','pending')
        )
        AND (? IS NULL OR open_req.id <> ?)`;
      primaryParams.push(requestId, requestId);
    }
    primaryParams.push(typeParam);

    const [rows] = await conn.query(
      `SELECT i.id,
              i.item_type,
              i.code,
              i.item_details,
              i.status,
              COALESCE(bld_cub.building_name, bld_item.building_name) AS building_name,
              COALESCE(rm_cub.room_name, rm_item.room_name) AS room_name,
              c.label AS cubicle_label,
              CASE
                WHEN c.id IS NOT NULL AND COALESCE(rm_cub.room_name,'') <> '' THEN CONCAT(c.label, ' Room ', COALESCE(rm_cub.room_name,''))
                WHEN i.room_id IS NOT NULL AND COALESCE(rm_item.room_name,'') <> '' THEN CONCAT('Room ', COALESCE(rm_item.room_name,''))
                WHEN COALESCE(bld_cub.building_name, bld_item.building_name) IS NOT NULL THEN COALESCE(bld_cub.building_name, bld_item.building_name)
                ELSE ''
              END AS location,
              i.added,
              i.last_update,
              b.brand_name AS manufacturer
       FROM mst_item i
       LEFT JOIN mst_brand b ON b.id = i.brand_id
       LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
       LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
       LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
       LEFT JOIN mst_building bld_cub ON bld_cub.id = rm_cub.building_id
       LEFT JOIN mst_building bld_item ON bld_item.id = i.building_id
      ${primaryReservationJoin}
       WHERE ${primaryWhere.join(' AND ')}
       ORDER BY i.code ASC`,
      primaryParams
    );

    console.log(`[inventory] primary query returned ${rows.length} rows`);

    // Fallback: if primary query returned nothing, try a permissive LIKE match (handles variants)
    if (!rows.length) {
      const fallbackWhere = [
        `LOWER(COALESCE(i.item_type,'')) LIKE LOWER(CONCAT('%', ?, '%'))`
      ];
      const fallbackParams = [];
      let fallbackReservationJoin = '';
      if (availableOnly) {
        fallbackWhere.push('i.status = 1');
        fallbackWhere.push('open_req.id IS NULL');
        fallbackReservationJoin = `
         LEFT JOIN requests open_req
           ON open_req.inventory_item_id = i.id
          AND (
            open_req.status IN ('I','P')
            OR LOWER(TRIM(open_req.status)) IN ('inprogress','pending')
          )
          AND (? IS NULL OR open_req.id <> ?)`;
        fallbackParams.push(requestId, requestId);
      }
      fallbackParams.push(typeParam);

      const [fallbackRows] = await conn.query(
        `SELECT i.id,
                i.item_type,
                i.code,
                i.item_details,
                i.status,
                COALESCE(bld_cub.building_name, bld_item.building_name) AS building_name,
                COALESCE(rm_cub.room_name, rm_item.room_name) AS room_name,
                c.label AS cubicle_label,
                CASE
                  WHEN c.id IS NOT NULL AND COALESCE(rm_cub.room_name,'') <> '' THEN CONCAT(c.label, ' Room ', COALESCE(rm_cub.room_name,''))
                  WHEN i.room_id IS NOT NULL AND COALESCE(rm_item.room_name,'') <> '' THEN CONCAT('Room ', COALESCE(rm_item.room_name,''))
                  WHEN COALESCE(bld_cub.building_name, bld_item.building_name) IS NOT NULL THEN COALESCE(bld_cub.building_name, bld_item.building_name)
                  ELSE ''
                END AS location,
                i.last_update,
                b.brand_name AS manufacturer
         FROM mst_item i
         LEFT JOIN mst_brand b ON b.id = i.brand_id
         LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
         LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
         LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
         LEFT JOIN mst_building bld_cub ON bld_cub.id = rm_cub.building_id
         LEFT JOIN mst_building bld_item ON bld_item.id = i.building_id
         ${fallbackReservationJoin}
         WHERE ${fallbackWhere.join(' AND ')}
         ORDER BY i.code ASC`,
        fallbackParams
      );

      console.log(`[inventory] fallback LIKE query returned ${fallbackRows.length} rows`);
      if (fallbackRows.length) return res.json({ success: true, items: fallbackRows });
    }

    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('/api/inventory/:type error', e);
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

    } catch (e) {
      console.error('Update request item error:', e);
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

    // 🔥 UPDATE EXISTING CUBICLES INSTEAD OF DELETING ALL ROWS
    const [existingRows] = await conn.query(
      "SELECT id, label, item_type FROM mst_cubicles WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__')",
      [roomId]
    );

    const existingById = new Map();
    const existingByLabel = new Map();
    for (const row of existingRows) {
      const id = Number(row.id);
      existingById.set(id, row);
      const labelKey = String(row.label || '').trim().toLowerCase();
      if (labelKey) existingByLabel.set(labelKey, id);
    }

    // 🔥 FILTER OUT ROOM ITEMS
    const itemsToSave = floorItems.filter(
      (item) =>
        (item?.type || item?.itemType || "cubicle").toLowerCase() !== "room" &&
        item?.label !== "__ROOM__"
    );

    const insertItems = [];
    const updateItems = [];

    for (const item of itemsToSave) {
      const itemType = (item?.type || item?.itemType || "cubicle").toLowerCase();
      const itemId = Number(item?.id || 0);
      const labelKey = String(item?.label || '').trim().toLowerCase();

      if (itemId && existingById.has(itemId)) {
        updateItems.push({ ...item, itemType, id: itemId });
        existingById.delete(itemId);
        if (labelKey) existingByLabel.delete(labelKey);
      } else if (labelKey && existingByLabel.has(labelKey)) {
        // Match by label when id was not provided or doesn't match
        const existingId = existingByLabel.get(labelKey);
        if (existingId) {
          updateItems.push({ ...item, itemType, id: existingId });
          existingById.delete(existingId);
          existingByLabel.delete(labelKey);
        } else {
          insertItems.push({ ...item, itemType });
        }
      } else {
        insertItems.push({ ...item, itemType });
      }
    }

    const deleteIds = Array.from(existingById.keys());
    if (deleteIds.length) {
      await conn.query(
        `DELETE FROM mst_cubicles WHERE id IN (?)`,
        [deleteIds]
      );
    }

    for (const item of updateItems) {
      await conn.query(
        `UPDATE mst_cubicles
         SET label = ?, item_type = ?, x = ?, y = ?, w = ?, h = ?, created_order = ?, version = ?
         WHERE id = ?`,
        [
          item?.label || null,
          item.itemType,
          Number(item?.x ?? 0),
          Number(item?.y ?? 0),
          Number(item?.w ?? 60),
          Number(item?.h ?? 40),
          Number(item?.createdOrder ?? item?.created_order ?? 0),
          1,
          item.id,
        ]
      );
    }

    for (const item of insertItems) {
      await conn.query(
        `INSERT INTO mst_cubicles
        (user_id, label, item_type, room_id, x, y, w, h, created_order, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          item?.label || null,
          item.itemType,
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
    console.error("Save floorplan error:", e);
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
    console.error("List floorplans error:", e);
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
        "SELECT id, building_id FROM mst_room WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1",
        [roomIdParam]
      );
      if (!roomRecord.length) {
        return res.json({ success:true, inventory: [] });
      }
      roomId = roomRecord[0].id;
    }

    const [[roomInfo]] = await pool.query(
      "SELECT building_id FROM mst_room WHERE id = ? LIMIT 1",
      [roomId]
    );
    const roomBuildingId = roomInfo?.building_id || null;

    const [cubicles] = await pool.query(
      "SELECT id, label FROM mst_cubicles WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__') ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    const inventoryByLabel = {};
    const cubicleLabelsById = new Map();
    (cubicles || []).forEach((cub) => {
      const label = String(cub.label || '');
      inventoryByLabel[label] = {
        label,
        monitors: 0,
        headsets: 0,
        cameras: 0,
        mouse: 0,
        keyboards: 0,
        computers: 0,
        assignedUsers: ''
      };
      cubicleLabelsById.set(Number(cub.id), label);
    });

    const [rows] = await pool.query(
      `SELECT
         c.label,
         i.item_type,
         COUNT(*) AS count
       FROM mst_item i
       INNER JOIN mst_cubicles c ON c.id = i.cubicle_id
       WHERE c.room_id = ? AND i.cubicle_id IS NOT NULL
       GROUP BY c.label, i.item_type
       ORDER BY c.label ASC, i.item_type ASC`,
      [roomId]
    );

    if (Array.isArray(rows)) {
      rows.forEach((row) => {
        const label = String(row.label || '');
        if (!inventoryByLabel[label]) {
          inventoryByLabel[label] = {
            label,
            monitors: 0,
            headsets: 0,
            cameras: 0,
            mouse: 0,
            keyboards: 0,
            computers: 0,
            assignedUsers: '',
            itemNames: []
          };
        }
        const itemType = (row.item_type || '').toLowerCase();
        const count = Number(row.count || 0);

        if (itemType === 'monitor') inventoryByLabel[label].monitors = count;
        else if (itemType === 'headset') inventoryByLabel[label].headsets = count;
        else if (itemType === 'camera') inventoryByLabel[label].cameras = count;
        else if (itemType === 'mouse') inventoryByLabel[label].mouse = count;
        else if (itemType === 'keyboard') inventoryByLabel[label].keyboards = count;
        else if (itemType === 'computer') inventoryByLabel[label].computers = count;
      });
    }

    const [itemRows] = await pool.query(
      `SELECT c.label,
              i.item_type,
              i.code
       FROM mst_item i
       INNER JOIN mst_cubicles c ON c.id = i.cubicle_id
       WHERE c.room_id = ? AND i.cubicle_id IS NOT NULL
       ORDER BY c.label ASC, i.item_type ASC, i.code ASC`,
      [roomId]
    );

    if (Array.isArray(itemRows)) {
      itemRows.forEach((row) => {
        const label = String(row.label || '');
        const itemType = String(row.item_type || '').trim();
        const code = String(row.code || '').trim();
        const itemName = itemType && code ? `${itemType.charAt(0).toUpperCase()}${itemType.slice(1)}: ${code}` : '';
        if (!itemName) return;
        if (!inventoryByLabel[label]) {
          inventoryByLabel[label] = {
            label,
            monitors: 0,
            headsets: 0,
            cameras: 0,
            mouse: 0,
            keyboards: 0,
            computers: 0,
            assignedUsers: '',
            itemNames: []
          };
        }
        if (!Array.isArray(inventoryByLabel[label].itemNames)) {
          inventoryByLabel[label].itemNames = [];
        }
        inventoryByLabel[label].itemNames.push(itemName);
      });
    }

    const [users] = await pool.query(
      `SELECT username, cubicle_id, room_id, building_id
       FROM mst_users
       WHERE cubicle_id IS NOT NULL OR room_id = ? OR building_id = ?`,
      [roomId, roomBuildingId]
    );

    const assignedByLabel = new Map();
    if (Array.isArray(users)) {
      users.forEach((user) => {
        const username = String(user.username || '').trim();
        if (!username) return;

        if (user.cubicle_id != null) {
          const label = cubicleLabelsById.get(Number(user.cubicle_id));
          if (label !== undefined) {
            const set = assignedByLabel.get(label) || new Set();
            set.add(username);
            assignedByLabel.set(label, set);
          }
        } else if (Number(user.room_id) === roomId) {
          cubicles.forEach((cub) => {
            const label = String(cub.label || '');
            const set = assignedByLabel.get(label) || new Set();
            set.add(username);
            assignedByLabel.set(label, set);
          });
        } else if (roomBuildingId != null && Number(user.building_id) === Number(roomBuildingId)) {
          cubicles.forEach((cub) => {
            const label = String(cub.label || '');
            const set = assignedByLabel.get(label) || new Set();
            set.add(username);
            assignedByLabel.set(label, set);
          });
        }
      });
    }

    for (const [label, set] of assignedByLabel.entries()) {
      const value = Array.from(set).join(', ');
      if (!inventoryByLabel[label]) {
        inventoryByLabel[label] = {
          label,
          monitors: 0,
          headsets: 0,
          cameras: 0,
          mouse: 0,
          keyboards: 0,
          computers: 0,
          assignedUsers: value
        };
      } else {
        inventoryByLabel[label].assignedUsers = value;
      }
    }

    const inventory = Object.values(inventoryByLabel).map((row) => ({
      ...row,
      itemNames: Array.isArray(row.itemNames) ? Array.from(new Set(row.itemNames)) : []
    }));
    res.json({ success: true, inventory });
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
    const q =
      "SELECT id, user_id, building_name, created_at FROM mst_building ORDER BY (user_id = 'GLOBAL') ASC, building_name ASC";
    const [rows] = await pool.query(q);
    res.json({ success: true, buildings: rows });
  } catch (e) {
    console.error("/api/buildings GET error:", e);
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
    console.error("/api/buildings POST error:", e);
    res.status(500).json({ success: false, error: "Server error creating building" });
  } finally {
    conn.release();
  }
});

app.delete("/api/buildings/:buildingId", async (req, res) => {
  const buildingId = Number(req.params.buildingId);
  if (!Number.isFinite(buildingId) || buildingId <= 0) {
    return res.status(400).json({ success: false, error: "Invalid buildingId" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [itemCountRows] = await conn.query(
      "SELECT COUNT(*) AS count FROM mst_item WHERE building_id = ?",
      [buildingId]
    );
    const itemCount = Number(itemCountRows[0]?.count || 0);
    if (itemCount > 0) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: "Cannot delete building while inventory items are assigned to it. Move or reassign inventory first.",
      });
    }

    const [roomRows] = await conn.query(
      "SELECT id FROM mst_room WHERE building_id = ?",
      [buildingId]
    );
    const roomIds = Array.isArray(roomRows) ? roomRows.map((row) => row.id) : [];

    if (roomIds.length) {
      await conn.query("DELETE FROM mst_cubicles WHERE room_id IN (?)", [roomIds]);
      await conn.query("DELETE FROM mst_room WHERE id IN (?)", [roomIds]);
    }

    const [result] = await conn.query(
      "DELETE FROM mst_building WHERE id = ?",
      [buildingId]
    );

    await conn.commit();
    res.json({ success: true, deleted: result.affectedRows });
  } catch (e) {
    await conn.rollback();
    console.error("/api/buildings DELETE error:", e);
    res.status(500).json({ success: false, error: "Server error deleting building" });
  } finally {
    conn.release();
  }
});

app.delete("/api/buildings/:buildingId/rooms/:roomId", async (req, res) => {
  const buildingId = Number(req.params.buildingId);
  const roomId = Number(req.params.roomId);
  if (!Number.isFinite(buildingId) || buildingId <= 0) {
    return res.status(400).json({ success: false, error: "Invalid buildingId" });
  }
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ success: false, error: "Invalid roomId" });
  }

  const conn = await pool.getConnection();
  try {
    const [roomRows] = await conn.query(
      "SELECT id FROM mst_room WHERE id = ? AND building_id = ? LIMIT 1",
      [roomId, buildingId]
    );
    if (!roomRows.length) {
      return res.status(404).json({ success: false, error: "Room not found for this building" });
    }

    const [result] = await conn.query(
      "DELETE FROM mst_room WHERE id = ?",
      [roomId]
    );

    return res.json({ success: true, deleted: result.affectedRows });
  } catch (e) {
    console.error("/api/buildings/:buildingId/rooms/:roomId DELETE error:", e);
    res.status(500).json({ success: false, error: "Server error deleting room" });
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
    console.error("/api/buildings/:buildingId/rooms GET error:", e);
    return res.status(500).json({ success: false, error: "Server error listing rooms" });
  }
});

app.get('/api/rooms/:roomId/cubicles', async (req, res) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isFinite(roomId) || roomId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid roomId' });
  }

  try {
    const [cubicleRows] = await pool.query(
      "SELECT id, label FROM mst_cubicles WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__') ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    const cubicleLabelsById = new Map();
    const assignedByLabel = new Map();
    (cubicleRows || []).forEach((cub) => {
      const label = String(cub.label || '');
      cubicleLabelsById.set(Number(cub.id), label);
      assignedByLabel.set(label, new Set());
    });

    const [[roomInfo]] = await pool.query(
      'SELECT building_id FROM mst_room WHERE id = ? LIMIT 1',
      [roomId]
    );
    const roomBuildingId = roomInfo?.building_id || null;

    const [userRows] = await pool.query(
      `SELECT username, cubicle_id, room_id, building_id
       FROM mst_users
       WHERE cubicle_id IS NOT NULL OR room_id = ? OR building_id = ?`,
      [roomId, roomBuildingId]
    );

    if (Array.isArray(userRows)) {
      userRows.forEach((user) => {
        const username = String(user.username || '').trim();
        if (!username) return;

        if (user.cubicle_id != null) {
          const label = cubicleLabelsById.get(Number(user.cubicle_id));
          if (label !== undefined) {
            assignedByLabel.get(label)?.add(username);
          }
        } else if (Number(user.room_id) === roomId || (roomBuildingId != null && Number(user.building_id) === Number(roomBuildingId))) {
          cubicleLabelsById.forEach((label) => {
            assignedByLabel.get(label)?.add(username);
          });
        }
      });
    }

    const cubicles = (cubicleRows || []).map((row) => {
      const label = String(row.label || '');
      const assignedUsers = Array.from(assignedByLabel.get(label) || []).join(', ');
      return {
        id: row.id,
        label,
        assignedUser: assignedUsers || null,
      };
    });

    res.json({ success: true, cubicles });
  } catch (e) {
    console.error('/api/rooms/:roomId/cubicles GET error:', e);
    res.status(500).json({ success: false, error: 'Server error listing cubicles' });
  }
});

// Transfer items between cubicles in the same room
app.post('/api/transfer-items', async (req, res) => {
  const { roomId: roomIdParam, fromLabel, toCubicleId, transferTargetBuildingId, itemTypes, itemCodes, transferAssignedUser, transferOnlyUser, transferredByUserId } = req.body || {};
  console.log('/api/transfer-items payload:', { roomIdParam, fromLabel, toCubicleId, transferTargetBuildingId, itemTypes, itemCodes, transferAssignedUser, transferredByUserId });
  const moveAssignedUser = Boolean(transferAssignedUser);
  const transferByUserId = Number.isFinite(Number(transferredByUserId)) ? Number(transferredByUserId) : null;
  const selectedItemCodes = Array.isArray(itemCodes)
    ? itemCodes.map((c) => String(c || '').trim()).filter((c) => c !== '')
    : [];

  if (!roomIdParam) return res.status(400).json({ success: false, error: 'roomId required' });
  if (!fromLabel) return res.status(400).json({ success: false, error: 'fromLabel required' });
  if (!toCubicleId && !transferTargetBuildingId) return res.status(400).json({ success: false, error: 'toCubicleId or transferTargetBuildingId required' });

  const conn = await pool.getConnection();
  try {
    let roomId = null;
    const roomIdRaw = String(roomIdParam || '').trim();
    if (/^\d+$/.test(roomIdRaw)) {
      roomId = Number(roomIdRaw);
    } else {
      const [roomRows] = await conn.query(
        'SELECT id FROM mst_room WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1',
        [roomIdRaw]
      );
      if (!roomRows.length) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Room not found' });
      }
      roomId = Number(roomRows[0].id);
    }

    await conn.beginTransaction();

    // resolve source cubicle id and assigned user from users table
    const [fromRows] = await conn.query(
      'SELECT id FROM mst_cubicles WHERE room_id = ? AND LOWER(TRIM(label)) = LOWER(TRIM(?)) LIMIT 1',
      [roomId, String(fromLabel || '').trim()]
    );
    if (!fromRows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Source cubicle not found' });
    }
    const fromCubicleId = Number(fromRows[0].id);

    const [sourceUserRows] = await conn.query(
      'SELECT id, building_id, room_id, cubicle_id FROM mst_users WHERE cubicle_id = ? LIMIT 1',
      [fromCubicleId]
    );
    const sourceAssignedUser = sourceUserRows.length ? sourceUserRows[0].id : null;
    const sourceAssignedUserLocation = sourceUserRows.length ? sourceUserRows[0] : null;

    // validate target cubicle exists and resolve its room/building when provided
    let targetRoomId = null;
    let targetBuildingId = null;
    let targetCubicleId = toCubicleId;
    if (targetCubicleId) {
      const [toRows] = await conn.query('SELECT id, room_id FROM mst_cubicles WHERE id = ? LIMIT 1', [targetCubicleId]);
      if (!toRows.length) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Target cubicle not found' });
      }
      targetRoomId = Number(toRows[0].room_id);

      const [roomRows] = await conn.query('SELECT building_id FROM mst_room WHERE id = ? LIMIT 1', [targetRoomId]);
      targetBuildingId = roomRows.length ? roomRows[0].building_id || null : null;
    } else if (transferTargetBuildingId) {
      // when transferring to a building directly (eg. storage), resolve building id
      targetBuildingId = Number(transferTargetBuildingId);
      targetRoomId = null;
      targetCubicleId = null;
    }

    // If moving assigned user to a specific cubicle, ensure target cubicle is not already occupied
    if (moveAssignedUser && targetCubicleId) {
      const [tcu] = await conn.query('SELECT user_id FROM mst_cubicles WHERE id = ? LIMIT 1', [targetCubicleId]);
      if (tcu.length && tcu[0].user_id) {
        await conn.rollback();
        return res.status(409).json({ success: false, code: 'CUBICLE_OCCUPIED', error: 'Target cubicle already has an assigned user' });
      }
    }

    if (transferOnlyUser) {
      if (!moveAssignedUser) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'User-only transfer requires assigned user transfer' });
      }
      if (selectedItemCodes.length || (Array.isArray(itemTypes) && itemTypes.length)) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'User-only transfer cannot include item selection' });
      }
    }

    // find item codes that will be moved (unless this is a user-only transfer)
    let toMoveRows = [];
    if (!transferOnlyUser) {
      let selectSql = 'SELECT id, code, building_id, room_id, cubicle_id FROM mst_item WHERE room_id = ? AND cubicle_id = ?';
      const params = [roomId, fromCubicleId];
      if (selectedItemCodes.length) {
        const placeholders = selectedItemCodes.map(() => '?').join(',');
        selectSql += ` AND LOWER(code) IN (${placeholders})`;
        params.push(...selectedItemCodes.map((c) => c.toLowerCase()));
      } else if (Array.isArray(itemTypes) && itemTypes.length) {
        const placeholders = itemTypes.map(() => '?').join(',');
        selectSql += ` AND LOWER(item_type) IN (${placeholders})`;
        params.push(...itemTypes.map((t) => String(t).toLowerCase()));
      }
      const [rows] = await conn.query(selectSql, params);
      toMoveRows = rows;
    }

    // Log item transfers to history before updating
    for (const item of toMoveRows) {
      try {
        await conn.query(
          `INSERT INTO trk_item 
           (item_id, from_building_id, from_room_id, from_cubicle_id, 
            to_building_id, to_room_id, to_cubicle_id, transferred_by_user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.building_id || null,
            item.room_id || null,
            item.cubicle_id || null,
            targetBuildingId,
            targetRoomId || null,
            targetCubicleId || null,
            transferByUserId
          ]
        );
      } catch (e) {
        console.warn('Failed to log item transfer for item', item.id, e?.message || e);
      }
    }

    // Log user transfer to history if moving assigned user
    if (moveAssignedUser && sourceAssignedUserLocation) {
      try {
        await conn.query(
          `INSERT INTO trk_user 
           (user_id, from_building_id, from_room_id, from_cubicle_id, 
            to_building_id, to_room_id, to_cubicle_id, transferred_by_user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sourceAssignedUserLocation.id,
            sourceAssignedUserLocation.building_id || null,
            sourceAssignedUserLocation.room_id || null,
            sourceAssignedUserLocation.cubicle_id || null,
            targetBuildingId,
            targetRoomId || null,
            targetCubicleId || null,
            transferByUserId
          ]
        );
      } catch (e) {
        console.warn('Failed to log user transfer for user', sourceAssignedUserLocation.id, e?.message || e);
      }
    }

    // perform update to reassign items
    let updateSql = '';
    const updateParams = [];

    // Special-case: moving to a building directly (storage). Set room/cubicle to NULL and set building_id
    const storageMove = !targetCubicleId && targetBuildingId != null;
    // Do not allow moving an assigned user to storage
    if (moveAssignedUser && storageMove) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Cannot transfer assigned user to storage' });
    }
    if (storageMove) {
      const hasLocation = await hasColumn(conn, 'mst_item', 'location');
      const setParts = [];
      const paramsForSet = [];

      // set building id
      setParts.push('building_id = ?');
      paramsForSet.push(targetBuildingId);

      // clear room and cubicle
      setParts.push('room_id = NULL');
      setParts.push('cubicle_id = NULL');

      if (hasLocation) {
        setParts.push("location = 'storage'");
      }

      // set status to available (1)
      setParts.push('status = ?');
      paramsForSet.push(1);

      // last update timestamp
      setParts.push('last_update = CURRENT_TIMESTAMP');

      updateSql = `UPDATE mst_item SET ${setParts.join(', ')} WHERE room_id = ? AND cubicle_id = ?`;
      updateParams.push(...paramsForSet, roomId, fromCubicleId);
    } else {
      updateSql = 'UPDATE mst_item SET cubicle_id = ?, room_id = ?, building_id = ? WHERE room_id = ? AND cubicle_id = ?';
      updateParams.push(targetCubicleId, targetRoomId, targetBuildingId, roomId, fromCubicleId);
    }
    if (selectedItemCodes.length) {
      const placeholders = selectedItemCodes.map(() => '?').join(',');
      updateSql += ` AND LOWER(code) IN (${placeholders})`;
      updateParams.push(...selectedItemCodes.map((c) => c.toLowerCase()));
    } else if (Array.isArray(itemTypes) && itemTypes.length) {
      const placeholders = itemTypes.map(() => '?').join(',');
      updateSql += ` AND LOWER(item_type) IN (${placeholders})`;
      updateParams.push(...itemTypes.map((t) => String(t).toLowerCase()));
    }

    // perform item update only when not user-only transfer
    if (!transferOnlyUser) {
      await conn.query(updateSql, updateParams);
    }

    if (moveAssignedUser) {
      if (storageMove) {
        // clear cubicle assignment and move user to building-level storage
        await conn.query(
          'UPDATE mst_users SET cubicle_id = NULL, room_id = NULL, building_id = ? WHERE cubicle_id = ?',
          [targetBuildingId, fromCubicleId]
        );
        if (sourceAssignedUser) {
          await conn.query('UPDATE mst_cubicles SET user_id = NULL WHERE id = ?', [fromCubicleId]);
        }
      } else {
        await conn.query(
          'UPDATE mst_users SET cubicle_id = ?, room_id = ?, building_id = ? WHERE cubicle_id = ?',
          [targetCubicleId, targetRoomId, targetBuildingId, fromCubicleId]
        );
        if (sourceAssignedUser) {
          await conn.query('UPDATE mst_cubicles SET user_id = ? WHERE id = ?', [sourceAssignedUser, targetCubicleId]);
          await conn.query('UPDATE mst_cubicles SET user_id = NULL WHERE id = ?', [fromCubicleId]);
        }
      }
    }

    // update location text for moved items (skip for storageMove since we already set location)
    if (Array.isArray(toMoveRows) && toMoveRows.length) {
      for (const r of toMoveRows) {
        try {
          if (!storageMove) {
            await updateItemLocation(conn, 'mst_item', r.code);
          }
        } catch (e) {
          console.warn('Failed updating item location for', r.code, e);
        }
      }
    }

    await conn.commit();
    return res.json({ success: true, moved: Array.isArray(toMoveRows) ? toMoveRows.length : 0 });
  } catch (e) {
    await conn.rollback();
    console.error('/api/transfer-items error', e);
    // Return error message for debugging (can be removed later)
    const msg = e && e.message ? String(e.message) : 'Server error transferring items';
    return res.status(500).json({ success: false, error: msg });
  } finally {
    conn.release();
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
    console.error("/api/buildings/:buildingId/rooms POST error:", e);
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
    console.error("Brands fetch error:", e);
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

    console.error("Brand create error:", e);
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
    console.error("Brand update error:", e);
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
    console.error("Brand delete error:", e);
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

app.get('/api/items/:id/history', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid item id' });
  }

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT t.id,
              t.from_building_id,
              t.from_room_id,
              t.from_cubicle_id,
              t.to_building_id,
              t.to_room_id,
              t.to_cubicle_id,
              t.transferred_at,
              t.transferred_by_user_id,
              u.username AS transferred_by_username,
              bfrom.building_name AS from_building_name,
              rfrom.room_name AS from_room_name,
              cfrom.label AS from_cubicle_label,
              bto.building_name AS to_building_name,
              rto.room_name AS to_room_name,
              cto.label AS to_cubicle_label
       FROM trk_item t
       LEFT JOIN mst_users u ON u.id = t.transferred_by_user_id
       LEFT JOIN mst_building bfrom ON bfrom.id = t.from_building_id
       LEFT JOIN mst_room rfrom ON rfrom.id = t.from_room_id
       LEFT JOIN mst_cubicles cfrom ON cfrom.id = t.from_cubicle_id
       LEFT JOIN mst_building bto ON bto.id = t.to_building_id
       LEFT JOIN mst_room rto ON rto.id = t.to_room_id
       LEFT JOIN mst_cubicles cto ON cto.id = t.to_cubicle_id
       WHERE t.item_id = ?
       ORDER BY t.transferred_at DESC`,
      [itemId]
    );
    res.json({ success: true, history: rows });
  } catch (e) {
    console.error('/api/items/:id/history error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.get('/api/items', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT i.id, i.item_type, i.code, i.item_details, i.status,
              COALESCE(bld_cub.building_name, bld_item.building_name) AS building_name,
              COALESCE(rm_cub.room_name, rm_item.room_name) AS room_name,
              c.label AS cubicle_label,
              CASE
                WHEN c.id IS NOT NULL AND COALESCE(rm_cub.room_name,'') <> '' THEN CONCAT(c.label, ' Room ', COALESCE(rm_cub.room_name,''))
                WHEN i.room_id IS NOT NULL AND COALESCE(rm_item.room_name,'') <> '' THEN CONCAT('Room ', COALESCE(rm_item.room_name,''))
                WHEN COALESCE(bld_cub.building_name, bld_item.building_name) IS NOT NULL THEN COALESCE(bld_cub.building_name, bld_item.building_name)
                ELSE ''
                    END AS location,
                    i.last_update, b.brand_name AS manufacturer
       FROM mst_item i
       LEFT JOIN mst_brand b ON b.id = i.brand_id
       LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
       LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
       LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
       LEFT JOIN mst_building bld_cub ON bld_cub.id = rm_cub.building_id
       LEFT JOIN mst_building bld_item ON bld_item.id = i.building_id
       ORDER BY i.code ASC`
    );
    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('/api/items error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.put('/api/items/:id/status', async (req, res) => {
  const itemId = Number(req.params.id);
  const rawStatus = String(req.body?.status ?? '').trim().toUpperCase();
  const buildingId = req.body?.building_id != null ? Number(req.body.building_id) : null;
  const roomId = req.body?.room_id != null ? Number(req.body.room_id) : null;
  const cubicleId = req.body?.cubicle_id != null ? Number(req.body.cubicle_id) : null;

  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid item id' });
  }

  const statusMap = {
    AVAILABLE: 1,
    USED: 2,
    DEFECT: 0,
    DEFECTS: 0,
    DEFECTIVE: 0,
    0: 0,
    1: 1,
    2: 2
  };
  const statusValue = statusMap[rawStatus] ?? (['0', '1', '2'].includes(rawStatus) ? Number(rawStatus) : null);
  if (statusValue === null || statusValue === undefined) {
    return res.status(400).json({ success: false, error: 'Unsupported status' });
  }

  if (statusValue === 2 && (!Number.isFinite(buildingId) || !Number.isFinite(roomId) || !Number.isFinite(cubicleId))) {
    return res.status(400).json({ success: false, error: 'Building, room, and cubicle are required when status is USED' });
  }

  const conn = await pool.getConnection();
  try {
    if (buildingId != null && !Number.isFinite(buildingId)) {
      return res.status(400).json({ success: false, error: 'Invalid building id' });
    }
    if (roomId != null && !Number.isFinite(roomId)) {
      return res.status(400).json({ success: false, error: 'Invalid room id' });
    }
    if (cubicleId != null && !Number.isFinite(cubicleId)) {
      return res.status(400).json({ success: false, error: 'Invalid cubicle id' });
    }

    if (buildingId != null) {
      const [buildingRows] = await conn.query('SELECT id FROM mst_building WHERE id = ? LIMIT 1', [buildingId]);
      if (!buildingRows.length) {
        return res.status(400).json({ success: false, error: 'Building not found' });
      }
    }

    if (roomId != null) {
      const [roomRows] = await conn.query('SELECT id, building_id FROM mst_room WHERE id = ? LIMIT 1', [roomId]);
      if (!roomRows.length) {
        return res.status(400).json({ success: false, error: 'Room not found' });
      }
      if (buildingId != null && roomRows[0].building_id !== buildingId) {
        return res.status(400).json({ success: false, error: 'Room does not belong to the selected building' });
      }
    }

    if (cubicleId != null) {
      const [cubicleRows] = await conn.query('SELECT id, room_id FROM mst_cubicles WHERE id = ? LIMIT 1', [cubicleId]);
      if (!cubicleRows.length) {
        return res.status(400).json({ success: false, error: 'Cubicle not found' });
      }
      if (roomId != null && cubicleRows[0].room_id !== roomId) {
        return res.status(400).json({ success: false, error: 'Cubicle does not belong to the selected room' });
      }
    }

    const updates = ['status = ?', 'last_update = CURRENT_TIMESTAMP'];
    const params = [statusValue];
    if (buildingId != null) {
      updates.push('building_id = ?');
      params.push(buildingId);
    }
    if (roomId != null) {
      updates.push('room_id = ?');
      params.push(roomId);
    }
    if (cubicleId != null) {
      updates.push('cubicle_id = ?');
      params.push(cubicleId);
    }

    const [result] = await conn.query(
      `UPDATE mst_item SET ${updates.join(', ')} WHERE id = ?`,
      [...params, itemId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }
    return res.json({ success: true, status: statusValue });
  } catch (e) {
    console.error('/api/items/:id/status error', e);
    return res.status(500).json({ success: false, error: 'Server error' });
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
    console.error('/api/items/types error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/items', async (req, res) => {
  const { item_type, code, item_details, brand_id, building_id, room_id, cubicle_id, status } = req.body || {};

  // Validate required fields
  if (!item_type || !String(item_type).trim()) {
    return res.status(400).json({ success: false, error: 'item_type is required' });
  }
  if (!code || !String(code).trim()) {
    return res.status(400).json({ success: false, error: 'code is required' });
  }
  if (status === undefined || status === null || String(status).trim() === '') {
    return res.status(400).json({ success: false, error: 'status is required' });
  }
  if (!building_id) {
    return res.status(400).json({ success: false, error: 'building_id is required' });
  }

  const conn = await pool.getConnection();
  try {
    const trimmedItemType = String(item_type).trim();
    const trimmedCode = String(code).trim();
    const trimmedDetails = item_details ? String(item_details).trim() : null;
    const statusNum = parseInt(String(status).trim(), 10);
    const finalBrandId = brand_id ? parseInt(brand_id, 10) : null;
    const finalBuildingId = parseInt(building_id, 10);
    const finalRoomId = room_id ? parseInt(room_id, 10) : null;
    const finalCubicleId = cubicle_id ? parseInt(cubicle_id, 10) : null;

    // Insert into mst_item
    const [result] = await conn.query(
      `INSERT INTO mst_item (item_type, code, item_details, brand_id, building_id, room_id, cubicle_id, status, added, last_update)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [trimmedItemType, trimmedCode, trimmedDetails, finalBrandId, finalBuildingId, finalRoomId, finalCubicleId, statusNum]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('POST /api/items error:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, error: 'Item with this type and code already exists' });
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ success: false, error: 'Invalid building_id, room_id, or cubicle_id reference' });
    }
    res.status(500).json({ success: false, error: 'Failed to create item' });
  } finally {
    conn.release();
  }
});

app.post('/api/items/import', async (req, res) => {
  // Importing master items is not supported by this endpoint in current build
  res.status(410).json({ success: false, error: 'Endpoint not supported' });
});

app.get('/api/users', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT
         u.*, 
         b.building_name AS building_name,
         r.room_name AS room_name,
         c.label AS cubicle_label
       FROM mst_users u
       LEFT JOIN mst_building b ON b.id = u.building_id
       LEFT JOIN mst_room r ON r.id = u.room_id
       LEFT JOIN mst_cubicles c ON c.id = u.cubicle_id
       ORDER BY u.id ASC`
    );
    res.json({ success: true, users: rows });
  } catch (e) {
    console.error('/api/users error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.get('/api/users/:id/history', async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid user id' });
  }

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT t.id,
              t.from_building_id,
              t.from_room_id,
              t.from_cubicle_id,
              t.to_building_id,
              t.to_room_id,
              t.to_cubicle_id,
              t.transferred_at,
              t.transferred_by_user_id,
              u.username AS transferred_by_username,
              bfrom.building_name AS from_building_name,
              rfrom.room_name AS from_room_name,
              cfrom.label AS from_cubicle_label,
              bto.building_name AS to_building_name,
              rto.room_name AS to_room_name,
              cto.label AS to_cubicle_label
       FROM trk_user t
       LEFT JOIN mst_users u ON u.id = t.transferred_by_user_id
       LEFT JOIN mst_building bfrom ON bfrom.id = t.from_building_id
       LEFT JOIN mst_room rfrom ON rfrom.id = t.from_room_id
       LEFT JOIN mst_cubicles cfrom ON cfrom.id = t.from_cubicle_id
       LEFT JOIN mst_building bto ON bto.id = t.to_building_id
       LEFT JOIN mst_room rto ON rto.id = t.to_room_id
       LEFT JOIN mst_cubicles cto ON cto.id = t.to_cubicle_id
       WHERE t.user_id = ?
       ORDER BY t.transferred_at DESC`,
      [userId]
    );
    res.json({ success: true, history: rows });
  } catch (e) {
    console.error('/api/users/:id/history error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, role } = req.body || {};
  const trimmedUsername = String(username || '').trim();
  const trimmedPassword = String(password || '').trim();
  const normalizedRole = String(role || '').trim().toUpperCase() || 'USER';

  if (!trimmedUsername || !trimmedPassword) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  const conn = await pool.getConnection();
  try {
    // Some older schemas do not have AUTO_INCREMENT on mst_users.id.
    // Compute a next id and insert explicitly when needed.
    let newUserId = null;
    try {
      // Use atomic INSERT ... SELECT to compute next id on the server side and avoid races
      const [insertResult] = await conn.query(
        `INSERT IGNORE INTO mst_users (id, username, password, role)
         SELECT IFNULL(MAX(id),0)+1, ?, ?, ? FROM mst_users`,
        [trimmedUsername, trimmedPassword, normalizedRole]
      );

      if (!insertResult || insertResult.affectedRows === 0) {
      console.debug('/api/users insertResult debug', { insertResult });
        // In case IGNORE skipped (duplicate), try to find existing id by username.
        const [idRows] = await conn.query('SELECT id FROM mst_users WHERE username = ? LIMIT 1', [trimmedUsername]);
        newUserId = idRows?.[0]?.id;
        if (!newUserId) {
          return res.status(400).json({ success: false, error: 'User already exists or could not be created.' });
        }
      } else {
        // Attempt to resolve the inserted row's id by username (INSERT ... SELECT may not return insertId)
        const [idRows] = await conn.query('SELECT id FROM mst_users WHERE username = ? LIMIT 1', [trimmedUsername]);
        newUserId = idRows?.[0]?.id;
      }
    } catch (e) {
      console.error('/api/users insert error', e?.message || e);
      return res.status(500).json({ success: false, error: 'Server error' });
    }

    if (newUserId === undefined || newUserId === null) {
      return res.status(500).json({ success: false, error: 'User created but could not be retrieved.' });
    }

    const [rows] = await conn.query('SELECT * FROM mst_users WHERE id = ? LIMIT 1', [newUserId]);
    res.json({ success: true, user: rows?.[0] || null });
  } catch (e) {
    console.error('/api/users error', e?.message || e, { body: req.body });
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/users/import', async (req, res) => {
  let rows = [];
  if (Array.isArray(req.body)) {
    rows = req.body;
  } else if (req.body && Array.isArray(req.body.csvData)) {
    rows = req.body.csvData;
  } else if (typeof req.body === 'string') {
    rows = parseCSVTextToObjects(req.body);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ success: true, imported: 0, skipped: 0 });
  }

  const conn = await pool.getConnection();
  try {
    const [columns] = await conn.query('SHOW COLUMNS FROM mst_users');
    const validColumns = columns.map((col) => col.Field);

    const normalizedRows = rows.map((row) => {
      const normalized = {};
      for (const header of Object.keys(row)) {
        const column = String(header || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');
        if (!column || !validColumns.includes(column)) continue;
        normalized[column] = row[header];
      }
      return normalized;
    }).filter((row) => Object.keys(row).length > 0);

    if (normalizedRows.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid mst_users columns found in CSV headers.' });
    }

    const insertColumns = Object.keys(normalizedRows[0]);
    if (insertColumns.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid columns to insert.' });
    }

    const columnSql = insertColumns.map((col) => `\`${col}\``).join(', ');
    const placeholders = normalizedRows
      .map((row) => `(${insertColumns.map(() => '?').join(', ')})`)
      .join(', ');
    const values = normalizedRows.flatMap((row) =>
      insertColumns.map((col) => row[col] ?? null)
    );

    await conn.query(
      `INSERT IGNORE INTO mst_users (${columnSql}) VALUES ${placeholders}`,
      values
    );

    res.json({ success: true, imported: normalizedRows.length, skipped: 0 });
  } catch (e) {
    console.error('/api/users/import error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/users/:id/assign-location', async (req, res) => {
  const userId = Number(req.params.id);
  const { building_id, room_id, cubicle_id, cubicle_label } = req.body || {};
  const forceReassign = req.body?.force_reassign === true || req.body?.forceReassign === true;

  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid user ID' });
  }

  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query('SELECT id FROM mst_users WHERE id = ? LIMIT 1', [userId]);
    if (!existing.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    await conn.beginTransaction();

    let resolvedBuildingId = Number.isFinite(Number(building_id)) ? Number(building_id) : null;
    let resolvedRoomId = Number.isFinite(Number(room_id)) ? Number(room_id) : null;
    let resolvedCubicleId = Number.isFinite(Number(cubicle_id)) ? Number(cubicle_id) : null;

    if (cubicle_label && !resolvedRoomId) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'room_id is required when assigning a cubicle label' });
    }

    if (cubicle_label && resolvedRoomId) {
      const [cubRows] = await conn.query(
        'SELECT id FROM mst_cubicles WHERE room_id = ? AND LOWER(TRIM(label)) = LOWER(TRIM(?)) LIMIT 1',
        [resolvedRoomId, String(cubicle_label || '').trim()]
      );
      if (!cubRows.length) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: 'Cubicle not found for given room and label' });
      }
      resolvedCubicleId = cubRows[0].id;
    }

    if (resolvedCubicleId && !resolvedRoomId) {
      const [cubRows] = await conn.query('SELECT room_id FROM mst_cubicles WHERE id = ? LIMIT 1', [resolvedCubicleId]);
      if (cubRows.length) {
        resolvedRoomId = cubRows[0].room_id;
      }
    }

    if (resolvedRoomId && !resolvedBuildingId) {
      const [roomRows] = await conn.query('SELECT building_id FROM mst_room WHERE id = ? LIMIT 1', [resolvedRoomId]);
      if (roomRows.length) {
        resolvedBuildingId = roomRows[0].building_id || null;
      }
    }

    if (resolvedCubicleId) {
      const [occupiedRows] = await conn.query(
        'SELECT id, username FROM mst_users WHERE cubicle_id = ? AND id != ? LIMIT 1',
        [resolvedCubicleId, userId]
      );

      if (occupiedRows.length) {
        const occupyingUser = occupiedRows[0];

        if (!forceReassign) {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            error: 'Cubicle is already assigned to another user',
            code: 'CUBICLE_OCCUPIED',
            conflictUser: {
              id: Number(occupyingUser.id),
              username: String(occupyingUser.username || '')
            }
          });
        }

        await conn.query(
          'UPDATE mst_users SET building_id = NULL, room_id = NULL, cubicle_id = NULL WHERE id = ?',
          [occupyingUser.id]
        );
      }
    }

    await conn.query(
      'UPDATE mst_users SET building_id = ?, room_id = ?, cubicle_id = ? WHERE id = ?',
      [resolvedBuildingId, resolvedRoomId, resolvedCubicleId, userId]
    );

    const [updatedRows] = await conn.query('SELECT * FROM mst_users WHERE id = ? LIMIT 1', [userId]);
    await conn.commit();
    res.json({ success: true, user: updatedRows[0] || null });
    } catch (e) {
      try {
        await conn.rollback();
      } catch {}
      console.error('/api/users/:id/assign-location error', e);
      res.status(500).json({ success: false, error: 'Server error' });
    } finally {
    conn.release();
  }
});

app.post('/api/inventory/:type/import', async (req, res) => {
  const typeParam = String(req.params.type || '').trim();
  if (!typeParam) {
    return res.status(400).json({ success: false, error: 'Missing inventory type in URL.' });
  }

  let rows = [];
  if (Array.isArray(req.body)) {
    rows = req.body;
  } else if (req.body && Array.isArray(req.body.csvData)) {
    rows = req.body.csvData;
  } else if (typeof req.body === 'string') {
    rows = parseCSVTextToObjects(req.body);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ success: true, imported: 0, skipped: 0 });
  }

  const conn = await pool.getConnection();
  try {
    const importedResult = await normalizeAndInsertInventoryRows(conn, rows, typeParam);
    res.json(importedResult);
  } catch (e) {
    console.error('/api/inventory/:type/import error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

app.post('/api/inventory/import', async (req, res) => {
  let rows = [];
  if (Array.isArray(req.body)) {
    rows = req.body;
  } else if (req.body && Array.isArray(req.body.csvData)) {
    rows = req.body.csvData;
  } else if (typeof req.body === 'string') {
    rows = parseCSVTextToObjects(req.body);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ success: true, imported: 0, skipped: 0 });
  }

  const conn = await pool.getConnection();
  try {
    const importedResult = await normalizeAndInsertInventoryRows(conn, rows, null);
    res.json(importedResult);
  } catch (e) {
    console.error('/api/inventory/import error', e);
    res.status(500).json({ success: false, error: 'Server error' });
  } finally {
    conn.release();
  }
});

function resolveInventoryTypeFromText(requestText, itemTypes) {
  const text = (requestText || '').toLowerCase();
  if (!text || !Array.isArray(itemTypes)) return null;

  for (const itemType of itemTypes) {
    if (!itemType) continue;
    if (text.includes(itemType)) return itemType;
  }

  return null;
}

// Inventory summary grouped by item_type
app.get('/api/inventory/summary', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT TRIM(i.item_type) AS name,
              COUNT(*) AS total,
              SUM(CASE WHEN i.status = 0 THEN 1 ELSE 0 END) AS defects,
              SUM(CASE WHEN i.status = 2 THEN 1 ELSE 0 END) AS used,
              SUM(CASE WHEN i.status = 1 AND open_req.inventory_item_id IS NULL THEN 1 ELSE 0 END) AS available
       FROM mst_item i
       LEFT JOIN (
         SELECT DISTINCT inventory_item_id
         FROM requests
         WHERE inventory_item_id IS NOT NULL
           AND (
             status IN ('I','P')
             OR LOWER(TRIM(status)) IN ('inprogress','pending')
           )
       ) open_req ON open_req.inventory_item_id = i.id
       GROUP BY i.item_type
       ORDER BY item_type ASC`
    );

    const [typeRows] = await conn.query(
      `SELECT DISTINCT TRIM(LOWER(item_type)) AS item_type
       FROM mst_item
       WHERE item_type IS NOT NULL AND TRIM(item_type) <> ''
       ORDER BY CHAR_LENGTH(TRIM(item_type)) DESC`
    );

    const itemTypes = (typeRows || []).map(r => String(r.item_type || '').toLowerCase()).filter(Boolean);

    const [pendingRows] = await conn.query(
      `SELECT request_text
       FROM requests
       WHERE status = 'P' OR LOWER(TRIM(status)) = 'pending'`
    );

    const pendingByType = {};
    for (const row of (pendingRows || [])) {
      const itemType = resolveInventoryTypeFromText(row?.request_text, itemTypes);
      if (!itemType) continue;
      pendingByType[itemType] = (pendingByType[itemType] || 0) + 1;
    }

    const summary = (rows || []).map(r => {
      const name = String(r.name || 'Unknown').trim();
      const key = name.toLowerCase();
      return {
        name,
        total: Number(r.total || 0),
        defects: Number(r.defects || 0),
        used: Number(r.used || 0),
        available: Number(r.available || 0),
        pending: Number(pendingByType[key] || 0)
      };
    });

    res.json({ success: true, summary });
  } catch (e) {
    console.error('/api/inventory/summary error', e);
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
  if (upper === 'P') return 'pending';

  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'new') return 'new';
  if (compact === 'inprogress') return 'inprogress';
  if (compact === 'completed') return 'completed';
  if (compact === 'rejected') return 'rejected';
  if (compact === 'pending') return 'pending';
  return 'new';
}

app.get('/api/it-requests', async (_req, res) => {
  const conn = await pool.getConnection();
  try {
    const hasRejectedReason = await hasColumn(conn, 'requests', 'rejected_reason');
    const rejectedReasonSelect = hasRejectedReason ? 'rejected_reason,' : '';

    const [rows] = await conn.query(
      `SELECT r.id,
              r.user_id,
              r.username,
              r.request_text,
              r.reason,
              ${hasRejectedReason ? 'r.rejected_reason,' : ''}
              r.status,
              r.created_at,
              r.updated_at,
              r.inprogress_at,
              r.completed_at,
              r.rejected_at,
              r.pending_at,
              r.rejected_from,
              r.inventory_table,
              r.inventory_item_id,
              r.inventory_item_name,
              r.previous_inventory_item_name,
              c.label AS assigned_cubicle_label,
              COALESCE(rm_cub.room_name, rm_item.room_name) AS assigned_room_name,
              COALESCE(bld_cub.building_name, bld_item.building_name) AS assigned_building_name
         FROM requests r
         LEFT JOIN mst_item i ON i.id = r.inventory_item_id
         LEFT JOIN mst_cubicles c ON c.id = i.cubicle_id
         LEFT JOIN mst_room rm_cub ON rm_cub.id = c.room_id
         LEFT JOIN mst_room rm_item ON rm_item.id = i.room_id
         LEFT JOIN mst_building bld_cub ON bld_cub.id = rm_cub.building_id
         LEFT JOIN mst_building bld_item ON bld_item.id = i.building_id
        ORDER BY r.created_at DESC, r.id DESC`
    );

    const requests = (rows || []).map((r) => ({
      id: r.id,
      user_id: r.user_id,
      username: r.username,
      request_text: r.request_text,
      reason: r.reason,
      rejected_reason: hasRejectedReason ? r.rejected_reason : null,
      status: statusCodeToLabel(r.status),
      created_at: r.created_at,
      updated_at: r.updated_at,
      inprogress_at: r.inprogress_at,
      completed_at: r.completed_at,
      rejected_at: r.rejected_at,
      pending_at: r.pending_at,
      rejected_from: r.rejected_from,
      inventory_table: r.inventory_table,
      inventory_item_id: r.inventory_item_id,
      inventory_item_name: r.inventory_item_name,
      previous_inventory_item_name: r.previous_inventory_item_name,
      assigned_cubicle_label: r.assigned_cubicle_label,
      assigned_room_name: r.assigned_room_name,
      assigned_building_name: r.assigned_building_name,
    }));

    res.json({ success: true, requests });
  } catch (e) {
    console.error('/api/it-requests GET error', e);
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
    console.error('/api/it-requests POST error', e);
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
  const rejectionReason = String(req.body?.rejectionReason || req.body?.rejected_reason || '').trim();
  const completionActionRaw = String(req.body?.completionAction || 'add').trim().toLowerCase();
  const completionAction = ['change', 'defective', 'add'].includes(completionActionRaw)
    ? completionActionRaw
    : 'add';
  const completionTargetItemCode = String(req.body?.completionTargetItemCode || '').trim();

  if (!normalizedStatus) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  if (normalizedStatus === 'R' && !rejectionReason) {
    return res.status(400).json({ success: false, error: 'Rejection reason is required' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const hasRejectedReason = await hasColumn(conn, 'requests', 'rejected_reason');

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
      if (hasRejectedReason) {
        updateFields.push('rejected_reason = ?');
        updateValues.push(rejectionReason);
      } else {
        // Backward-compatible fallback for older schemas.
        updateFields.push('reason = ?');
        updateValues.push(rejectionReason);
      }
    }

    if (normalizedStatus === 'P') {
      updateFields.push('pending_at = ?');
      updateValues.push(now);
    }

    const sql = `UPDATE requests SET ${updateFields.join(', ')} WHERE id = ?`;
    await conn.query(sql, [...updateValues, requestId]);

    const [reqRows] = await conn.query('SELECT request_text FROM requests WHERE id = ?', [requestId]);
    const requestText = reqRows?.[0]?.request_text || '';

    if (normalizedStatus === 'C') {
      await applyCompletionAction(conn, requestId, requestText, completionAction, completionTargetItemCode);
    }

    if (normalizedStatus === 'R') {
      await releaseReservedItem(conn, requestId, requestText);
    }

    await conn.commit();

    res.json({ success: true });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('Update status error:', e);
    res.status(500).json({ success: false, error: e.message || 'Database error' });
  } finally {
    conn.release();
  }
});

app.put('/api/it-requests/:id/item-type', async (req, res) => {
  const requestId = Number(req.params.id);
  const itemCode = String(req.body?.itemCode || '').trim();

  if (!requestId || !itemCode) {
    return res.status(400).json({ success: false, error: 'request id and itemCode are required' });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT status, request_text, inventory_item_id FROM requests WHERE id = ?',
      [requestId]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const currentStatus = normalizeRequestStatus(rows[0].status);
    const requestText = rows[0].request_text || '';
    const currentItemId = rows[0].inventory_item_id || null;
    const requestedType = await resolveInventoryTableFromRequestText(conn, requestText);

    const [itemRows] = await conn.query(
      `SELECT id, code, item_type, status
       FROM mst_item
       WHERE LOWER(TRIM(code)) = LOWER(TRIM(?))
       LIMIT 1`,
      [itemCode]
    );

    if (!itemRows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Selected item not found' });
    }

    const item = itemRows[0];
    const selectedItemId = item.id;
    const selectedItemCode = item.code;
    const selectedItemType = String(item.item_type || '').trim().toLowerCase();
    const selectedItemStatus = Number(item.status);

    if (selectedItemStatus !== 1) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'Selected item is not available' });
    }

    if (requestedType && selectedItemType !== String(requestedType).toLowerCase()) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: `Selected item must be of type ${requestedType}` });
    }

    const [reservedRows] = await conn.query(
      `SELECT id
       FROM requests
       WHERE id <> ?
         AND inventory_item_id = ?
         AND (
           status IN ('I', 'P')
           OR LOWER(TRIM(status)) IN ('inprogress', 'pending')
         )
       LIMIT 1`,
      [requestId, selectedItemId]
    );

    if (reservedRows.length) {
      await conn.rollback();
      return res.status(409).json({ success: false, error: 'Selected item is already assigned to another open request' });
    }

    if ((currentStatus === 'I' || currentStatus === 'P') && currentItemId && currentItemId !== selectedItemId) {
      await releaseReservedItem(conn, requestId, requestText);
    }

    await conn.query(
      `UPDATE requests
       SET inventory_table = 'mst_item',
           inventory_item_id = ?,
           inventory_item_name = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [selectedItemId, selectedItemCode, requestId]
    );

    await conn.commit();

    return res.json({
      success: true,
      requestId,
      itemId: selectedItemId,
      itemCode: selectedItemCode,
      itemType: selectedItemType
    });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    console.error('Update request item error:', e);
    return res.status(500).json({ success: false, error: e.message || 'Database error' });
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
    const HOST = process.env.HOST || '0.0.0.0';
    const advertisedHost = HOST === '0.0.0.0' ? '192.168.100.173' : HOST;

    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${advertisedHost}:${PORT}`);
    });
  } catch (e) {
    const dbHost = process.env.DB_HOST || '192.168.88.87';
    const dbPort = process.env.DB_PORT || '3306';
    const dbName = process.env.DB_NAME || 'tracker';
    const dbUser = process.env.DB_USER || 'ezware1';

    console.error(`Server startup failed. Database connection details:`);
    console.error(`   DB_HOST=${dbHost}`);
    console.error(`   DB_PORT=${dbPort}`);
    console.error(`   DB_NAME=${dbName}`);
    console.error(`   DB_USER=${dbUser}`);
    console.error(`
   Confirm the MySQL host is reachable and accepts remote connections from this machine.`);
    console.error(e);
    process.exit(1);
  }
})();