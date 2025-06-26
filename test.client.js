// test_client.js
const fs = require('fs');
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:5000');

ws.on('open', () => {
  console.log('Terhubung ke server');

  const imageBuffer = fs.readFileSync('gambar.jpg');
  const base64 = imageBuffer.toString('base64');

  // Kirim gambar seperti dari ESP32
  ws.send(JSON.stringify({
    type: 'image',
    gate: 'masuk',  // atau 'keluar'
    image: base64
  }));
});

ws.on('message', (msg) => {
  try {
    const data = JSON.parse(msg);
    if (data.type === 'hasil') {
      console.log(`✅ Plat: ${data.plate}, Jenis: ${data.jenis}, Warna: ${data.warna}`);
    } else {
      console.log('Respon:', data);
    }
  } catch (e) {
    console.log('Server:', msg.toString());
  }
});
