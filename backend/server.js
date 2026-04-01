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
      CREATE TABLE IF NOT EXISTS floorplan_rooms (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(100),
        room_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room_name (user_id, room_name)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS floorplans (
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
        FOREIGN KEY (room_id) REFERENCES floorplan_rooms(id) ON DELETE CASCADE
      )
    `);

    // Clean up legacy room placeholder entries in the floorplans table.

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
        room_id INT,
        label VARCHAR(100),
        monitors VARCHAR(255) DEFAULT NULL,
        headsets VARCHAR(255) DEFAULT NULL,
        cameras VARCHAR(255) DEFAULT NULL,
        mouse VARCHAR(255) DEFAULT NULL,
        keyboards VARCHAR(255) DEFAULT NULL,
        computers VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_room_label (user_id, room_id, label),
        FOREIGN KEY (room_id) REFERENCES floorplan_rooms(id) ON DELETE CASCADE
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

    await createInventoryTable("monitors");
    await createInventoryTable("headsets");
    await createInventoryTable("mouse");
    await createInventoryTable("keyboards");
    await createInventoryTable("cameras");
    await createInventoryTable("computers");

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
    // 🔥 SKIP ROOM + INVALID
    if (!item?.label || item.label === "__ROOM__") continue;

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

async function setFloorplanInventoryValue(conn, roomId, label, column, value) {
  if (!roomId || !label || !column) return;

  const validColumns = ["monitors", "headsets", "cameras", "mouse", "keyboards", "computers"];
  if (!validColumns.includes(column)) return;

  // Update existing inventory row for the cubicle
  const [result] = await conn.query(
    `UPDATE inventory SET ${column} = ? WHERE room_id = ? AND label = ?`,
    [value, roomId, label]
  );

  // If no row exists yet, insert one so the cubicle gets updated
  if (result.affectedRows === 0) {
    await conn.query(
      `INSERT INTO inventory (user_id, room_id, label, ${column}) VALUES (?, ?, ?, ?)`,
      [null, roomId, label, value]
    );
  }
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
app.post("/rooms", async (req,res)=>{
  const { roomId, userId } = req.body;
  if (!roomId || !userId) {
    return res.status(400).json({ success:false, error:"roomId and userId required" });
  }

  const conn = await pool.getConnection();

  try {
    const [existing] = await conn.query(
      "SELECT id FROM floorplan_rooms WHERE user_id=? AND room_name=? LIMIT 1",
      [userId, roomId]
    );

    let roomRecordId;

    if (existing.length) {
      roomRecordId = existing[0].id;
    } else {
      const [result] = await conn.query(
        "INSERT INTO floorplan_rooms (user_id, room_name) VALUES (?,?)",
        [userId, roomId]
      );
      roomRecordId = result.insertId;
    }

    // 🔥 CLEAN ANY BAD ROOM DATA IN FLOORPLANS
    await conn.query(
      "DELETE FROM floorplans WHERE room_id = ? AND (item_type = 'room' OR label = '__ROOM__')",
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

app.get("/floorplans/:roomId", async (req,res)=>{
  const roomIdParam = req.params.roomId;
  const conn = await pool.getConnection();

  try {
    let roomId;
    if (/^\d+$/.test(roomIdParam)) roomId = parseInt(roomIdParam,10);
    else {
      const [roomRecord] = await conn.query(
        "SELECT id FROM floorplan_rooms WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1",
        [roomIdParam]
      );
      if(!roomRecord.length) return res.json({success:true,floorplan:null});
      roomId = roomRecord[0].id;
    }

    const [rows] = await conn.query(
      "SELECT * FROM floorplans WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__') ORDER BY created_order ASC, id ASC",
      [roomId]
    );

    const cubicles = rows.map(row=>({
      id:Number(row.id),
      type:row.item_type||"cubicle",
      label:row.item_type==="cubicle"?row.label:"",
      x:Number(row.x||0),
      y:Number(row.y||0),
      w:Number(row.w||60),
      h:Number(row.h||40),
      createdOrder:Number(row.created_order||0)
    }));

    res.json({ success:true, floorplan:{ roomId, userId:rows[0]?.user_id||null, layout:{cubicles} } });
  } catch(e){
    console.error(e);
    res.status(500).json({ success:false, error:"Server error loading floorplan" });
  } finally { conn.release(); }
});

app.post("/floorplans/:roomId", async (req, res) => {
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
        "SELECT id FROM floorplan_rooms WHERE user_id = ? AND room_name = ? LIMIT 1",
        [userId, roomIdParam]
      );

      if (!roomRecord.length) {
        const [insertResult] = await conn.query(
          "INSERT INTO floorplan_rooms (user_id, room_name) VALUES (?, ?)",
          [userId, roomIdParam]
        );
        roomId = insertResult.insertId;
      } else {
        roomId = roomRecord[0].id;
      }
    }

    // 🔥 HARD CLEAN BEFORE INSERT
    await conn.query(
      "DELETE FROM floorplans WHERE room_id = ?",
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
        `INSERT INTO floorplans
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
});

