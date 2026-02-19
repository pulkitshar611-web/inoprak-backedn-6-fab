require('dotenv').config();
const pool = require('./config/db');

async function check() {
    try {
        const [rows] = await pool.execute('SHOW CREATE TABLE users');
        console.log(rows[0]['Create Table']);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
