#!/usr/bin/env python3
"""Bounded native macOS receipt rendering/OCR; JSON-lines private phase protocol."""
from __future__ import annotations
import fcntl
import json
import math
import os
from pathlib import Path
import resource
import sys
import tempfile
import time

MAX_PAGES = 20
MAX_PAGE_PIXELS = 16_000_000
MAX_DOCUMENT_PIXELS = 64_000_000
MAX_CHUNK_PIXELS = 4_000_000
MAX_CHUNKS = 160
MAX_TEMP_BYTES = 512 * 1024 * 1024
MAX_BOXES = 20000

def emit(event):
    print(json.dumps(event, ensure_ascii=False, allow_nan=False), flush=True)

def plans(width, height):
    count = max(1, math.ceil(height / width / 1.5))
    step = height / count
    overlap = step * 0.08 if count > 1 else 0
    return [(max(0, round(i * step - overlap)), min(height, round((i + 1) * step + overlap))) for i in range(count)]

def owns(slices, index, center):
    start, end = slices[index]
    if index and slices[index-1][1] > start and center < (start + slices[index-1][1])/2:
        return False
    if index+1 < len(slices) and slices[index+1][0] < end and center >= (end+slices[index+1][0])/2:
        return False
    return True

def dedupe(boxes):
    kept=[]
    for box in boxes:
        duplicate=None
        for index, old in enumerate(kept):
            if box['page'] != old['page'] or box['source'] == old['source']:
                continue
            if abs((box['y']+box['h']/2)-(old['y']+old['h']/2)) > max(box['h'],old['h'],0.002)*0.25:
                continue
            overlap=max(0,min(box['x']+box['w'],old['x']+old['w'])-max(box['x'],old['x']))
            if overlap/(min(box['w'],old['w']) or 1)>0.5:
                duplicate=index
                break
        if duplicate is None:
            kept.append(box)
        elif box['score']>kept[duplicate]['score']:
            kept[duplicate]=box
    return [{k:v for k,v in box.items() if k not in ['source','score']} for box in kept]

def main():
    if len(sys.argv)!=5 or sys.platform!='darwin':
        raise RuntimeError('private_macos_arguments_required')
    filename=Path(sys.argv[1]); scale=float(sys.argv[2]); attempt=int(sys.argv[3]); root=Path(sys.argv[4])
    if scale not in [3,2,1.5] or attempt not in [1,2,3] or str(root.resolve())!=str(root) or root.is_symlink() or not root.is_dir() or root.stat().st_mode & 0o077:
        raise RuntimeError('unsafe_processing_context')
    if filename.stat().st_size > 41943040 or filename.open('rb').read(5) != b'%PDF-':
        raise RuntimeError('invalid_receipt_pdf')
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_TEMP_BYTES,MAX_TEMP_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
    resource.setrlimit(resource.RLIMIT_CPU,(600,600))
    import pymupdf
    from ocr_receipt import recognise
    lock=os.open(root/'vision.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix='vision-',dir=root) as directory:
            with pymupdf.open(filename) as document:
                if not 0<len(document)<=MAX_PAGES:
                    raise RuntimeError('render_page_limit')
                total_pixels=0; chunks=0; temp_bytes=0; boxes=[]
                for page_index,page in enumerate(document):
                    width=math.ceil(page.rect.width*scale); height=math.ceil(page.rect.height*scale)
                    total_pixels+=width*height
                    if width<=0 or height<=0 or width*height>MAX_PAGE_PIXELS or total_pixels>MAX_DOCUMENT_PIXELS:
                        raise RuntimeError('render_pixel_limit')
                    for image in page.get_images(full=True):
                        if image[2] * image[3] > MAX_DOCUMENT_PIXELS:
                            raise RuntimeError('embedded_image_pixel_limit')
                    slices=plans(width,height)
                    for slice_index,(y0,y1) in enumerate(slices):
                        chunks+=1
                        if chunks>MAX_CHUNKS or width*(y1-y0)>MAX_CHUNK_PIXELS:
                            raise RuntimeError('render_chunk_limit')
                        clip=pymupdf.Rect(0,y0/scale,page.rect.width,y1/scale)
                        pix=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),clip=clip,colorspace=pymupdf.csRGB,alpha=False)
                        png=Path(directory)/f'{chunks}.png'
                        pix.save(png)
                        temp_bytes+=png.stat().st_size
                        if temp_bytes>MAX_TEMP_BYTES:
                            raise RuntimeError('render_temp_limit')
                        def phase(event):
                            emit({'event':event,'attempt':attempt,'monotonic_ms':time.monotonic_ns()/1_000_000})
                        for box in recognise(str(png),1,phase):
                            center=y0+(box['y']+box['h']/2)*(y1-y0)
                            if not owns(slices,slice_index,center):
                                continue
                            box.update(page=page_index+1,y=(y0+box['y']*(y1-y0))/height,h=box['h']*(y1-y0)/height,source=chunks,score=min(box['y']+box['h']/2,1-box['y']-box['h']/2))
                            boxes.append(box)
                            if len(boxes)>MAX_BOXES:
                                raise RuntimeError('ocr_box_limit')
                        png.unlink()
                        pix=None
                emit({'event':'result','value':dedupe(boxes)})
    finally:
        os.close(lock)

if __name__=='__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        known = {'render_page_limit','render_pixel_limit','embedded_image_pixel_limit','render_chunk_limit','render_temp_limit','ocr_box_limit','unsafe_processing_context','invalid_receipt_pdf'}
        reason = str(error) if isinstance(error, RuntimeError) and str(error) in known else 'processing_failed'
        print(json.dumps({'code':'receipt_processing_failed','kind':type(error).__name__,'reason':reason}),file=sys.stderr)
        sys.exit(2)
