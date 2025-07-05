import express from 'express';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import FormData from 'form-data';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const app = express();
const PORT = process.env.PORT || 8080;
ffmpeg.setFfmpegPath(ffmpegStatic);

// --- Fungsi upload ke Catbox ---
async function uploadToCatbox(filePath) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', createReadStream(filePath));
    try {
        const response = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
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

// --- Endpoint utama ---
app.get('/', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) {
        return res.status(400).json({ status: 'error', message: 'Parameter ?url= wajib ada' });
    }

    const jobId = randomUUID();
    const inputPath = path.join('/tmp', `${jobId}_input.mp3`);
    const outputPath = path.join('/tmp', `${jobId}_output.m4a`);
    console.log(`[${jobId}] Memulai proses untuk URL: ${audioUrl}`);

    try {
        // --- Tahap 1: Download file pakai buffer ---
        console.log(`[${jobId}] Tahap 1: Mendownload file dengan buffer...`);
        const response = await axios.get(audioUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
                'Referer': 'https://cloudkuimages.com/',
                'Origin': 'https://cloudkuimages.com',
                'Connection': 'keep-alive',
                'Host': 'cloudkuimages.com'
            }
        });

        await fs.writeFile(inputPath, response.data);
        console.log(`[${jobId}] Sukses download ke ${inputPath}`);

        // --- Tahap 2: Konversi MP3 ke M4A ---
        console.log(`[${jobId}] Tahap 2: Mengonversi dengan ffmpeg...`);
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions(['-c:a aac', '-b:a 96k'])
                .save(outputPath)
                .on('end', resolve)
                .on('error', err => reject(new Error(`FFmpeg error: ${err.message}`)));
        });

        // --- Tahap 3: Upload ke Catbox ---
        console.log(`[${jobId}] Tahap 3: Upload ke Catbox...`);
        const publicUrl = await uploadToCatbox(outputPath);

        // --- Tahap 4: Kirim respon ke client ---
        console.log(`[${jobId}] Sukses! URL hasil: ${publicUrl}`);
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
            message: 'Terjadi kesalahan saat memproses audio.',
            details: error.message
        });
    } finally {
        // --- Bersihkan file sementara ---
        console.log(`[${jobId}] Tahap Akhir: Bersih-bersih...`);
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
    }
});

// Jalankan server lokal
app.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`);
});

export default app;
