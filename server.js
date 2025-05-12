const WebSocket = require('ws');
const axios = require('axios');
require('dotenv').config();

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', ws => {
    console.log("ESP32 Terhubung");

    ws.on('message', async message => {
        const data = JSON.parse(message);

        if (data.type === "image") {
            console.log("Gambar diterima, mengirim ke Laravel...");

            await axios.post('http://127.0.0.1/api/anpr', {
                image: data.image
            });
        }

        if (data.type === "nfc") {
            console.log("NFC UID: " + data.uid);
            
            const response = await axios.post('http://127.1./api/payment', {
                uid: data.uid
            });

            if (response.data.status === "success") {
                ws.send("open_gate");
            }
        }
    });
});

console.log("WebSocket Server berjalan di port 8080");
