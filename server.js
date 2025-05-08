const WebSocket = require('ws');
const mysql = require('mysql2/promise');

const wss = new WebSocket.Server({ port: 8088 });
const users = new Map(); 

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'MySQL15Dione',
  database: 'chat_db'
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ system: true, message: 'Welcome! ' }));

  ws.on('message', async (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return ws.send(JSON.stringify({ system: true, message: 'Invalid message format.' }));
    }

    if (parsed.type === 'auth') {
      const username = parsed.username?.trim();
      if (!username) return ws.send(JSON.stringify({ system: true, message: 'Username required.' }));

      try {
        await pool.query('INSERT IGNORE INTO users (username) VALUES (?)', [username]);

        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return ws.send(JSON.stringify({ system: true, message: 'Login failed.' }));

        users.set(ws, username);
        ws.send(JSON.stringify({ system: true, message: `Logged in as ${username}` }));

        const [history] = await pool.query(
          'SELECT username, message, timestamp FROM messages ORDER BY id DESC LIMIT 20'
        );
        history.reverse().forEach((row) => {
          ws.send(JSON.stringify({
            user: row.username,
            message: row.message,
            time: row.timestamp
          }));
        });

        broadcastSystemMessage(`${username} has joined the chat`, ws);
      } catch (err) {
        console.error(err);
        ws.send(JSON.stringify({ system: true, message: 'Database error.' }));
      }
    }

    if (parsed.type === 'chat') {
      const username = users.get(ws);
      if (!username) return ws.send(JSON.stringify({ system: true, message: 'Please login first.' }));

      const msg = parsed.message;
      await pool.query('INSERT INTO messages (username, message) VALUES (?, ?)', [username, msg]);

      const fullMsg = JSON.stringify({ user: username, message: msg });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(fullMsg);
      });
    }

    if (parsed.type === 'leave') {
      const username = users.get(ws);
      if (username) {
        users.delete(ws);
        broadcastSystemMessage(`${username} has left the chat`, ws);
      }
    }
  });

  ws.on('close', () => {
    const username = users.get(ws);
    if (username) {
      users.delete(ws);
      broadcastSystemMessage(`${username} has disconnected`);
    }
  });
});

function broadcastSystemMessage(msg, exceptWs = null) {
  const sysMsg = JSON.stringify({ system: true, message: msg });
  wss.clients.forEach((client) => {
    if (client !== exceptWs && client.readyState === WebSocket.OPEN) {
      client.send(sysMsg);
    }
  });
}

console.log('WebSocket server running on ws://localhost:8088');
