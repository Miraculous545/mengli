#!/usr/bin/env python
"""梦璃 QQ 媒体解析 CLI：输入链接或文本，输出可发送的媒体文件 JSON。

用法：
  python parse_media.py --url "https://www.bilibili.com/video/BV..."
  python parse_media.py --text "看看这个 https://..."
  python parse_media.py --list-platforms

本文件是适配层；实际解析/下载核心来自 vendor/astrbot_plugin_media_parser
（AGPLv3，见 vendor 内 LICENSE 与 README.upstream.md）。
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import sys
import time
import traceback
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, "vendor", "astrbot_plugin_media_parser")
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

import aiohttp  # noqa: E402

from run_local import create_local_parsers, format_supported_platforms  # noqa: E402

from core.constants import Config  # noqa: E402
from core.downloader import DownloadManager  # noqa: E402
from core.downloader.utils import check_cache_dir_available  # noqa: E402
from core.parser import ParserManager  # noqa: E402


def cleanup_old_files(cache_dir: str, max_age_hours: float) -> None:
    """清理缓存目录中超过指定时长的旧文件，避免占满磁盘。"""
    if max_age_hours <= 0 or not os.path.isdir(cache_dir):
        return
    cutoff = time.time() - max_age_hours * 3600
    for root, _, files in os.walk(cache_dir):
        if os.path.basename(root) == Config.RUNTIME_DIR_NAME:
            continue
        for name in files:
            path = os.path.join(root, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass


def build_text(metadata: Dict[str, Any]) -> str:
    """把解析元数据拼成给 agent/用户看的简短文本。"""
    parts: List[str] = []
    title = str(metadata.get("title") or "").strip()
    author = str(metadata.get("author") or "").strip()
    desc = str(metadata.get("desc") or "").strip()
    if title:
        parts.append(title)
    if author:
        parts.append(f"作者：{author}")
    if desc:
        parts.append(desc[:500])
    return "\n".join(parts)


def collect_files(metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    """按 DownloadManager 的 file_paths 顺序还原视频/图片/音频类型。"""
    video_count = int(metadata.get("video_count") or 0)
    image_count = int(metadata.get("image_count") or 0)
    paths = metadata.get("file_paths") or []
    files: List[Dict[str, Any]] = []
    for index, path in enumerate(paths):
        if not path or not os.path.isfile(path):
            continue
        if index < video_count:
            kind = "video"
        elif index < video_count + image_count:
            kind = "image"
        else:
            kind = "audio"
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        files.append({
            "type": kind,
            "path": os.path.abspath(path),
            "name": os.path.basename(path),
            "size": size,
        })
    return files


def collect_skips(metadata: Dict[str, Any]) -> List[str]:
    """汇总下载阶段跳过/失败原因。"""
    skipped: List[str] = []
    for key, label in (
        ("video_skip_reasons", "视频"),
        ("image_skip_reasons", "图片"),
        ("audio_skip_reasons", "音频"),
    ):
        for reason in metadata.get(key) or []:
            if reason:
                skipped.append(f"{label}：{reason}")
    if metadata.get("error"):
        skipped.append(str(metadata.get("error")))
    return skipped


def build_result(
    metadata: Dict[str, Any],
    files: List[Dict[str, Any]],
    platforms: List[str],
) -> Dict[str, Any]:
    """构造 CLI 的最终 JSON。"""
    return {
        "ok": not bool(metadata.get("error")),
        "platform": metadata.get("platform") or metadata.get("parser_name") or "",
        "title": metadata.get("title") or "",
        "author": metadata.get("author") or "",
        "description": metadata.get("desc") or "",
        "timestamp": metadata.get("timestamp") or "",
        "sourceUrl": metadata.get("source_url") or metadata.get("url") or "",
        "text": build_text(metadata),
        "files": files,
        "mediaAvailable": bool(files),
        "skipped": collect_skips(metadata),
        "platforms": platforms,
        "error": metadata.get("error"),
    }


async def parse_once(args: argparse.Namespace) -> Dict[str, Any]:
    """执行一次解析与下载。"""
    cache_dir = os.path.abspath(args.out)
    os.makedirs(cache_dir, exist_ok=True)
    cleanup_old_files(cache_dir, args.max_age_hours)
    cache_available = check_cache_dir_available(cache_dir)

    bilibili_runtime = Config.build_runtime_dir(cache_dir, "bilibili")
    os.makedirs(bilibili_runtime, exist_ok=True)
    bilibili_cookie_file = os.path.join(bilibili_runtime, "cookie.json")

    parsers = create_local_parsers(
        use_proxy=False,
        proxy_url=None,
        cache_dir_available=cache_available,
        bilibili_cookie_runtime_file=bilibili_cookie_file,
    )
    if args.bili_max_qn > 0:
        for parser in parsers:
            if getattr(parser, "name", "") == "bilibili" and hasattr(parser, "max_qn"):
                parser.max_qn = args.bili_max_qn
    platforms = [parser.name for parser in parsers]
    manager = ParserManager(parsers)

    text = (args.text or args.url or "").strip()
    links = manager.extract_all_links(text)
    if not links:
        return {
            "ok": False,
            "error": "no supported link",
            "text": "",
            "files": [],
            "mediaAvailable": False,
            "platforms": platforms,
        }

    links = links[: max(1, args.max_links)]
    connector = aiohttp.TCPConnector(
        limit=100,
        limit_per_host=10,
        ttl_dns_cache=300,
        force_close=False,
        enable_cleanup_closed=True,
    )
    timeout = aiohttp.ClientTimeout(total=max(10, args.timeout))
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        metadata_list = await manager.parse_text(text, session, links_with_parser=links)
        last_error: Optional[str] = None
        for metadata in metadata_list:
            if metadata.get("error"):
                last_error = str(metadata.get("error"))
                continue
            # README 截图依赖 Playwright，这里不需要，直接去掉
            metadata.pop("readme_url", None)
            metadata.pop("readme_selector", None)
            # 控制 QQ 侧数量和体积
            metadata["video_urls"] = list(metadata.get("video_urls") or [])[:1]
            metadata["image_urls"] = list(metadata.get("image_urls") or [])[: max(0, args.max_images)]
            metadata["audio_urls"] = list(metadata.get("audio_urls") or [])[:1]
            covers = list(metadata.get("video_cover_urls") or [])
            if covers:
                metadata["video_cover_urls"] = covers[:1]
            metadata.pop("content_blocks", None)

            if args.metadata_only:
                return build_result(metadata, [], platforms)

            download_manager = DownloadManager(
                max_video_size_mb=max(0.0, args.max_video_mb),
                max_audio_size_mb=max(0.0, args.max_audio_mb),
                large_video_threshold_mb=50.0,
                cache_dir=cache_dir,
                cache_dir_available=cache_available,
                max_concurrent_downloads=3,
                video_cover_only=False,
                readme_paginate=False,
            )
            try:
                processed = await download_manager.process_metadata(
                    session, metadata, proxy_addr=None
                )
            finally:
                await download_manager.shutdown()

            files = collect_files(processed)
            result = build_result(processed, files, platforms)
            if files:
                return result
            if not last_error:
                last_error = "no media downloaded"
            else:
                result["error"] = last_error
            # 继续尝试下一个链接
        return {
            "ok": False,
            "error": last_error or "parse failed",
            "text": "",
            "files": [],
            "mediaAvailable": False,
            "platforms": platforms,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="梦璃 QQ 媒体解析 CLI")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", help="单个媒体链接")
    group.add_argument("--text", help="包含媒体链接的文本")
    group.add_argument("--list-platforms", action="store_true", help="列出支持的平台")
    parser.add_argument("--out", default=os.path.join(HERE, "..", "runtime", "media-cache"),
                        help="媒体缓存目录")
    parser.add_argument("--max-video-mb", type=float, default=50.0)
    parser.add_argument("--bili-max-qn", type=int, default=int(os.environ.get("QQBOT_MEDIA_BILI_MAX_QN", "32")),
                        help="B站最大画质 qn（16=360P 32=480P 64=720P 80=1080P；0=不限制）")
    parser.add_argument("--max-audio-mb", type=float, default=20.0)
    parser.add_argument("--max-images", type=int, default=3)
    parser.add_argument("--max-links", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--max-age-hours", type=float, default=6.0)
    parser.add_argument("--metadata-only", action="store_true")
    return parser


async def async_main(args: argparse.Namespace) -> Dict[str, Any]:
    if args.list_platforms:
        cache_dir = os.path.abspath(args.out)
        os.makedirs(cache_dir, exist_ok=True)
        cache_available = check_cache_dir_available(cache_dir)
        bilibili_runtime = Config.build_runtime_dir(cache_dir, "bilibili")
        os.makedirs(bilibili_runtime, exist_ok=True)
        parsers = create_local_parsers(
            use_proxy=False,
            proxy_url=None,
            cache_dir_available=cache_available,
            bilibili_cookie_runtime_file=os.path.join(bilibili_runtime, "cookie.json"),
        )
        return {"ok": True, "platforms": [parser.name for parser in parsers]}
    return await parse_once(args)


def main() -> int:
    args = build_parser().parse_args()
    real_stdout = sys.stdout
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(async_main(args))
    except KeyboardInterrupt:
        result = {"ok": False, "error": "interrupted"}
    except Exception as error:  # noqa: BLE001 - CLI 边界统一输出
        traceback.print_exc(file=sys.stderr)
        result = {"ok": False, "error": str(error)}
    real_stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
