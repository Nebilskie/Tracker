const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.88.87',
  port: Number(process.env.DB_PORT) || 3306,
  localAddress: process.env.DB_LOCAL_ADDRESS || '192.168.100.173',
  user: process.env.DB_USER || 'ezware1',
  password: process.env.DB_PASS || 'P@55w0rd',
  database: process.env.DB_NAME || 'tracker',
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 30000,
  enableKeepAlive: true,
});

module.exports = pool;