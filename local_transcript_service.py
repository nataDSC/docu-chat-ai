#!/usr/bin/env python3
"""Local YouTube transcript service (RapidAPI-free).

Run:
  python3 local_transcript_service.py --port 5055

Endpoints:
  GET  /health
  POST /transcript
"""

from __future__ import annotations

import argparse
import re
from typing import Iterable
from urllib.parse import parse_qs, urlparse

from flask import Flask, jsonify, request
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

app = Flask(__name__)

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""

    if VIDEO_ID_RE.match(value):
        return value

    try:
        parsed = urlparse(value)
    except Exception:
        return ""

    host = parsed.netloc.lower().replace("www.", "")

    if host in {"youtu.be"}:
        candidate = parsed.path.strip("/").split("/")[0]
        return candidate if VIDEO_ID_RE.match(candidate) else ""

    if host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path == "/watch":
            query = parse_qs(parsed.query)
            candidate = (query.get("v") or [""])[0]
            return candidate if VIDEO_ID_RE.match(candidate) else ""

        if parsed.path.startswith("/shorts/"):
            candidate = parsed.path.split("/shorts/")[-1].split("/")[0]
            return candidate if VIDEO_ID_RE.match(candidate) else ""

        if parsed.path.startswith("/embed/"):
            candidate = parsed.path.split("/embed/")[-1].split("/")[0]
            return candidate if VIDEO_ID_RE.match(candidate) else ""

    return ""


def normalize_languages(raw_value: object) -> list[str]:
    if isinstance(raw_value, list):
        values = [str(v).strip() for v in raw_value]
    elif isinstance(raw_value, str):
        values = [v.strip() for v in raw_value.split(",")]
    else:
        values = []

    cleaned = [v for v in values if v]
    return cleaned or ["en", "en-US"]


def transcript_to_text(items: Iterable[dict]) -> str:
    lines = []
    for item in items:
        text = str(item.get("text", "")).strip()
        if text:
            lines.append(text)
    return "\n".join(lines).strip()


@app.get("/health")
def health() -> tuple[dict, int]:
    return {"ok": True, "service": "local-transcript-service"}, 200


@app.post("/transcript")
def transcript() -> tuple[dict, int]:
    body = request.get_json(silent=True) or {}

    raw_url = (
        body.get("videoUrl")
        or body.get("video_url")
        or body.get("url")
        or body.get("youtubeUrl")
        or ""
    )

    video_id = extract_video_id(str(raw_url))
    if not video_id:
        return {
            "ok": False,
            "error": "Invalid or missing YouTube video URL/id.",
            "received": str(raw_url),
        }, 400

    languages = normalize_languages(body.get("languages"))

    try:
        result = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        text = transcript_to_text(result)

        if not text:
            return {
                "ok": False,
                "error": "Transcript API returned empty transcript text.",
                "videoId": video_id,
            }, 502

        return {
            "ok": True,
            "videoId": video_id,
            "transcript": text,
            "lineCount": len(text.splitlines()),
            "languagesRequested": languages,
        }, 200

    except TranscriptsDisabled:
        return {
            "ok": False,
            "error": "Transcripts are disabled for this video.",
            "videoId": video_id,
        }, 404
    except NoTranscriptFound:
        return {
            "ok": False,
            "error": "No transcript found for requested languages.",
            "videoId": video_id,
            "languagesRequested": languages,
        }, 404
    except VideoUnavailable:
        return {
            "ok": False,
            "error": "Video unavailable.",
            "videoId": video_id,
        }, 404
    except Exception as exc:  # pragma: no cover
        return {
            "ok": False,
            "error": f"Transcript fetch failed: {exc}",
            "videoId": video_id,
        }, 500


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=5055)
    args = parser.parse_args()

    app.run(host=args.host, port=args.port)
