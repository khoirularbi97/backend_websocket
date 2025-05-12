
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');
const WebSocket = require('ws');
const Tesseract = require('tesseract.js');
const { spawn } = require('child_process');

// Koneksi database MySQL
const db = mysql.createConnection({
    host: '127.0.0.1',
    port: 3307,
    user: 'root',
    password: '',
    database: 'smart_parking'
});

db.connect((err) => {
    if (err) {
        console.error('Koneksi database gagal:', err.stack);
        return;
    }
    console.log('Terhubung ke database MySQL');
});

const wss = new WebSocket.Server({ port: 5000 });
console.log("WebSocket Server berjalan di port 8080");

// Menyimpan base64 image ke file
function saveBase64Image(base64, filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
  }
  

// Jalankan Tesseract OCR untuk ANPR
// async function runANPR(base64Image) {
//     const filePath = path.join(__dirname, 'plate_temp.jpg');
//     saveBase64Image(base64Image, filePath);

//     console.log("🔍 Menjalankan OCR (Tesseract.js)...");
//     const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
//     const plate = text.replace(/[^A-Z0-9]/gi, '').trim();

//     console.log(" Plat Nomor:", plate || "tidak terbaca");

//     // Simpan ke database
//     const sql = "INSERT INTO anpr_results (plate, image_path) VALUES (?, ?)";
//     db.query(sql, [plate, filePath], (err, result) => {
//         if (err) {
//             console.error(" Gagal simpan plat ke database:", err);
//         } else {
//             console.log(" Plat disimpan, ID:", result.insertId);
//         }
//     });

//     return plate;
// }

// // Jalankan Python YOLOv5 untuk deteksi kendaraan
// function runYOLO(base64Image) {
//     return new Promise((resolve, reject) => {
//         const python = spawn('python', ['anpr.py']);
//         let result = '';

//         python.stdout.on('data', data => result += data.toString());
//         python.stderr.on('data', data => console.error(`⚠ Error Python: ${data}`));
//         python.on('close', () => resolve(result.trim()));

//         python.stdin.write(base64Image);
//         python.stdin.end();
//     });
// }




const timestamp = new Date().toISOString()
// WebSocket Connection Handler
wss.on('connection', ws => {
    console.log("ESP32 Terhubung");

    ws.on('message', async message => {
        let data;

        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error("Format JSON tidak valid.");
            return;
        }

        // NFC Handling
        if (data.type === "nfc") {
            console.log("UID NFC:",data.uid);
           

            db.query('SELECT * FROM users WHERE uid = ?', [data.uid], (err,results) => {
                if (err) {
                    console.error('Query error:', err);
                    return;
                }
                if (results.length > 0) {

                          db.query('INSERT INTO parkir_masuks (uid, status) VALUES (?, ?)', 
                            [data.uid, 'aktif'], (err) => {
                                if (err) return console.error(' Log gagal:', err);
                               
                                ws.uid = data.uid;
                                console.log(`UID tersimpan: ${ws.uid}`);
                            

                                console.log(` gate dibuka.`);
                                ws.send("open_gate");
                            });
                            // Simpan uid ke objek koneksi ws (hanya satu kali saat pertama terima)
                            
                        
                    
                } else {
                    console.log("UID tidak ditemukan");
                    ws.send("deny_access");
                }
                
            });
          }
        

            
        

        // Gambar dari ESP32
      if (data.type === "image" && data.image) {
     console.log("📷 Gambar diterima dari ESP32");

            // Validasi panjang gambar
            if (!data.image || data.image.length < 1000) {
                console.warn("⚠ Gambar terlalu kecil, diabaikan.");
                return;
            }

            // Simpan base64 image ke database
            db.query('UPDATE parkir_masuks SET image_base64 = ? WHERE uid = ?', [data.image, ws.uid], (err, updateResult) => {
                             if (err) return console.error('❌ Gagal simpan gambar:', err);
                console.log('✅ Gambar disimpan ke DB, ID:', updateResult);
            });
            

         }

    });





    ws.on('close', () => {
        console.log(" ESP32 Terputus");
    });
});
