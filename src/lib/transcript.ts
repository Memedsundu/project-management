/**
 * Teams and Zoom export transcripts as WebVTT or SRT: cue numbers, time codes
 * and <v Speaker> tags around every line. This turns them into plain
 * "Speaker: text" lines, joining consecutive lines of the same speaker, so a
 * one-hour call stays short enough to read and to send to Claude.
 */
export function cleanTranscript(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const looksTimed = /^WEBVTT/m.test(text) || /\d{2}:\d{2}(:\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}/.test(text);
  if (!looksTimed) return text.trim();

  const out: { speaker: string | null; text: string }[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const body: string[] = [];
    for (const line of lines) {
      if (/^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) break;
      if (/-->/.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^[0-9a-f-]{8,}(\/\d+-\d+)?$/i.test(line)) continue; // Teams cue ids
      body.push(line);
    }
    if (!body.length) continue;
    let joined = body.join(" ");
    let speaker: string | null = null;
    const voice = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(joined);
    if (voice) speaker = voice[1]!.trim();
    joined = joined.replace(/<\/?v[^>]*>/g, "").replace(/<[^>]+>/g, "").trim();
    if (!speaker) {
      const named = /^([\p{L}][\p{L} .'-]{1,60}):\s+(.*)$/u.exec(joined);
      if (named) {
        speaker = named[1]!.trim();
        joined = named[2]!;
      }
    }
    if (!joined) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text += ` ${joined}`;
    else out.push({ speaker, text: joined });
  }
  return out.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join("\n");
}
