/**
 * Speech-to-text seam. The route depends only on this, so OpenAI Whisper is
 * swappable (or stubbable in tests) without touching the endpoint. The key
 * lives only on the server — the client never holds a credential, so STT is
 * proxied here.
 */
export interface SttService {
  /** Transcribe an audio clip to text. Returns "" for unintelligible audio. */
  transcribe(audio: Buffer, filename: string, mimeType: string): Promise<string>;
}
