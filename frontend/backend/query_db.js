import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  const clubs = await client.query("SELECT id, name FROM clubs");
  console.log('CLUBS:', JSON.stringify(clubs.rows));
  const users = await client.query("SELECT id, first_name, last_name, handicap_index FROM users ORDER BY last_name");
  console.log('USERS:', JSON.stringify(users.rows));
  await client.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
