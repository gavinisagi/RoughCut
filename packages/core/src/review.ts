/**
 * Segment review: recommend which speech segments to drop.
 * - LLM path: any OpenAI-compatible /chat/completions endpoint (DeepSeek,
 *   Qwen, Ollama, OpenAI, ...). Config = { baseUrl, apiKey, model }.
 * - Fallback path (no LLM configured): neighbour-similarity rule that catches
 *   the most common retake pattern ("say it wrong, pause, say it again").
 * Review only recommends; dropping is always the user's call.
 */
import type { SegmentVerdict, SpeechSegment } from "./types.js";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface VerdictItem {
  id: number;
  verdict: SegmentVerdict;
  reason: string;
}

/** Strip whitespace/punctuation for robust text comparison. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  if (text.length === 1) set.add(text);
  return set;
}

/** Jaccard similarity of character bigrams, 0..1. Pure function. */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  const sa = bigrams(na);
  const sb = bigrams(nb);
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const SIMILARITY_DROP = 0.55;

/**
 * Rule-based review: when a segment is highly similar to the NEXT one, the
 * earlier take is the discarded draft (retakes keep the last delivery).
 */
export function ruleReview(segments: SpeechSegment[]): VerdictItem[] {
  const verdicts: VerdictItem[] = [];
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const next = segments[i + 1];
    if (cur.text && next?.text) {
      const sim = textSimilarity(cur.text, next.text);
      if (sim >= SIMILARITY_DROP) {
        verdicts.push({
          id: cur.id,
          verdict: "drop",
          reason: `与下一段重复度 ${(sim * 100).toFixed(0)}%（疑似重说）`,
        });
        continue;
      }
    }
    verdicts.push({ id: cur.id, verdict: "keep", reason: "" });
  }
  return verdicts;
}

const SYSTEM_PROMPT = `你是口播视频的剪辑助手。用户逐段朗读稿件录制口播，素材已按停顿切分为段。常见问题：说错后停顿重说（前一遍是废弃草稿）、内容与相邻段重复、某段表达明显不通顺或中途中断。

请逐段判断：
- "drop"：建议删除（重说的废弃草稿、明显中断、与相邻段高度重复）
- "review"：存疑，建议用户试听后决定
- "keep"：保留

规则：
1. 相邻两段内容高度相似时，删前面的、保留后面的（重说场景最后一遍才是定稿）。
2. 只有把握较大时才给 drop；轻微口语瑕疵、语气词给 keep。
3. reason 用中文，不超过 20 字。
4. 只输出严格 JSON 数组，形如 [{"id":1,"verdict":"keep","reason":""}]，不要输出任何其他内容。`;

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function buildReviewPrompt(segments: SpeechSegment[]): string {
  const lines = segments.map(
    (s) => `#${s.id} [${fmtClock(s.start)}-${fmtClock(s.end)}] ${s.text ?? "(无文本)"}`,
  );
  return `以下是口播的分段转录，请审查每一段：\n\n${lines.join("\n")}`;
}

/** Extract the first JSON array from an LLM response (tolerates fences/prose). */
export function parseVerdicts(raw: string, knownIds: Set<number>): VerdictItem[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("LLM 输出中未找到 JSON 数组");
  const arr = JSON.parse(raw.slice(start, end + 1)) as Array<Record<string, unknown>>;
  const out: VerdictItem[] = [];
  for (const item of arr) {
    const id = Number(item.id);
    const verdict = String(item.verdict) as SegmentVerdict;
    if (!knownIds.has(id)) continue;
    if (verdict !== "keep" && verdict !== "drop" && verdict !== "review") continue;
    out.push({ id, verdict, reason: typeof item.reason === "string" ? item.reason : "" });
  }
  return out;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Review via any OpenAI-compatible chat endpoint. */
export async function llmReview(
  segments: SpeechSegment[],
  config: LlmConfig,
  fetcher: FetchLike = fetch,
): Promise<VerdictItem[]> {
  const withText = segments.filter((s) => s.text);
  if (withText.length === 0) throw new Error("没有可审查的转录文本，请先转录");

  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildReviewPrompt(withText) },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 返回为空");
  return parseVerdicts(content, new Set(withText.map((s) => s.id)));
}

/** Write verdicts back onto segments (missing ids keep their old state). */
export function applyVerdicts(
  segments: SpeechSegment[],
  verdicts: VerdictItem[],
): SpeechSegment[] {
  const map = new Map(verdicts.map((v) => [v.id, v]));
  return segments.map((s) => {
    const v = map.get(s.id);
    return v ? { ...s, verdict: v.verdict, reason: v.reason || undefined } : s;
  });
}
