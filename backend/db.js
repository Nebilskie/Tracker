const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.8.166',
  user: process.env.DB_USER || 'ezware1',
  password: process.env.DB_PASS || 'P@55w0rd',
  database: process.env.DB_NAME || 'tracker',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;