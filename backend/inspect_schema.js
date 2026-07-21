const mysql = require('mysql2/promise');
(async () => {
  try {
    const conn = await mysql.createConnection({
      host: '192.168.88.87',
      user: 'ezware1',
      password: 'P@55w0rd',
      database: 'tracker',
    });
    const [users] = await conn.query('SHOW COLUMNS FROM mst_users');
    console.log('MST_USERS columns:');
    users.forEach((r) => console.log(r.Field, r.Type));
    const [cubicles] = await conn.query('SHOW COLUMNS FROM mst_cubicles');
    console.log('\nMST_CUBICLES columns:');
    cubicles.forEach((r) => console.log(r.Field, r.Type));
    const [rooms] = await conn.query('SHOW COLUMNS FROM mst_room');
    console.log('\nMST_ROOM columns:');
    rooms.forEach((r) => console.log(r.Field, r.Type));
    const [buildings] = await conn.query('SHOW COLUMNS FROM mst_building');
    console.log('\nMST_BUILDING columns:');
    buildings.forEach((r) => console.log(r.Field, r.Type));
    await conn.end();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
