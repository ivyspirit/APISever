import { Router } from "express";
import multer from "multer";
import type { Logger } from "../logger.js";
import { sendError } from "../http.js";
import type { SttService } from "../voice/SttService.js";

// Audio is small; keep it in memory and hand the buffer straight to the service.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * POST /stt — multipart/form-data with an `audio` field. Proxies the clip to
 * the SttService (OpenAI Whisper) and returns { text }. The client shows this
 * text as the Intent Confirmation step before calling /turn (the STT safety net).
 */
export function sttRouter(stt: SttService, log: Logger): Router {
  const router = Router();

  router.post("/stt", upload.single("audio"), async (req, res) => {
    const file = req.file;
    if (!file || file.size === 0) {
      log.warn("rejected stt", { reason: "missing audio" });
      return sendError(res, 400, "bad_audio", "missing or unreadable audio");
    }

    log.info("stt", { bytes: file.size, mimeType: file.mimetype, name: file.originalname });
    try {
      const text = await stt.transcribe(file.buffer, file.originalname, file.mimetype);
      return res.json({ text });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "unknown";
      log.error("stt failed", { detail });
      return sendError(res, 502, "stt_failed", "transcription service error");
    }
  });

  return router;
}
