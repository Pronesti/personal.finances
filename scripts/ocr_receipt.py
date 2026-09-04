#!/usr/bin/env python3
"""
Apple Vision OCR for receipt scans.

Usage:
    ocr_receipt.py IMAGE [IMAGE...]

Output: one JSON object per recognised text box, one per line, in no particular order:
    {"page": 1, "x": 0.062, "y": 0.2376, "w": 0.31, "h": 0.009, "text": "VERDURAS GRILLADAS COTOX KG"}
x, y, w, h are fractions of the image; the origin is the top-left corner. `page` is the 1-based
position of the image in argv.

Exit codes: 0 ok; 2 an image could not be read or Vision failed on it; 3 Vision is not available
(not macOS, or the pyobjc frameworks are not installed) - the caller turns that into setup advice.

The receipt is Spanish, but language correction is OFF on purpose: it "fixes" product codes and
abbreviations into words. Recognition languages only steer the character set.
"""

from __future__ import annotations

import json
import sys

try:
    import Quartz
    import Vision
    from Foundation import NSURL
except ImportError as e:  # pragma: no cover - exercised only off macOS
    print(f"VISION UNAVAILABLE: {e}", file=sys.stderr)
    sys.exit(3)


def recognise(path: str, page: int):
    url = NSURL.fileURLWithPath_(path)
    source = Quartz.CGImageSourceCreateWithURL(url, None)
    if source is None:
        raise RuntimeError(f"cannot read image {path}")
    image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)
    if image is None:
        raise RuntimeError(f"cannot decode image {path}")
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(False)
    request.setRecognitionLanguages_(["es-ES", "en-US"])
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image, None)
    ok, error = handler.performRequests_error_([request], None)
    if not ok:
        raise RuntimeError(f"Vision failed on {path}: {error}")
    for observation in request.results() or []:
        candidates = observation.topCandidates_(1)
        if not candidates:
            continue
        box = observation.boundingBox()
        # Vision's origin is bottom-left; the parser thinks top-down like the receipt.
        yield {
            "page": page,
            "x": round(box.origin.x, 5),
            "y": round(1.0 - box.origin.y - box.size.height, 5),
            "w": round(box.size.width, 5),
            "h": round(box.size.height, 5),
            "text": candidates[0].string(),
        }


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: ocr_receipt.py IMAGE [IMAGE...]", file=sys.stderr)
        return 2
    for page, path in enumerate(argv, start=1):
        for box in recognise(path, page):
            print(json.dumps(box, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:
        print(f"READ ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(2)
