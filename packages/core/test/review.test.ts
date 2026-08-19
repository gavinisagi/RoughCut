import { describe, expect, it } from "vitest";
import {
  applyVerdicts,
  llmReview,
  parseVerdicts,
  ruleReview,
  textSimilarity,
} from "../src/review.js";
import { alignTranscript } from "../src/transcribe.js";
import type { SpeechSegment } from "../src/types.js";

function seg(id: number, start: number, end: number, text: string | null): SpeechSegment {
  return { id, start, end, text, dropped: false };
}

describe("textSimilarity", () => {
  it("identical Chinese text scores 1", () => {
    expect(textSimilarity("今天我们来聊聊粗剪", "今天我们来聊聊粗剪")).toBe(1);
  });

  it("retake with minor variation scores high", () => {
    const a = "这个功能的核心是把停顿收紧到目标间隔";
    const b = "这个功能的核心，是把停顿收紧到目标间隔。";
    expect(textSimilarity(a, b)).toBeGreaterThan(0.8);
  });

  it("unrelated text scores low", () => {
    expect(textSimilarity("今天天气不错", "我们聊聊音频检测的原理")).toBeLessThan(0.2);
  });

  it("empty or null-ish text scores 0", () => {
    expect(textSimilarity("", "abc")).toBe(0);
  });
});

describe("ruleReview", () => {
  it("flags the earlier take of a retake pair", () => {
    const segments = [
      seg(1, 0, 3, "大家好今天我们聊一聊自动粗剪这个话题"),
      seg(2, 3.5, 6.5, "大家好，今天我们聊一聊自动粗剪这个话题。"),
      seg(3, 7, 10, "首先说说为什么要做这个工具"),
    ];
    const verdicts = ruleReview(segments);
    expect(verdicts.find((v) => v.id === 1)?.verdict).toBe("drop");
    expect(verdicts.find((v) => v.id === 2)?.verdict).toBe("keep");
    expect(verdicts.find((v) => v.id === 3)?.verdict).toBe("keep");
  });

  it("keeps everything when no repetition exists", () => {
    const segments = [seg(1, 0, 3, "第一段内容"), seg(2, 4, 7, "完全不同的第二段")];
    expect(ruleReview(segments).every((v) => v.verdict === "keep")).toBe(true);
  });
});

describe("parseVerdicts", () => {
  it("extracts a fenced JSON array and filters unknown ids/verdicts", () => {
    const raw = '好的，结果如下：\n```json\n[{"id":1,"verdict":"drop","reason":"重说"},{"id":99,"verdict":"drop","reason":"x"},{"id":2,"verdict":"maybe","reason":"x"},{"id":3,"verdict":"keep","reason":""}]\n```';
    const out = parseVerdicts(raw, new Set([1, 2, 3]));
    expect(out).toEqual([
      { id: 1, verdict: "drop", reason: "重说" },
      { id: 3, verdict: "keep", reason: "" },
    ]);
  });

  it("throws when no array is present", () => {
    expect(() => parseVerdicts("抱歉我无法处理", new Set([1]))).toThrow();
  });
});

describe("llmReview (mock fetcher)", () => {
  it("posts to /chat/completions and parses the reply", async () => {
    const segments = [seg(1, 0, 3, "一段"), seg(2, 4, 7, "二段")];
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fetcher = async (url: string, init?: RequestInit) => {
      captured = { url, body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: '[{"id":1,"verdict":"drop","reason":"重复"},{"id":2,"verdict":"keep","reason":""}]' } },
          ],
        }),
        { status: 200 },
      );
    };
    const verdicts = await llmReview(
      segments,
      { baseUrl: "https://api.example.com/v1/", apiKey: "k", model: "test-model" },
      fetcher,
    );
    expect(captured!.url).toBe("https://api.example.com/v1/chat/completions");
    expect(captured!.body.model).toBe("test-model");
    expect(verdicts).toEqual([
      { id: 1, verdict: "drop", reason: "重复" },
      { id: 2, verdict: "keep", reason: "" },
    ]);
  });

  it("surfaces HTTP errors", async () => {
    const fetcher = async () => new Response("quota exceeded", { status: 429 });
    await expect(
      llmReview([seg(1, 0, 1, "x")], { baseUrl: "http://x", apiKey: "k", model: "m" }, fetcher),
    ).rejects.toThrow(/429/);
  });
});

describe("applyVerdicts", () => {
  it("writes verdicts onto matching segments only", () => {
    const segments = [seg(1, 0, 1, "a"), seg(2, 2, 3, "b")];
    const out = applyVerdicts(segments, [{ id: 2, verdict: "drop", reason: "r" }]);
    expect(out[0].verdict).toBeUndefined();
    expect(out[1].verdict).toBe("drop");
    expect(out[1].reason).toBe("r");
  });
});

describe("alignTranscript", () => {
  const segments = [seg(1, 0, 2, null), seg(2, 3.5, 5.5, null), seg(3, 6.3, 8.3, null)];

  it("assigns whisper pieces to the max-overlap segment", () => {
    const whisper = [
      { start: 0.1, end: 1.9, text: "第一段" },
      { start: 3.6, end: 4.4, text: "第二段前半" },
      { start: 4.4, end: 5.4, text: "第二段后半" },
      { start: 6.4, end: 8.2, text: "第三段" },
    ];
    const out = alignTranscript(whisper, segments);
    expect(out[0].text).toBe("第一段");
    expect(out[1].text).toBe("第二段前半第二段后半");
    expect(out[2].text).toBe("第三段");
  });

  it("snaps non-overlapping pieces to the nearest segment by midpoint", () => {
    // Piece midpoint 2.7: distance 1.7 to segment 1 (mid 1.0) vs 1.8 to
    // segment 2 (mid 4.5) -> belongs to segment 1.
    const whisper = [{ start: 2.4, end: 3.0, text: "漂移的词" }];
    const out = alignTranscript(whisper, segments);
    expect(out[0].text).toBe("漂移的词");
  });

  it("leaves untexted segments null", () => {
    const out = alignTranscript([], segments);
    expect(out.every((s) => s.text === null)).toBe(true);
  });
});
