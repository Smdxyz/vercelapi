import express from 'express';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 8080;
ffmpeg.setFfmpegPath(ffmpegStatic);

// --- Fungsi upload ke Catbox ---
async function uploadToCatbox(filePath) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', createReadStream(filePath));

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 60000
    });

    if (res.status === 200 && res.data.startsWith('http')) {
        return res.data;
    }
    throw new Error('Gagal upload ke Catbox');
}

// --- Endpoint utama ---
app.get('/', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl || !ytdl.validateURL(videoUrl)) {
        return res.status(400).json({ status: 'error', message: 'Masukkan URL YouTube yang valid di ?url=' });
    }

    const jobId = randomUUID();
    const tmpOutput = path.join('/tmp', `${jobId}.m4a`);

    console.log(`\n[${jobId}] Mulai proses untuk: ${videoUrl}`);

    try {
        // === Tahap 1: Ambil audio stream dari YouTube ===
        const stream = ytdl(videoUrl, { quality: 'highestaudio' });

        // === Tahap 2: Konversi ke M4A ===
        console.log(`[${jobId}] Mengonversi ke M4A...`);
        await new Promise((resolve, reject) => {
            ffmpeg(stream)
                .audioCodec('aac')
                .audioBitrate(96)
                .format('ipod') // = M4A
                .save(tmpOutput)
                .on('start', cmd => console.log(`[${jobId}] FFmpeg CMD: ${cmd}`))
                .on('end', resolve)
                .on('error', err => reject(new Error(`FFmpeg error: ${err.message}`)));
        });

        // === Tahap 3: Upload ke Catbox ===
        console.log(`[${jobId}] Mengupload ke Catbox...`);
        const uploadedUrl = await uploadToCatbox(tmpOutput);

        // === Kirim hasil ===
        console.log(`[${jobId}] Berhasil ✅ ${uploadedUrl}`);
        res.json({
            status: 'success',
            result: {
                job_id: jobId,
                original: videoUrl,
                converted_url: uploadedUrl
            }
        });

    } catch (err) {
        console.error(`[${jobId}] GAGAL ❌:`, err.message);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        // Cleanup
        await unlink(tmpOutput).catch(() => {});
    }
});

app.listen(PORT, () => {
    console.log(`Server jalan di http://localhost:${PORT}`);
});

export default app;
