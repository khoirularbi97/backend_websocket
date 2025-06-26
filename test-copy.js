
//require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql');
const WebSocket = require('ws');
const Tesseract = require('tesseract.js');
const { spawn } = require('child_process');

// Koneksi database MySQL
const db = mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
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
console.log("WebSocket Server berjalan di port 5000");

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


const tempData = {};

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

        if (data.type === "registrasi") {
            console.log("📥 Registrasi UID:", data.uid);
             ws.send(JSON.stringify({ type: "uid_scanned", uid: data.uid }));
        }

        else if (data.type === "masuk") {
            const uid = data.uid;
            console.log("🟢 Cek UID Masuk:", uid);
            db.query('SELECT * FROM users WHERE uid = ?', [uid], (err, results) => {
                if (err || results.length === 0) {
                    console.log("❌ UID tidak ditemukan (Masuk)");
                    return  ws.send(JSON.stringify({ type: 'deny_access' }));
                }
                db.query('SELECT * FROM parkir_masuks WHERE uid = ? AND status = "aktif"', [uid], (err2, checkActive) => {
                    if (err2) return console.error("❌ Gagal cek status masuk:", err2);
                    if (checkActive.length > 0) {
                        console.log("⚠ UID sudah dalam status aktif, tidak boleh tap dua kali.");
                        return  ws.send(JSON.stringify({ type: 'already_in' }));
                    }
                    // Cek apakah masih ada slot kosong
                    db.query('SELECT COUNT(*) AS kosong FROM parking_slots WHERE is_available = "tersedia"', (err3, result3) => {
                        if (err3) return console.error("❌ Gagal cek slot kosong:", err3);
                        if (result3[0].kosong === 0) {
                            console.log("🚫 Slot parkir penuh, tidak bisa masuk");
                            return  ws.send(JSON.stringify({ type: 'slot_full' }));
                        }
                        tempData[uid] = { uid, gate: 'masuk' };
                        console.log("✅ UID valid & slot tersedia. Minta gambar dari ESP32.");
                         ws.send(JSON.stringify({
                                          type: "take_picture_in",
                                         uid: uid
                                        }));
                    });
                });
            });
        }

        else if (data.type === "keluar") {
            const uid = data.uid;
            console.log("🔴 Cek UID Keluar:", uid);
           db.query(`SELECT r.waktu_masuk, r.parking_slot_id FROM riwayat_parkirs r JOIN parkir_masuks p ON r.parkir_masuk_id = p.id WHERE r.uid = ? AND p.status = 'aktif' ORDER BY r.id DESC LIMIT 1`, [uid], (err, result) => {
                if (err || result.length === 0) {
                    console.log("❌ Gagal mengambil data keluar.");
                    return ws.send(JSON.stringify({ type: 'deny_exit' }));
                }
                tempData[uid] = {
                    uid,
                    gate: 'keluar',
                    waktu_masuk: result[0].waktu_masuk,
                    parking_slot_id: result[0].parking_slot_id
                };
                console.log("✅ UID valid keluar. Minta gambar dari ESP32.");
                 ws.send(JSON.stringify({
                                          type: "take_picture_out",
                                         uid: uid
                                        }));
            });
        }

        else if (data.type === "image" && data.image) {
            const uid = data.uid;
            const info = tempData[uid];
            if (!info) {
                console.warn("⚠ UID tidak ditemukan di tempData, gambar diabaikan.");
                return;
            }
            if (data.image.length < 1000) {
                console.warn("⚠ Gambar terlalu kecil, diabaikan.");
                return;
            }

            if (info.gate === 'masuk') {
                db.query('SELECT id FROM users WHERE uid = ?', [info.uid], (errUser, resultUser) => {
                    if (errUser || resultUser.length === 0) {
                        console.error("❌ Gagal mendapatkan users_id untuk riwayat parkir.");
                        return;
                    }
                    const userId = resultUser[0].id;

                    db.query('SELECT id FROM parking_slots WHERE is_available = "tersedia" ORDER BY id ASC LIMIT 1', (errSlot, resultSlot) => {
                        if (errSlot || resultSlot.length === 0) {
                            console.error("❌ Gagal mendapatkan parking_slot_id.");
                            return;
                        }
                        const parkingSlotId = resultSlot[0].id;

                        db.query('INSERT INTO parkir_masuks (uid, image_base64, status) VALUES (?, ?, ?)', [info.uid, data.image, "aktif"], (err, result) => {
                            if (err) return console.error("❌ Gagal simpan gambar masuk:", err);
                            console.log("✅ Gambar masuk disimpan ke DB, ID:", result.insertId);

                            const parkirMasukId = result.insertId;
                            db.query('UPDATE parking_slots SET is_available = "terisi" WHERE id = ?', [parkingSlotId]);

                            db.query('INSERT INTO riwayat_parkirs (uid, users_id, parking_slot_id, parkir_masuk_id, image_masuk,  waktu_keluar, waktu_masuk) VALUES (?, ?, ?, ?, ?, ?, NOW())', [info.uid, userId, parkingSlotId, parkirMasukId, data.image, '0000-00-00 00:00:00'], (err2) => {
                                if (err2) console.error("❌ Gagal simpan riwayat parkir (masuk):", err2);
                                else console.log("📝 Riwayat masuk disimpan.");
                                 ws.send(JSON.stringify({ type: 'open_gate_in' }));
                                delete tempData[uid]; // bersihkan data setelah selesai
                            });
                        });
                    });
                });
            } else if (info.gate === 'keluar') {
                const waktuMasuk = new Date(info.waktu_masuk);
                const waktuKeluar = new Date();
                const totalMs = waktuKeluar - waktuMasuk;
                const durasiJam = Math.ceil(totalMs / (1000 * 60 * 60));
                const hours = Math.floor(totalMs / (1000 * 60 * 60));
                const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);
                const durasiLengkap = `${hours} jam ${minutes} menit ${seconds} detik`;
                let biaya = 0;
                if (durasiJam <= 1) biaya = 2000;
                else biaya = 2000 + ((durasiJam - 1) * 1000);

                const waktuMasukStr = waktuMasuk.toLocaleString();
                const waktuKeluarStr = waktuKeluar.toLocaleString();
                 db.query('SELECT saldo FROM users WHERE uid = ?', [uid], (errCheckSaldo, resultSaldo) => {
                if (errCheckSaldo || resultSaldo.length === 0) {
                    console.error("❌ Gagal cek saldo user:", errCheckSaldo);
                    return ws.send(JSON.stringify({ type: 'saldo_check_failed' }));
                }
                const saldoUser = resultSaldo[0].saldo;
                if (saldoUser < biaya) {
                    console.warn("💸 Saldo tidak cukup untuk keluar.");
                    return ws.send(JSON.stringify({ type: 'saldo_kurang' }));
                }

                db.query('UPDATE parkir_masuks SET status = ? WHERE uid = ? AND status = "aktif"', ["selesai", uid], (err2) => {
                    if (err2) return console.error("❌ Gagal update status keluar:", err2);

                    db.query('UPDATE parking_slots SET is_available = "tersedia" WHERE id = ?', [info.parking_slot_id]);

                    db.query('UPDATE riwayat_parkirs SET image_keluar = ?, waktu_keluar = NOW(), biaya = ? WHERE uid = ? AND waktu_keluar = "0000-00-00 00:00:00" ORDER BY id DESC LIMIT 1', [data.image, biaya, uid], (err3, result3) => {
                        if (err3) return console.error("❌ Gagal simpan riwayat parkir (keluar):", err3);
                        console.log(`📦 Gambar keluar & biaya Rp${biaya} disimpan ke riwayat.`);

                        db.query('UPDATE users SET saldo = saldo - ? WHERE uid = ?', [biaya, uid], (errSaldo) => {
                            if (errSaldo) console.error("❌ Gagal potong saldo:", errSaldo);
                            else console.log("💰 Saldo user berhasil dipotong.");
                        });

                        db.query('INSERT INTO parkir_keluars (uid, parkir_masuk_id, image_base64, biaya) VALUES (?, (SELECT id FROM parkir_masuks WHERE uid = ? ORDER BY id DESC LIMIT 1), ?, ?)', [uid, uid, data.image, biaya], (err4) => {
                            if (err4) return console.error("❌ Gagal simpan ke parkir_keluars:", err4);
                            
                            console.log("🧾 Data parkir keluar disimpan.");
                     
                            // Insert into transaksi
                        db.query('SELECT name FROM users WHERE uid = ?', [uid], (errNama, resNama) => {
                        if (errNama || resNama.length === 0) {
                            console.error("❌ Gagal ambil nama untuk transaksi:", errNama);
                            return;
                        }
                            const nama = resNama[0].name;

                        db.query('SELECT id FROM users WHERE uid = ?', [info.uid], (errUser, resultUser) => {
                            if (errUser || resultUser.length === 0) {
                                console.error("❌ Gagal mendapatkan users_id untuk riwayat parkir.");
                                return;
                            }
                            const userId = resultUser[0].id;


                    db.query('INSERT INTO transaksis (uid, users_id, nama, jenis, jumlah, keterangan, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [uid, userId, nama, 'kredit', biaya, 'Pembayaran parkir keluar'], (errTrans) => {
                        if (errTrans) return console.error("❌ Gagal simpan transaksi:", errTrans);
                        console.log("💳 Transaksi parkir disimpan.");
                         ws.send(JSON.stringify({ type: 'open_gate_out' }));
                        delete tempData[uid]; // bersihkan data setelah selesai
                    });
                 });
                });
             });

             });

                        const invoice = {
                            gate: "open",
                            uid,
                            waktu_masuk: waktuMasukStr,
                            waktu_keluar: waktuKeluarStr,
                            durasi_jam: durasiJam,
                            durasi_lengkap: durasiLengkap,
                            biaya
                        };

                        ws.send(JSON.stringify(invoice));
                    });
                });
            }        
        }
    });


    ws.on('close', () => {
        console.log(" ESP32 Terputus");
    });
});
