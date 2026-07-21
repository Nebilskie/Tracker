require("dotenv").config();
const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST || '192.168.88.87',
  user: process.env.DB_USER || 'ezware1',
  password: process.env.DB_PASS || 'P@55w0rd',
  database: process.env.DB_NAME || 'tracker'
});

db.connect((err) => {
  if (err) {
    console.error("❌ MySQL connection error:", err);
    process.exit(1);
  }

  console.log("✅ Connected to MySQL\n");

  // Check mst_cubicles table (renamed from floorplans/cubicles)
  db.query("SELECT COUNT(*) as count FROM mst_cubicles", (err, result) => {
    if (err) {
      console.error("❌ Error checking cubicles:", err);
    } else {
      const count = result[0].count;
      console.log(`📊 mst_cubicles table: ${count} records`);

      if (count > 0) {
        // Show some sample data
        db.query("SELECT * FROM mst_cubicles LIMIT 5", (err, rows) => {
          if (err) {
            console.error("❌ Error getting cubicle data:", err);
          } else {
            console.log("\n📋 Sample mst_cubicles data:");
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