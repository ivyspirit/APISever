import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { sttRouter } from "../src/routes/stt.js";
import type { SttService } from "../src/voice/SttService.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => noopLogger };

function appWith(stt: SttService) {
  const app = express();
  app.use(sttRouter(stt, noopLogger));
  return app;
}

const okStt: SttService = { async transcribe() { return "add a doc comment to signup"; } };
const emptyStt: SttService = { async transcribe() { return ""; } };
const failingStt: SttService = {
  async transcribe() {
    throw new Error("whisper exploded");
  },
};

describe("POST /stt", () => {
  it("400 bad_audio when no audio field is provided", async () => {
    const res = await request(appWith(okStt)).post("/stt");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "bad_audio", message: "missing or unreadable audio" } });
  });

  it("200 { text } for a valid clip", async () => {
    const res = await request(appWith(okStt))
      .post("/stt")
      .attach("audio", Buffer.from("fake-audio-bytes"), "clip.m4a");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "add a doc comment to signup" });
  });

  it("200 { text: '' } for unintelligible audio", async () => {
    const res = await request(appWith(emptyStt))
      .post("/stt")
      .attach("audio", Buffer.from("noise"), "clip.m4a");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "" });
  });

  it("502 stt_failed when the service throws", async () => {
    const res = await request(appWith(failingStt))
      .post("/stt")
      .attach("audio", Buffer.from("bytes"), "clip.m4a");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: { code: "stt_failed", message: "transcription service error" } });
  });
});
