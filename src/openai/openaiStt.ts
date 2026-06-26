import OpenAI, { toFile } from "openai";
import type { Logger } from "../logger.js";
import type { SttService } from "../voice/SttService.js";

/**
 * OpenAI Whisper-backed transcription. A pure pass-through: holds no state.
 */
export class OpenAISttService implements SttService {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
    private readonly log: Logger,
  ) {}

  async transcribe(audio: Buffer, filename: string, mimeType: string): Promise<string> {
    this.log.info("stt transcribe", { model: this.model, bytes: audio.length, mimeType });
    const file = await toFile(audio, filename || "audio.m4a", { type: mimeType || "audio/m4a" });
    const result = await this.openai.audio.transcriptions.create({ file, model: this.model });
    return result.text?.trim() ?? "";
  }
}

export function createOpenAISttService(apiKey: string, model: string, log: Logger): OpenAISttService {
  return new OpenAISttService(new OpenAI({ apiKey }), model, log);
}
