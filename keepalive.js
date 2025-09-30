// keepalive.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.all('/', (req, res) => {
  res.send('Bot is alive!');
});

function keepAlive() {
  app.listen(PORT, () => {
    console.log(`Keepalive server is running on port ${PORT}`);
  });
}

module.exports = keepAlive;
