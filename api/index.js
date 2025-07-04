import express from 'express';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import FormData from 'form-data';
import { createReadStream, promises as fs, createWriteStream } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// --- KONFIGURASI ---
const app = express();
const PORT = process.env.PORT || 3000;
ffmpeg.setFfmpegPath(ffmpegStatic);

// --- FUNGSI UPLOADER KE CATBOX.MOE ---
async function uploadToCatbox(filePath) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', createReadStream(filePath));
    try {
        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: { ...form.getHeaders() },
            timeout: 60000
        });
        if (response.status === 200 && response.data.startsWith('http')) {
            return response.data;
        }
        throw new Error('Gagal upload atau respons Catbox tidak valid.');
    } catch (error) {
        throw new Error(`Gagal menghubungi Catbox: ${error.message}`);
    }
}

// --- ENDPOINT API ---
app.get('/', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) {
        return res.status(400).json({ status: 'error', message: 'Parameter URL wajib ada. Contoh: ?url=https://...' });
    }
    const jobId = randomUUID();
    const inputPath = path.join('/tmp', `${jobId}_input`);
    const outputPath = path.join('/tmp', `${jobId}_output.m4a`);
    console.log(`[${jobId}] Memulai proses untuk URL: ${audioUrl}`);

    try {
        // --- Langkah 1: Download File ---
        console.log(`[${jobId}] Tahap 1: Mendownload file...`);
        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream',
            // ===================================================================
            // KUNCI PERBAIKAN: Menyamar jadi browser Chrome biar tidak diblokir
            // ===================================================================
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
            }
        });
        const writer = createWriteStream(inputPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // --- Langkah 2: Konversi dengan FFmpeg ---
        console.log(`[${jobId}] Tahap 2: Mengonversi ke AAC (M4A)...`);
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions(['-c:a aac', '-b:a 96k'])
                .save(outputPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));
        });

        // --- Langkah 3: Upload Hasil Konversi ---
        console.log(`[${jobId}] Tahap 3: Mengunggah hasil ke Catbox...`);
        const publicUrl = await uploadToCatbox(outputPath);

        // --- Langkah 4: Kirim Respon Sukses ---
        console.log(`[${jobId}] Selesai! Mengirim URL: ${publicUrl}`);
        res.status(200).json({
            status: 'success',
            message: 'Audio berhasil dikonversi.',
            result: {
                original_url: audioUrl,
                converted_url: publicUrl
            }
        });

    } catch (error) {
        console.error(`[${jobId}] GAGAL:`, error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Terjadi kesalahan pada server saat memproses audio.',
            details: error.message 
        });
    } finally {
        // --- Langkah 5 (PENTING): Bersihkan File Sampah ---
        console.log(`[${jobId}] Tahap Akhir: Membersihkan file sementara...`);
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
    }
});

// Jalankan server untuk testing lokal
app.listen(PORT, () => {
    console.log(`Server untuk testing lokal jalan di http://localhost:${PORT}`);
});

// Export app agar bisa dijalankan oleh Vercel
export default app;
