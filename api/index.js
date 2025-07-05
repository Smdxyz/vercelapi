import express from 'express';
import got from 'got';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { writeFile, unlink, stat } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const app = express();
const PORT = process.env.PORT || 8080;
ffmpeg.setFfmpegPath(ffmpegStatic);

// --- Fungsi Upload ke Catbox ---
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

// --- Endpoint API ---
app.get('/', async (req, res) => {
    const audioUrl = req.query.url;
    if (!audioUrl) {
        return res.status(400).json({
            status: 'error',
            message: 'Parameter ?url= wajib ada'
        });
    }

    const jobId = randomUUID();
    const inputPath = path.join('/tmp', `${jobId}_input.mp3`);
    const outputPath = path.join('/tmp', `${jobId}_output.m4a`);

    console.log(`\n[${jobId}] Memulai proses untuk URL: ${audioUrl}`);

    try {
        // === Tahap 1: Download File ===
        console.log(`[${jobId}] Tahap 1: Mendownload file dengan got...`);
        const buffer = await got(audioUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': 'https://cloudkuimages.com/',
                'Origin': 'https://cloudkuimages.com',
                'Accept': '*/*'
            },
            responseType: 'buffer',
            http2: true,
            retry: { limit: 0 }
        }).buffer();

        await writeFile(inputPath, buffer);
        const fileStats = await stat(inputPath);
        console.log(`[${jobId}] File disimpan (${(fileStats.size / 1024).toFixed(2)} KB)`);

        if (fileStats.size < 1024) {
            throw new Error('File terlalu kecil, kemungkinan bukan audio valid.');
        }

        // === Tahap 2: Konversi dengan FFmpeg ===
        console.log(`[${jobId}] Tahap 2: Konversi dengan FFmpeg...`);
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .inputFormat('mp3') // paksa baca sebagai mp3
                .outputOptions(['-c:a aac', '-b:a 96k'])
                .save(outputPath)
                .on('start', (cmd) => {
                    console.log(`[${jobId}] FFmpeg CMD: ${cmd}`);
                })
                .on('end', () => {
                    console.log(`[${jobId}] Konversi selesai ✅`);
                    resolve();
                })
                .on('error', (err) => {
                    reject(new Error(`FFmpeg error: ${err.message}`));
                });
        });

        // === Tahap 3: Upload ke Catbox ===
        console.log(`[${jobId}] Tahap 3: Upload ke Catbox...`);
        const publicUrl = await uploadToCatbox(outputPath);

        // === Tahap 4: Kirim Respon ===
        console.log(`[${jobId}] Selesai ✅ Link: ${publicUrl}`);
        res.status(200).json({
            status: 'success',
            message: 'Audio berhasil dikonversi.',
            result: {
                job_id: jobId,
                original_url: audioUrl,
                converted_url: publicUrl
            }
        });

    } catch (error) {
        console.error(`[${jobId}] GAGAL ❌:`, error.message);
        res.status(500).json({
            status: 'error',
            job_id: jobId,
            message: 'Terjadi kesalahan saat memproses audio.',
            details: error.message
        });
    } finally {
        // === Tahap Akhir: Cleanup ===
        console.log(`[${jobId}] Tahap Akhir: Bersih-bersih...`);
        await unlink(inputPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
    }
});

// Jalankan server
app.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`);
});

export default app;
