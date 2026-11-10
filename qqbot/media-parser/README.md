# 媒体解析适配层

把 [astrbot_plugin_media_parser](https://github.com/drdon1234/astrbot_plugin_media_parser) 的解析/下载核心接到梦璃的 QQ 桥。

- 适配层：`parse_media.py`（本仓代码），负责非交互 CLI、数量/体积限制、JSON 输出。
- 上游核心：`vendor/astrbot_plugin_media_parser/`，版本 v1.11.3，AGPLv3，见该目录 `LICENSE` 与 `README.upstream.md`。
- 依赖：`requirements-min.txt`（去掉了 README 截图用的 Playwright）。

## 安装

```bat
cd media-parser
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-min.txt
```

## 用法

```bat
.venv\Scripts\python.exe parse_media.py --list-platforms
.venv\Scripts\python.exe parse_media.py --url "https://www.bilibili.com/video/BV..."
.venv\Scripts\python.exe parse_media.py --text "看看这个 https://..."
.venv\Scripts\python.exe parse_media.py --url "..." --metadata-only
```

输出是单行 JSON（日志走 stderr）：

```json
{
  "ok": true,
  "platform": "bilibili",
  "title": "...",
  "author": "...",
  "description": "...",
  "sourceUrl": "https://...",
  "text": "标题 / 作者 / 简介摘要",
  "files": [{"type": "video", "path": "D:\\...\\video_0.mp4", "name": "video_0.mp4", "size": 123456}],
  "mediaAvailable": true,
  "skipped": [],
  "platforms": ["bilibili", "douyin", "..."],
  "error": null
}
```

## 限制

- 默认只下载前 1 个视频、前 3 张图、前 1 个音频。
- 默认视频 50MB、音频 20MB、单图 15MB；桥接还会再按 QQ 配额过滤。
- B站默认最大 480P（`--bili-max-qn 32` 或环境变量 `QQBOT_MEDIA_BILI_MAX_QN`）；64=720P、80=1080P、0=不限制。
- 不启用 README 截图（需要 Playwright）和 AstrBot 的文本图片渲染、翻译、B 站扫码交互。
- 缓存目录默认 `../runtime/media-cache`，超过 6 小时的旧文件在下次解析时清理。

## 许可

`parse_media.py` 是适配层；`vendor/` 是上游 AGPLv3 代码的原样副本。对外分发或部署修改版时请遵守 AGPLv3，并保留上游 LICENSE 与来源说明。
