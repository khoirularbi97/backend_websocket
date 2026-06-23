// test_client.js
const fs = require('fs');
const WebSocket = require('ws');

const ws = new WebSocket('wss://app.scurebot.site/ws/');

ws.on('open', () => {
  console.log('Terhubung ke server');

  

  // Kirim gambar seperti dari ESP32
  ws.send(JSON.stringify({
    type:'masuk',
    uid: '7778888'
  }));
});

ws.on('message', (msg) => {
  try {
    const data = JSON.parse(msg);
    const uid = data.uid;
    const imageBuffer = fs.readFileSync('gambar.jpg');
    const base64 = imageBuffer.toString('base64');
    if (data.type === 'take_picture_in') {
      console.log('ambil gambar');
      ws.send(JSON.stringify({
      type: 'image',
      gate: 'masuk',  // atau 'masuk'
      uid: uid,  // atau 'masuk'
      image: base64
  }));
