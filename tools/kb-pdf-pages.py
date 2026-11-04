#!/usr/bin/env python3
"""把 PDF 拆成逐页 PNG，并顺手读出文字层（文本页可跳过 OCR）。

由解析服务的固定适配器调用：参数全部由程序构造，不接受模型给出的命令。
输出：最后一行是 JSON（stdout），诊断信息走 stderr。

  python kb-pdf-pages.py --pdf <path> --outdir <dir> [--dpi 150] [--max-pages 40]
  → {"pages":[{"page":1,"image":"...png","text":"...","textChars":12}],
     "pageCount":2,"rendered":2,"truncated":false,"dpi":150}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover
    try:
        import fitz as pymupdf  # type: ignore
    except ImportError:
        print(json.dumps({"error": "PyMuPDF not available in this interpreter"}))
        sys.exit(3)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--max-pages", type=int, default=40)
    args = ap.parse_args()

    pdf = Path(args.pdf)
    out = Path(args.outdir)
    if not pdf.is_file():
        print(json.dumps({"error": f"pdf not found: {pdf}"}, ensure_ascii=False))
        return 2
    out.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(str(pdf))
    try:
        total = doc.page_count
        limit = max(1, min(args.max_pages, total))
        pages = []
        zoom = args.dpi / 72.0
        matrix = pymupdf.Matrix(zoom, zoom)
        for idx in range(limit):
            page = doc.load_page(idx)
            text = page.get_text("text") or ""
            image_path = out / f"p{idx + 1:04d}.png"
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pix.save(str(image_path))
            pages.append(
                {
                    "page": idx + 1,
                    "image": str(image_path),
                    "text": text,
                    "textChars": len(text.strip()),
                }
            )
        payload = {
            "pages": pages,
            "pageCount": total,
            "rendered": len(pages),
            "truncated": limit < total,
            "dpi": args.dpi,
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    finally:
        doc.close()


if __name__ == "__main__":
    sys.exit(main())