app.get("/cubicles", async (req,res)=>{
  const roomId = req.query.roomId;
  if(!roomId) return res.status(400).json({success:false,error:"roomId required"});

  try {
    const [rows] = await pool.query(
      "SELECT * FROM floorplans WHERE room_id = ? AND item_type != 'room' AND (label IS NULL OR label != '__ROOM__') ORDER BY created_order ASC, id ASC",
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

app.get("/floorplans", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.room_id, f.label, fr.room_name,
             IF(fr.room_name IS NOT NULL, fr.room_name, f.room_id) as display_room_id
      FROM floorplans f
      LEFT JOIN floorplan_rooms fr ON f.room_id = fr.id
      WHERE f.item_type != 'room' AND f.label IS NOT NULL AND TRIM(f.label) != '' AND f.label != ?
      ORDER BY display_room_id ASC, f.label ASC
    `, ['__ROOM__']);

    // Map to return room_id as the display room name for frontend compatibility
    const mappedRows = rows.map((row) => ({
      room_id: row.room_name || row.room_id,
      label: row.label
    }));

    return res.json({ success: true, floorplans: mappedRows });
  } catch (e) {
    console.error("❌ List floorplans error:", e);
    return res.status(500).json({ success: false, error: "Server error listing floorplans" });
  }
});

app.get("/floorplan-rooms", async (req,res)=>{
  try {
    const userId = req.query.userId;
    let query = "SELECT id, room_name FROM floorplan_rooms";
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
        "SELECT id FROM floorplan_rooms WHERE LOWER(TRIM(room_name)) = LOWER(TRIM(?)) LIMIT 1",
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

app.get("/cubicles", async (req, res) => {
  const roomId = req.query.roomId;

  if (!roomId) {
    return res.status(400).json({
      success: false,
      error: "roomId is required",
    });
  }

  try {
  

    res.json({
      success: true, 
      cubicles: rows
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

app.post("/api/inventory/:type/import", async (req, res) => {
  const { type } = req.params;
  const { csvData } = req.body;

  if (!inventoryTables.includes(type)) {
    return res.status(400).json({ success: false, error: "Invalid inventory type" });
  }

  if (!csvData || !Array.isArray(csvData)) {
    return res.status(400).json({ success: false, error: "csvData must be an array of objects" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let importedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];

      try {
        // Validate required fields
        if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
          errors.push(`Row ${i + 1}: Missing or invalid name`);
          continue;
        }

        // Prepare data based on table type
        const insertData = { name: row.name.trim() };

        if (type === 'computers') {
          insertData.status = row.status || 'Available';
          insertData.manufacturer = row.manufacturer || null;
          insertData.serial_number = row.serial_number || null;
          // Keep the table type column clean: use a dedicated CSV column if provided.
          const computerType = (row.computer_type || row.item_type || (row.type && row.type.trim().toLowerCase() !== 'computers' ? row.type : null));
          insertData.type = computerType || null;
          insertData.model = row.model || null;
          insertData.os = row.os || null;
          insertData.location = row.location || null;
          insertData.last_update = new Date();
          insertData.processor = row.processor || null;
        } else {
          insertData.status = row.status || 'Available';
          insertData.manufacturer = row.manufacturer || null;
          insertData.location = row.location || null;
          insertData.model = row.model || null;
          insertData.last_update = new Date();
        }

        // Check if item already exists
        const [existing] = await conn.query(
          `SELECT id FROM \`${type}\` WHERE name = ?`,
          [insertData.name]
        );

        if (existing.length > 0) {
          skippedCount++;
          continue;
        }

        // Insert new item
        await conn.query(
          `INSERT INTO \`${type}\` SET ?`,
          [insertData]
        );

        importedCount++;
      } catch (rowError) {
        console.error(`❌ Error processing row ${i + 1}:`, rowError);
        errors.push(`Row ${i + 1}: ${rowError.message}`);
      }
    }

    await conn.commit();

    res.json({
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (e) {
    await conn.rollback();
    console.error("❌ Inventory import error:", e);
    res.status(500).json({ success: false, error: "Import failed" });
  } finally {
    conn.release();
  }
});

// Bulk import endpoint - supports multiple inventory types in one CSV
app.post("/api/inventory/import", async (req, res) => {
  const { csvData } = req.body;

  if (!csvData || !Array.isArray(csvData)) {
    return res.status(400).json({ success: false, error: "csvData must be an array of objects" });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    let importedCount = 0;
    let skippedCount = 0;
    const errors = [];
    const currentTime = new Date();

    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];

      try {
        // Validate required fields
        if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
          errors.push(`Row ${i + 1}: Missing or invalid name`);
          continue;
        }

        if (!row.type || typeof row.type !== 'string' || !row.type.trim()) {
          errors.push(`Row ${i + 1}: Missing or invalid type`);
          continue;
        }

        const type = row.type.trim().toLowerCase();
        if (!inventoryTables.includes(type)) {
          errors.push(`Row ${i + 1}: Invalid type '${row.type}'. Must be one of: ${inventoryTables.join(', ')}`);
          continue;
        }

        // Prepare data based on table type
        const insertData = { name: row.name.trim() };

        if (type === 'computers') {
          insertData.status = row.status || 'Available';
          insertData.manufacturer = row.manufacturer || null;
          insertData.serial_number = row.serial_number || null;
          // Avoid inserting inventory category into computer table type column
          const computerType = (row.computer_type || row.item_type || (row.type && row.type.trim().toLowerCase() !== 'computers' ? row.type : null));
          insertData.type = computerType || null;
          insertData.model = row.model || null;
          insertData.os = row.os || null;
          insertData.location = row.location || null;
          insertData.last_update = currentTime;
          insertData.processor = row.processor || null;
        } else {
          insertData.status = row.status || 'Available';
          insertData.manufacturer = row.manufacturer || null;
          insertData.location = row.location || null;
          insertData.model = row.model || null;
          insertData.last_update = currentTime;
        }

        // Check if item already exists
        const [existing] = await conn.query(
          `SELECT id FROM \`${type}\` WHERE name = ?`,
          [insertData.name]
        );

        if (existing.length > 0) {
          skippedCount++;
          continue;
        }

        // Insert new item
        await conn.query(
          `INSERT INTO \`${type}\` SET ?`,
          [insertData]
        );

        importedCount++;
      } catch (rowError) {
        console.error(`❌ Error processing row ${i + 1}:`, rowError);
        errors.push(`Row ${i + 1}: ${rowError.message}`);
      }
    }

    await conn.commit();

    res.json({
      success: true,
      imported: importedCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (e) {
    await conn.rollback();
    console.error("❌ Bulk inventory import error:", e);
    res.status(500).json({ success: false, error: "Import failed" });
  } finally {
    conn.release();
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