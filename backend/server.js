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

app.use((req, res, next) => {
  const deviceId = req.headers["x-device-id"];
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (deviceId) console.log(`📱 Device: ${deviceId}`);
  next();
});

const statusTableMap = {
  new: "`new`",
  inprogress: "`inprogress`",
  completed: "`completed`",
  rejected: "`rejected`",
};

const validStatuses = Object.keys(statusTableMap);
const ROOM_PLACEHOLDER_LABEL = "__ROOM__";

/* =========================
   INIT TABLES
========================= */
async function initializeTables() {
  const conn = await pool.getConnection();

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS statuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        status_name VARCHAR(50) UNIQUE NOT NULL,
        display_label VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        username VARCHAR(255) NOT NULL,
        request_text LONGTEXT NOT NULL,
        reason LONGTEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'new',
        inventory_table VARCHAR(100) NULL DEFAULT NULL,
        inventory_item_id INT NULL DEFAULT NULL,
        inventory_item_name VARCHAR(255) NULL DEFAULT NULL,
        previous_inventory_item_name VARCHAR(255) NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        inprogress_at DATETIME NULL DEFAULT NULL,
        completed_at DATETIME NULL DEFAULT NULL,
        rejected_at DATETIME NULL DEFAULT NULL,
        rejected_from ENUM('new','inprogress') NULL DEFAULT NULL,
        FOREIGN KEY (status) REFERENCES statuses(status_name)
      )
    `);

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

    const makeStatusTable = (name) => `
      CREATE TABLE IF NOT EXISTS \`${name}\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT UNIQUE,
        user_id INT,
        username VARCHAR(255),
        request_text LONGTEXT,
        reason LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await conn.query(makeStatusTable("new"));
    await conn.query(makeStatusTable("inprogress"));
    await conn.query(makeStatusTable("completed"));
    await conn.query(makeStatusTable("rejected"));

    const statuses = [
      ["new", "New"],
      ["inprogress", "In Progress"],
      ["completed", "Completed"],
      ["rejected", "Rejected"],
    ];

    for (const [statusName, label] of statuses) {
      await conn.query(
        "INSERT IGNORE INTO statuses (status_name, display_label) VALUES (?, ?)",
        [statusName, label]
      );
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS floorplans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100),
        label VARCHAR(100),
        item_type VARCHAR(50) DEFAULT 'cubicle',
        room_id VARCHAR(100),
        x INT,
        y INT,
        w INT,
        h INT,
        created_order INT DEFAULT 0,
        version INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room (user_id, room_id, label)
      )
    `);

    const [createdOrderCol] = await conn.query(
      "SHOW COLUMNS FROM floorplans LIKE 'created_order'"
    );
    if (!createdOrderCol.length) {
      await conn.query(
        "ALTER TABLE floorplans ADD COLUMN created_order INT DEFAULT 0 AFTER h"
      );
    }

    const [itemTypeCol] = await conn.query(
      "SHOW COLUMNS FROM floorplans LIKE 'item_type'"
    );
    if (!itemTypeCol.length) {
      await conn.query(
        "ALTER TABLE floorplans ADD COLUMN item_type VARCHAR(50) DEFAULT 'cubicle' AFTER label"
      );
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS computers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT NULL,
        manufacturer VARCHAR(255) DEFAULT NULL,
        serial_number VARCHAR(255) DEFAULT NULL,
        type VARCHAR(255) DEFAULT NULL,
        model VARCHAR(255) DEFAULT NULL,
        os VARCHAR(255) DEFAULT NULL,
        location VARCHAR(255) DEFAULT NULL,
        last_update DATETIME DEFAULT NULL,
        processor VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100),
        room_id VARCHAR(100),
        label VARCHAR(100),
        monitors VARCHAR(255) DEFAULT NULL,
        headsets VARCHAR(255) DEFAULT NULL,
        cameras VARCHAR(255) DEFAULT NULL,
        mouse VARCHAR(255) DEFAULT NULL,
        keyboards VARCHAR(255) DEFAULT NULL,
        computers VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room_label (user_id, room_id, label)
      )
    `);

    await conn.query(`ALTER TABLE inventory MODIFY monitors VARCHAR(255) NULL`);
    await conn.query(`ALTER TABLE inventory MODIFY headsets VARCHAR(255) NULL`);
    await conn.query(`ALTER TABLE inventory MODIFY cameras VARCHAR(255) NULL`);
    await conn.query(`ALTER TABLE inventory MODIFY mouse VARCHAR(255) NULL`);
    await conn.query(`ALTER TABLE inventory MODIFY keyboards VARCHAR(255) NULL`);
    await conn.query(`ALTER TABLE inventory MODIFY computers VARCHAR(255) NULL`);

    const createInventoryTable = async (tableName) => {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`${tableName}\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT NULL,
          manufacturer VARCHAR(255) DEFAULT NULL,
          location VARCHAR(255) DEFAULT NULL,
          model VARCHAR(255) DEFAULT NULL,
          last_update DATETIME DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    };

    const seedTable = async (table, rows) => {
      const [existing] = await conn.query(
        `SELECT COUNT(*) as count FROM \`${table}\``
      );
      if (existing[0].count === 0) {
        for (const row of rows) {
          const cols = Object.keys(row).join(", ");
          const vals = Object.values(row);
          const placeholders = vals.map(() => "?").join(", ");
          await conn.query(
            `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
            vals
          );
        }
      }
    };

    await createInventoryTable("monitors");
    await createInventoryTable("headsets");
    await createInventoryTable("mouse");
    await createInventoryTable("keyboards");
    await createInventoryTable("cameras");
    await createInventoryTable("computers");

    await seedTable("monitors", [
      {
        name: "MN001",
        status: "Available",
        manufacturer: "Dell",
        location: "HQ",
        model: "U2720Q",
        last_update: "2026-02-16 10:00:00",
      },
      {
        name: "MN002",
        status: "Available",
        manufacturer: "LG",
        location: "HQ",
        model: "27GL850",
        last_update: "2026-02-15 09:00:00",
      },
      {
        name: "MN003",
        status: "Available",
        manufacturer: "Samsung",
        location: "HQ",
        model: "Odyssey G7",
        last_update: "2026-02-14 08:00:00",
      },
    ]);

    await seedTable("headsets", [
      {
        name: "HS001",
        status: "Available",
        manufacturer: "Logitech",
        location: "HQ",
        model: "H390",
        last_update: "2026-02-15 10:30:00",
      },
      {
        name: "HS002",
        status: "Available",
        manufacturer: "Plantronics",
        location: "HQ",
        model: "Voyager 5200",
        last_update: "2026-02-14 14:20:00",
      },
      {
        name: "HS003",
        status: "Available",
        manufacturer: "CORSAIR",
        location: "HQ",
        model: "HS70",
        last_update: "2026-02-13 09:15:00",
      },
    ]);

    await seedTable("mouse", [
      {
        name: "MS001",
        status: "Available",
        manufacturer: "Logitech",
        location: "HQ",
        model: "M705",
        last_update: "2026-02-16 11:45:00",
      },
      {
        name: "MS002",
        status: "Available",
        manufacturer: "Razer",
        location: "HQ",
        model: "DeathAdder V3",
        last_update: "2026-02-15 13:20:00",
      },
      {
        name: "MS003",
        status: "Available",
        manufacturer: "Microsoft",
        location: "HQ",
        model: "Sculpt Comfort",
        last_update: "2026-02-14 15:00:00",
      },
    ]);

    await seedTable("keyboards", [
      {
        name: "KB001",
        status: "Available",
        manufacturer: "Logitech",
        location: "HQ",
        model: "K380",
        last_update: "2026-02-16 10:10:00",
      },
      {
        name: "KB002",
        status: "Available",
        manufacturer: "Corsair",
        location: "HQ",
        model: "K95 Platinum",
        last_update: "2026-02-15 12:30:00",
      },
      {
        name: "KB003",
        status: "Available",
        manufacturer: "Microsoft",
        location: "HQ",
        model: "Ergonomic Keyboard",
        last_update: "2026-02-14 14:45:00",
      },
    ]);

    await seedTable("cameras", [
      {
        name: "CAM001",
        status: "Available",
        manufacturer: "Logitech",
        location: "HQ",
        model: "C920",
        last_update: "2026-02-16 09:00:00",
      },
      {
        name: "CAM002",
        status: "Available",
        manufacturer: "Microsoft",
        location: "HQ",
        model: "LifeCam HD-3000",
        last_update: "2026-02-15 11:15:00",
      },
      {
        name: "CAM003",
        status: "Available",
        manufacturer: "Generic",
        location: "HQ",
        model: "USB",
        last_update: "2026-02-14 16:30:00",
      },
    ]);

    await seedTable("computers", [
      {
        name: "CPU001",
        status: "Available",
        manufacturer: "Intel",
        location: "HQ",
        model: "Core i9",
        last_update: "2026-02-16 12:00:00",
      },
      {
        name: "CPU002",
        status: "Available",
        manufacturer: "AMD",
        location: "HQ",
        model: "Ryzen 9",
        last_update: "2026-02-15 12:30:00",
      },
      {
        name: "CPU003",
        status: "Available",
        manufacturer: "Intel",
        location: "HQ",
        model: "Core i7",
        last_update: "2026-02-14 13:45:00",
      },
    ]);

    console.log("✅ Tables ready");
  } finally {
    conn.release();
  }
}

/* =========================
   HELPERS
========================= */
async function upsertFloorplanInventory(conn, userId, roomId, floorItems) {
  if (!Array.isArray(floorItems)) return;

  await conn.query("DELETE FROM inventory WHERE room_id = ?", [roomId]);

  for (const item of floorItems) {
    if (!item?.label || item.label === ROOM_PLACEHOLDER_LABEL) continue;
    if ((item.type || item.itemType || "cubicle") !== "cubicle") continue;

    await conn.query(
      `INSERT INTO inventory
       (user_id, room_id, label, monitors, headsets, cameras, mouse, keyboards, computers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, roomId, item.label, null, null, null, null, null, null]
    );
  }
}

async function syncStatusTablesForRequest(conn, requestId) {
  const [rows] = await conn.query("SELECT * FROM requests WHERE id = ?", [requestId]);
  if (!rows.length) return;

  const reqRow = rows[0];

  await conn.query("DELETE FROM `new` WHERE request_id = ?", [requestId]);
  await conn.query("DELETE FROM `inprogress` WHERE request_id = ?", [requestId]);
  await conn.query("DELETE FROM `completed` WHERE request_id = ?", [requestId]);
  await conn.query("DELETE FROM `rejected` WHERE request_id = ?", [requestId]);

  const targetTable = statusTableMap[reqRow.status];

  await conn.query(
    `
    INSERT INTO ${targetTable}
    (request_id,user_id,username,request_text,reason)
    VALUES (?,?,?,?,?)
    `,
    [
      reqRow.id,
      reqRow.user_id,
      reqRow.username,
      reqRow.request_text,
      reqRow.reason,
    ]
  );
}

function resolveInventoryTableFromRequestText(requestText) {
  const text = (requestText || "").toLowerCase();
  const mapping = {
    monitor: "monitors",
    headset: "headsets",
    webcam: "cameras",
    camera: "cameras",
    mouse: "mouse",
    keyboard: "keyboards",
    cpu: "computers",
    computer: "computers",
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

function inventoryColumnFromRequestType(table) {
  const columnMap = {
    monitors: "monitors",
    headsets: "headsets",
    cameras: "cameras",
    mouse: "mouse",
    keyboards: "keyboards",
    computers: "computers",
  };
  return columnMap[table] || null;
}

async function setFloorplanInventoryValue(conn, roomId, cubicleLabel, column, value) {
  if (!roomId || !cubicleLabel || !column || cubicleLabel === ROOM_PLACEHOLDER_LABEL) {
    return;
  }

  const [rows] = await conn.query(
    "SELECT id FROM inventory WHERE room_id = ? AND label = ? LIMIT 1",
    [roomId, cubicleLabel]
  );

  if (!rows.length) return;

  const rowId = rows[0].id;
  await conn.query(
    `UPDATE inventory SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [value, rowId]
  );
}

async function reserveRequestedItem(conn, requestId, requestText) {
  const targetTable = resolveInventoryTableFromRequestText(requestText);
  if (!targetTable) return;

  const [reqRows] = await conn.query(
    "SELECT user_id, inventory_table, inventory_item_id, inventory_item_name FROM requests WHERE id = ?",
    [requestId]
  );

  const userId = reqRows?.[0]?.user_id || null;

  try {
    const [availableRows] = await conn.query(
      `SELECT id FROM \`${targetTable}\` WHERE status = 'Available' ORDER BY updated_at ASC LIMIT 1`
    );

    if (!availableRows.length) return;

    const itemId = availableRows[0].id;

    await conn.query(
      `UPDATE \`${targetTable}\` SET status = 'InUse', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [itemId]
    );

    const [itemRows] = await conn.query(
      `SELECT name FROM \`${targetTable}\` WHERE id = ?`,
      [itemId]
    );
    const itemName = itemRows?.[0]?.name || null;

    await conn.query(
      `UPDATE requests SET inventory_table = ?, inventory_item_id = ?, inventory_item_name = ? WHERE id = ?`,
      [targetTable, itemId, itemName, requestId]
    );

    const cubicleLabel = extractCubicleLabel(requestText);
    const inventoryColumn = inventoryColumnFromRequestType(targetTable);

    if (cubicleLabel && inventoryColumn && userId) {
      const [roomRows] = await conn.query(
        "SELECT room_id FROM floorplans WHERE label = ? LIMIT 1",
        [cubicleLabel]
      );
      const roomId = roomRows?.[0]?.room_id || null;

      if (roomId) {
        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, inventoryColumn, itemName);
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
    const targetTable = reqRows?.[0]?.inventory_table;
    const itemId = reqRows?.[0]?.inventory_item_id;

    if (!targetTable || !itemId) return;

    const [existing] = await conn.query(
      `SELECT status FROM \`${targetTable}\` WHERE id = ?`,
      [itemId]
    );

    if (existing.length && existing[0].status === "InUse") {
      await conn.query(
        `UPDATE \`${targetTable}\` SET status = 'Available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [itemId]
      );

      const cubicleLabel = extractCubicleLabel(requestText);
      const inventoryColumn = inventoryColumnFromRequestType(targetTable);

      if (cubicleLabel && inventoryColumn && userId) {
        const [roomRows] = await conn.query(
          "SELECT room_id FROM floorplans WHERE label = ? LIMIT 1",
          [cubicleLabel]
        );
        const roomId = roomRows?.[0]?.room_id || null;

        if (roomId) {
          await setFloorplanInventoryValue(conn, roomId, cubicleLabel, inventoryColumn, null);
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
    const targetTable =
      reqRows?.[0]?.inventory_table || resolveInventoryTableFromRequestText(requestText);
    const itemId = reqRows?.[0]?.inventory_item_id || null;

    if (!targetTable || !itemId) return;

    await conn.query(
      `UPDATE \`${targetTable}\` SET status = 'Used', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [itemId]
    );

    const [itemRows] = await conn.query(
      `SELECT name FROM \`${targetTable}\` WHERE id = ?`,
      [itemId]
    );
    const itemName = itemRows?.[0]?.name || null;

    const cubicleLabel = extractCubicleLabel(requestText);
    const inventoryColumn = inventoryColumnFromRequestType(targetTable);

    if (cubicleLabel && inventoryColumn && userId) {
      const [roomRows] = await conn.query(
        "SELECT room_id FROM floorplans WHERE label = ? LIMIT 1",
        [cubicleLabel]
      );
      const roomId = roomRows?.[0]?.room_id || null;

      if (roomId) {
        await setFloorplanInventoryValue(conn, roomId, cubicleLabel, inventoryColumn, itemName);
      }
    }
  } catch (err) {
    console.error(`❌ Error marking item used for request ${requestId}:`, err);
  }
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
app.post("/api/it-requests", async (req, res) => {
  const { userId, username, requestText, reason } = req.body;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      "INSERT INTO requests (user_id,username,request_text,reason,status) VALUES (?,?,?,?, 'new')",
      [userId, username, requestText, reason]
    );

    await syncStatusTablesForRequest(conn, result.insertId);
    await conn.commit();

    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

app.get("/api/it-requests", async (_req, res) => {
  const [rows] = await pool.query("SELECT * FROM requests ORDER BY created_at DESC");
  res.json({ success: true, requests: rows });
});

/* =========================
   FLOORPLANS / ROOMS
========================= */
app.post("/rooms", async (req, res) => {
  const { roomId, userId } = req.body;

  if (!roomId || !userId) {
    return res.status(400).json({ success: false, error: "roomId and userId are required" });
  }

  try {
    const [existing] = await pool.query(
      "SELECT id FROM floorplans WHERE room_id = ? LIMIT 1",
      [roomId]
    );

    if (!existing.length) {
      await pool.query(
        "INSERT INTO floorplans (user_id, label, item_type, room_id, x, y, w, h, created_order, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, ROOM_PLACEHOLDER_LABEL, "room", roomId, 0, 0, 0, 0, 0, 1]
      );
    }

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ Create room error:", e);
    return res.status(500).json({ success: false, error: "Server error creating room" });
  }
});

app.post("/floorplans/:roomId", async (req, res) => {
  const roomId = req.params.roomId;
  const { userId, cubicles, layout } = req.body;

  const floorItems = Array.isArray(cubicles)
    ? cubicles
    : Array.isArray(layout?.cubicles)
    ? layout.cubicles
    : [];

  if (!userId || !roomId) {
    return res.status(400).json({ success: false, error: "userId and roomId are required" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query("DELETE FROM floorplans WHERE room_id = ?", [roomId]);
    await conn.query("DELETE FROM inventory WHERE room_id = ?", [roomId]);

    await conn.query(
      "INSERT INTO floorplans (user_id, label, item_type, room_id, x, y, w, h, created_order, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [userId, ROOM_PLACEHOLDER_LABEL, "room", roomId, 0, 0, 0, 0, 0, 1]
    );

    if (floorItems.length) {
      for (const item of floorItems) {
        await conn.query(
          `INSERT INTO floorplans
           (user_id, label, item_type, room_id, x, y, w, h, created_order, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            item.label || null,
            item.type || item.itemType || "cubicle",
            roomId,
            Number(item.x ?? 0),
            Number(item.y ?? 0),
            Number(item.w ?? 60),
            Number(item.h ?? 40),
            Number(item.createdOrder ?? item.created_order ?? 0),
            1,
          ]
        );
      }
    }

    await upsertFloorplanInventory(conn, userId, roomId, floorItems);
    await conn.commit();

    return res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error("❌ Save floorplan error:", e);
    return res.status(500).json({ success: false, error: "Server error saving floorplan" });
  } finally {
    conn.release();
  }
});

app.get("/floorplans/:roomId", async (req, res) => {
  const roomId = req.params.roomId;

  if (!roomId) {
    return res.status(400).json({ success: false, error: "roomId is required" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM floorplans WHERE room_id = ? ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    if (!rows.length) {
      return res.json({ success: true, floorplan: null });
    }

    const cubicles = rows
      .filter((row) => row.label !== ROOM_PLACEHOLDER_LABEL)
      .map((row) => ({
        id: Number(row.id),
        type: row.item_type || "cubicle",
        label: row.item_type === "cubicle" ? row.label : "",
        x: Number(row.x || 0),
        y: Number(row.y || 0),
        w: Number(row.w || 60),
        h: Number(row.h || 40),
        color:
          row.color ||
          (row.item_type === "wall"
            ? "#5f6368"
            : row.item_type === "door"
            ? "#c49a6c"
            : row.item_type === "table"
            ? "#8d6e63"
            : "#4caf50"),
        locked:
          row.locked === 1 ||
          row.locked === true ||
          row.locked === "1" ||
          false,
        createdOrder: Number(row.created_order || 0),
      }));

    return res.json({
      success: true,
      floorplan: {
        roomId,
        userId: rows[0]?.user_id || null,
        layout: { cubicles },
      },
    });
  } catch (e) {
    console.error("❌ Load floorplan error:", e);
    return res.status(500).json({ success: false, error: "Server error loading floorplan" });
  }
});

app.post("/cubicles", async (req, res) => {
  const { userId, roomId, label, x, y, w, h, createdOrder, itemType } = req.body;

  if (!userId || !roomId) {
    return res.status(400).json({
      success: false,
      error: "userId and roomId are required",
    });
  }

  const resolvedType = itemType || "cubicle";
  const resolvedLabel =
    resolvedType === "cubicle" ? label : `__${resolvedType.toUpperCase()}__${Date.now()}`;

  const conn = await pool.getConnection();

  try {
    const [roomExists] = await conn.query(
      "SELECT id FROM floorplans WHERE room_id = ? LIMIT 1",
      [roomId]
    );

    if (!roomExists.length) {
      await conn.query(
        "INSERT INTO floorplans (user_id, label, item_type, room_id, x, y, w, h, created_order, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, ROOM_PLACEHOLDER_LABEL, "room", roomId, 0, 0, 0, 0, 0, 1]
      );
    }

    const [existingItem] = await conn.query(
      "SELECT id FROM floorplans WHERE room_id = ? AND label = ? LIMIT 1",
      [roomId, resolvedLabel]
    );

    if (existingItem.length) {
      await conn.query(
        `UPDATE floorplans
         SET user_id = ?, item_type = ?, x = ?, y = ?, w = ?, h = ?, created_order = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE room_id = ? AND label = ?`,
        [
          userId,
          resolvedType,
          x ?? 0,
          y ?? 0,
          w ?? 60,
          h ?? 40,
          createdOrder ?? 0,
          roomId,
          resolvedLabel,
        ]
      );

      return res.json({ success: true, cubicleId: existingItem[0].id });
    }

    const [insertResult] = await conn.query(
      `INSERT INTO floorplans
       (user_id, label, item_type, room_id, x, y, w, h, created_order, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        resolvedLabel,
        resolvedType,
        roomId,
        x ?? 0,
        y ?? 0,
        w ?? 60,
        h ?? 40,
        createdOrder ?? 0,
        1,
      ]
    );

    return res.json({ success: true, cubicleId: insertResult.insertId || null });
  } catch (e) {
    console.error("❌ Add cubicle error:", e);
    return res.status(500).json({ success: false, error: "Server error adding cubicle" });
  } finally {
    conn.release();
  }
});

app.get("/floorplans", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT room_id, MAX(updated_at) AS updated_at
      FROM floorplans
      GROUP BY room_id
      ORDER BY room_id ASC
    `);

    return res.json({ success: true, floorplans: rows });
  } catch (e) {
    console.error("❌ List floorplans error:", e);
    return res.status(500).json({ success: false, error: "Server error listing floorplans" });
  }
});

app.get("/floorplan-inventory", async (req, res) => {
  const roomId = req.query.roomId;

  if (!roomId) {
    return res.status(400).json({ success: false, error: "roomId is required" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT * FROM inventory WHERE room_id = ? ORDER BY id ASC`,
      [roomId]
    );
    return res.json({ success: true, inventory: rows });
  } catch (e) {
    console.error("❌ List floorplan inventory error:", e);
    return res.status(500).json({
      success: false,
      error: "Server error listing floorplan inventory",
    });
  }
});

app.get("/cubicles", async (req, res) => {
  const roomId = req.query.roomId;

  if (!roomId) {
    return res.status(400).json({
      success: false,
      error: "roomId is required",
    });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM floorplans WHERE room_id = ? ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    res.json({
      success: true,
      cubicles: rows
        .filter((row) => row.label !== ROOM_PLACEHOLDER_LABEL)
        .map((row) => ({
          ...row,
          type: row.item_type || "cubicle",
          label: row.item_type === "cubicle" ? row.label : "",
          x: Number(row.x || 0),
          y: Number(row.y || 0),
          w: Number(row.w || 60),
          h: Number(row.h || 40),
          createdOrder: Number(row.created_order || 0),
        })),
    });
  } catch (e) {
    console.error("❌ Fetch cubicles error:", e);
    res.status(500).json({ success: false, error: "Server error fetching cubicles" });
  }
});

/* =========================
   INVENTORY
========================= */
const inventoryTables = [
  "computers",
  "monitors",
  "headsets",
  "mouse",
  "keyboards",
  "cameras",
];

app.get("/api/inventory/summary", async (_req, res) => {
  try {
    const summary = [];

    for (const table of inventoryTables) {
      const [rows] = await pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN LOWER(TRIM(status)) = 'defect' THEN 1 ELSE 0 END) AS defects,
           SUM(CASE WHEN LOWER(TRIM(status)) = 'available' THEN 1 ELSE 0 END) AS available,
           SUM(CASE WHEN LOWER(TRIM(status)) = 'used' THEN 1 ELSE 0 END) AS used
         FROM \`${table}\``
      );

      summary.push({
        name: table.charAt(0).toUpperCase() + table.slice(1),
        total: Number(rows[0]?.total || 0),
        defects: Number(rows[0]?.defects || 0),
        available: Number(rows[0]?.available || 0),
        used: Number(rows[0]?.used || 0),
      });
    }

    res.json({ success: true, summary });
  } catch (e) {
    console.error("❌ Inventory summary error:", e);
    res.status(500).json({ success: false });
  }
});

app.get("/api/inventory/:type", async (req, res) => {
  const { type } = req.params;

  if (!inventoryTables.includes(type)) {
    return res.status(400).json({ success: false, error: "Invalid inventory type" });
  }

  try {
    const [rows] = await pool.query(`SELECT * FROM \`${type}\` ORDER BY name ASC`);
    res.json({ success: true, items: rows });
  } catch (e) {
    console.error("❌ Inventory fetch error:", e);
    res.status(500).json({ success: false });
  }
});

/* =========================
   UPDATE REQUEST STATUS
========================= */
app.put("/api/it-requests/:id", async (req, res) => {
  const requestId = Number(req.params.id);
  const { status } = req.body;

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: "Invalid status" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT status FROM requests WHERE id = ?",
      [requestId]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false });
    }

    const currentStatus = rows[0].status;
    const now = new Date();

    const updateFields = ["status = ?"];
    const updateValues = [status];

    if (status === "inprogress") {
      updateFields.push("inprogress_at = ?");
      updateValues.push(now);
    }

    if (status === "completed") {
      updateFields.push("completed_at = ?");
      updateValues.push(now);
    }

    if (status === "rejected") {
      updateFields.push("rejected_at = ?");
      updateValues.push(now);
      updateFields.push("rejected_from = ?");
      updateValues.push(currentStatus);
    }

    const sql = `
      UPDATE requests
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `;

    await conn.query(sql, [...updateValues, requestId]);

    const [reqRows] = await conn.query(
      "SELECT request_text FROM requests WHERE id = ?",
      [requestId]
    );
    const requestText = reqRows?.[0]?.request_text || "";

    if (status === "inprogress") {
      await reserveRequestedItem(conn, requestId, requestText);
    }

    if (status === "completed") {
      await markRequestedItemUsed(conn, requestId, requestText);
    }

    if (status === "rejected") {
      await releaseReservedItem(conn, requestId, requestText);
    }

    await syncStatusTablesForRequest(conn, requestId);
    await conn.commit();

    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error("❌ Update status error:", e);
    res.status(500).json({
      success: false,
      error: e.message || "Database error",
      details: e.stack,
    });
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