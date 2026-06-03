// Chạy: node test-server.js
// Test xem express + port 3000 có OK không
const express = require('express');
const app = express();

app.use(express.json());

app.get('/ping', (req, res) => res.json({ ok: true, msg: 'test server works' }));
app.post('/echo', (req, res) => res.json({ received: req.body }));

app.listen(3001, () => {
  console.log('\n✅ Test server OK on http://localhost:3001');
  console.log('   Test: http://localhost:3001/ping\n');
});
