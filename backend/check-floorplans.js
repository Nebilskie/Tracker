require("dotenv").config();
const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST || '192.168.8.166',
  user: process.env.DB_USER || 'ezware1',
  password: process.env.DB_PASS || 'P@55w0rd',
  database: process.env.DB_NAME || 'tracker'
});

db.connect((err) => {
  if (err) {W
    console.error("❌ MySQL connection error:", err);
    process.exit(1);
  }

  console.log("✅ Connected to MySQL\n");

  // Check floorplans table
  db.query("SELECT COUNT(*) as count FROM floorplans", (err, result) => {
    if (err) {
      console.error("❌ Error checking floorplans:", err);
    } else {
      const count = result[0].count;
      console.log(`📊 floorplans table: ${count} records`);

      if (count > 0) {
        // Show some sample data
        db.query("SELECT * FROM floorplans LIMIT 5", (err, rows) => {
          if (err) {
            console.error("❌ Error getting floorplan data:", err);
          } else {
            console.log("\n📋 Sample floorplan data:");
            rows.forEach(row => {
              console.log(`  - ID: ${row.id}, User: ${row.user_id}, Room: ${row.room_id}, Label: ${row.label}, Position: (${row.x}, ${row.y})`);
            });
          }
          db.end();
        });
      } else {
        db.end();
      }
    }
  });
});