#!/usr/bin/env python3
"""把梦璃的群友画像渲染成一张适合 QQ 发送的 PNG 卡片。

输入：stdin 的 UTF-8 JSON；输出：argv[1] 指定路径的 PNG。
只依赖 Pillow，不联网。
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SCALE = 2
WIDTH = 760
MARGIN = 28
PADDING = 32
CARD_X = MARGIN
CARD_Y = MARGIN
CARD_W = WIDTH - MARGIN * 2
INNER_X = CARD_X + PADDING
INNER_W = CARD_W - PADDING * 2

BG_TOP = (247, 243, 252)
BG_BOTTOM = (253, 251, 255)
CARD_FILL = (255, 255, 255, 248)
CARD_BORDER = (233, 226, 245)
TEXT = (31, 41, 55)
MUTED = (107, 114, 128)
FAINT = (156, 163, 175)
ACCENT = (37, 99, 235)
DOT = (124, 92, 220)
STAT_FILL = (246, 248, 252)
CHIP_FILL = (239, 233, 250)
CHIP_TEXT = (91, 75, 138)
SEPARATOR = (238, 233, 246)

AVATAR_TOP = (111, 168, 255)
AVATAR_BOTTOM = (61, 123, 240)


def px(value):
    return int(round(value * SCALE))


def find_font(bold=False):
    env_name = "QQBOT_PROFILE_FONT_BOLD" if bold else "QQBOT_PROFILE_FONT"
    configured = os.environ.get(env_name, "").strip()
    candidates = []
    if configured:
        candidates.append(configured)
    if bold:
        candidates += [
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        ]
    else:
        candidates += [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/msyhl.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/System/Library/Fonts/PingFang.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    raise SystemExit("找不到中文字体，可通过 QQBOT_PROFILE_FONT / QQBOT_PROFILE_FONT_BOLD 指定字体文件")


def font(path, size):
    return ImageFont.truetype(path, px(size), index=0)


def vertical_gradient(width, height, top, bottom):
    base = Image.new("RGB", (1, max(1, height)))
    draw = ImageDraw.Draw(base)
    for y in range(max(1, height)):
        ratio = y / max(1, height - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.point((0, y), fill=color)
    return base.resize((max(1, width), max(1, height)))


def text_length(draw, text, fnt):
    return draw.textlength(text, font=fnt)


NO_LINE_START = set("，。；：！？、）》」』”’…")
NO_LINE_END = set("（《「『“‘")


def wrap_text(draw, text, fnt, max_width):
    lines = []
    for paragraph in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        paragraph = paragraph.strip()
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for char in paragraph:
            candidate = current + char
            if not current or text_length(draw, candidate, fnt) <= max_width:
                current = candidate
                continue
            # 收尾标点宁可略微超宽也留在本行，避免“；”“””跑到下一行开头。
            if char in NO_LINE_START:
                current += char
                continue
            # 左括号不留在行尾，跟下一行内容一起开始。
            carry = ""
            while current and current[-1] in NO_LINE_END:
                carry = current[-1] + carry
                current = current[:-1]
            if current:
                lines.append(current)
            current = carry + char
        if current:
            lines.append(current)
    return lines


def truncate_lines(draw, lines, fnt, max_width, max_lines):
    if len(lines) <= max_lines:
        return lines
    lines = lines[:max_lines]
    last = lines[-1]
    while last and text_length(draw, last + "…", fnt) > max_width:
        last = last[:-1]
    lines[-1] = last.rstrip() + "…"
    return lines


def format_count(value):
    number = max(0, int(value or 0))
    if number >= 10000:
        return f"{number / 10000:.1f}万".replace(".0万", "万")
    return str(number)


def avatar_initial(name):
    value = str(name or "").strip()
    if not value:
        return "M"
    first = value[0]
    if first.isalnum():
        return first.upper()
    return "M"


def parse_data():
    raw = sys.stdin.buffer.read().decode("utf-8", "replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"输入 JSON 无效：{error}")
    stats = data.get("stats") if isinstance(data.get("stats"), dict) else {}
    tags = data.get("tags") if isinstance(data.get("tags"), list) else []
    clean_tags = []
    for tag in tags:
        value = str(tag or "").strip()
        if value and value not in clean_tags:
            clean_tags.append(value)
    return {
        "name": str(data.get("name") or "冒险家").strip()[:20] or "冒险家",
        "scope": str(data.get("scope") or "本群").strip()[:12] or "本群",
        "summary": str(data.get("summary") or "").strip(),
        "personality": str(data.get("personality") or "").strip(),
        "interaction_style": str(data.get("interactionStyle") or "").strip(),
        "tags": clean_tags,
        "messages": int(stats.get("messages") or 0),
        "triggers": int(stats.get("triggers") or 0),
        "replies": int(stats.get("replies") or 0),
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("用法：render_profile_card.py <输出.png>")
    output = sys.argv[1]
    data = parse_data()

    regular_path = find_font(False)
    bold_path = find_font(True)
    fonts = {
        "name": font(bold_path, 32),
        "subtitle": font(regular_path, 15),
        "stat_value": font(bold_path, 34),
        "stat_label": font(regular_path, 14),
        "section": font(bold_path, 21),
        "body": font(regular_path, 17),
        "chip": font(regular_path, 14),
        "footer": font(regular_path, 12),
        "avatar": font(bold_path, 40),
    }

    measure_image = Image.new("RGB", (8, 8), (255, 255, 255))
    measure = ImageDraw.Draw(measure_image)

    persona_parts = [part for part in [data["summary"], data["personality"]] if part]
    persona_text = "\n\n".join(persona_parts) or "画像还在整理中，多聊几句后梦璃会更了解你。"
    interaction_text = data["interaction_style"] or "还没有整理出稳定的互动风格。"

    persona_lines = truncate_lines(
        measure,
        wrap_text(measure, persona_text, fonts["body"], px(INNER_W)),
        fonts["body"],
        px(INNER_W),
        10,
    )
    interaction_lines = truncate_lines(
        measure,
        wrap_text(measure, interaction_text, fonts["body"], px(INNER_W)),
        fonts["body"],
        px(INNER_W),
        8,
    )

    subtitle = f"这是机器人在{data['scope']}为你生成的画像 · 只读展示"
    subtitle_lines = wrap_text(measure, subtitle, fonts["subtitle"], px(INNER_W - 108))
    subtitle_lines = truncate_lines(measure, subtitle_lines, fonts["subtitle"], px(INNER_W - 108), 2)

    footer_text = "画像由 AI 根据群内发言整理，仅供参考 · 发送 /我的画像 可随时再次查看"
    footer_lines = wrap_text(measure, footer_text, fonts["footer"], px(INNER_W))
    footer_lines = truncate_lines(measure, footer_lines, fonts["footer"], px(INNER_W), 2)

    body_line_h = 27
    section_title_h = 30
    section_gap = 24
    cursor = CARD_Y + PADDING

    header_y = cursor
    stats_y = header_y + 108 + max(0, len(subtitle_lines) - 1) * 22
    stats_h = 92
    cursor = stats_y + stats_h + 28

    persona_title_y = cursor
    persona_body_y = persona_title_y + section_title_h + 8
    cursor = persona_body_y + len(persona_lines) * body_line_h + section_gap

    interaction_title_y = cursor
    interaction_body_y = interaction_title_y + section_title_h + 8
    cursor = interaction_body_y + len(interaction_lines) * body_line_h + section_gap

    tags_title_y = cursor
    tags_y = tags_title_y + section_title_h + 12
    chip_font = fonts["chip"]
    chip_pad_x = 12
    chip_h = 32
    chip_gap_x = 9
    chip_gap_y = 9
    tag_rows = []
    row = []
    row_width = 0
    display_tags = data["tags"][:12]
    if len(data["tags"]) > 12:
        display_tags = data["tags"][:11] + [f"+{len(data['tags']) - 11}"]
    for tag in display_tags:
        tag_text = tag[:18]
        chip_w = int(round(text_length(measure, tag_text, chip_font) / SCALE)) + chip_pad_x * 2
        if chip_w > INNER_W:
            tag_text = tag_text[:8] + "…"
            chip_w = int(round(text_length(measure, tag_text, chip_font) / SCALE)) + chip_pad_x * 2
        if row and row_width + chip_gap_x + chip_w > INNER_W:
            tag_rows.append(row)
            row = []
            row_width = 0
        row.append((tag_text, chip_w))
        row_width += (chip_gap_x if row_width else 0) + chip_w
    if row:
        tag_rows.append(row)
    if not tag_rows:
        empty_w = int(round(text_length(measure, "还没有标签", chip_font) / SCALE)) + chip_pad_x * 2
        tag_rows = [[("还没有标签", empty_w)]]

    tags_height = len(tag_rows) * chip_h + max(0, len(tag_rows) - 1) * chip_gap_y
    cursor = tags_y + tags_height + 26

    separator_y = cursor
    footer_y = separator_y + 22
    footer_line_h = 20
    card_h = footer_y + len(footer_lines) * footer_line_h + PADDING - CARD_Y
    card_h = max(card_h, 520)
    total_h = CARD_Y + card_h + MARGIN

    image = vertical_gradient(px(WIDTH), px(total_h), BG_TOP, BG_BOTTOM).convert("RGBA")

    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (px(CARD_X), px(CARD_Y + 4), px(CARD_X + CARD_W), px(CARD_Y + card_h + 4)),
        radius=px(24),
        fill=(88, 64, 130, 26),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(px(9)))
    image = Image.alpha_composite(image, shadow)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (px(CARD_X), px(CARD_Y), px(CARD_X + CARD_W), px(CARD_Y + card_h)),
        radius=px(24),
        fill=CARD_FILL,
        outline=CARD_BORDER,
        width=px(1),
    )

    avatar_size = px(78)
    avatar_x = INNER_X
    avatar_y = header_y
    avatar = vertical_gradient(avatar_size, avatar_size, AVATAR_TOP, AVATAR_BOTTOM).convert("RGBA")
    mask = Image.new("L", (avatar_size, avatar_size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, avatar_size - 1, avatar_size - 1), fill=255)
    circle = Image.new("RGBA", (avatar_size, avatar_size), (0, 0, 0, 0))
    circle.paste(avatar, (0, 0), mask)
    image.alpha_composite(circle, (px(avatar_x), px(avatar_y)))
    draw = ImageDraw.Draw(image)
    draw.ellipse(
        (px(avatar_x), px(avatar_y), px(avatar_x + 78), px(avatar_y + 78)),
        outline=(255, 255, 255, 220),
        width=px(3),
    )
    draw.text(
        (px(avatar_x + 39), px(avatar_y + 39)),
        avatar_initial(data["name"]),
        font=fonts["avatar"],
        fill=(255, 255, 255),
        anchor="mm",
    )

    name_x = avatar_x + 78 + 22
    draw.text((px(name_x), px(header_y + 7)), data["name"], font=fonts["name"], fill=TEXT, anchor="la")
    subtitle_y = header_y + 52
    for index, line in enumerate(subtitle_lines):
        draw.text(
            (px(name_x), px(subtitle_y + index * 22)),
            line,
            font=fonts["subtitle"],
            fill=MUTED,
            anchor="la",
        )

    stat_gap = px(14)
    stat_w = (INNER_W - stat_gap * 2) / 3
    stats = [
        (format_count(data["messages"]), "互动消息"),
        (format_count(data["triggers"]), "对话触发"),
        (format_count(data["replies"]), "完成回复"),
    ]
    for index, (value, label) in enumerate(stats):
        x = INNER_X + index * (stat_w + stat_gap)
        draw.rounded_rectangle(
            (px(x), px(stats_y), px(x + stat_w), px(stats_y + stats_h)),
            radius=px(12),
            fill=STAT_FILL,
        )
        draw.text((px(x + 18), px(stats_y + 14)), value, font=fonts["stat_value"], fill=ACCENT, anchor="la")
        draw.text((px(x + 18), px(stats_y + 58)), label, font=fonts["stat_label"], fill=MUTED, anchor="la")

    def draw_section(title, title_y, body_y, lines):
        draw.ellipse(
            (px(INNER_X), px(title_y + 9), px(INNER_X + 10), px(title_y + 19)),
            fill=DOT,
        )
        draw.text((px(INNER_X + 20), px(title_y)), title, font=fonts["section"], fill=TEXT, anchor="la")
        for index, line in enumerate(lines):
            if not line:
                continue
            draw.text(
                (px(INNER_X), px(body_y + index * 27)),
                line,
                font=fonts["body"],
                fill=(75, 85, 99),
                anchor="la",
            )

    draw_section("人格画像", persona_title_y, persona_body_y, persona_lines)
    draw_section("互动风格", interaction_title_y, interaction_body_y, interaction_lines)

    draw.ellipse(
        (px(INNER_X), px(tags_title_y + 9), px(INNER_X + 10), px(tags_title_y + 19)),
        fill=DOT,
    )
    draw.text((px(INNER_X + 20), px(tags_title_y)), "标签", font=fonts["section"], fill=TEXT, anchor="la")
    chip_y = tags_y
    for row in tag_rows:
        chip_x = INNER_X
        for tag_text, chip_w in row:
            draw.rounded_rectangle(
                (px(chip_x), px(chip_y), px(chip_x + chip_w), px(chip_y + 32)),
                radius=px(14),
                fill=CHIP_FILL,
            )
            draw.text(
                (px(chip_x + 12), px(chip_y + 16)),
                tag_text,
                font=chip_font,
                fill=CHIP_TEXT,
                anchor="lm",
            )
            chip_x += chip_w + 9
        chip_y += 32 + 9

    draw.line(
        (px(INNER_X), px(separator_y), px(INNER_X + INNER_W), px(separator_y)),
        fill=SEPARATOR,
        width=px(1),
    )
    for index, line in enumerate(footer_lines):
        draw.text(
            (px(WIDTH / 2), px(footer_y + index * 20)),
            line,
            font=fonts["footer"],
            fill=FAINT,
            anchor="ma",
        )

    os.makedirs(os.path.dirname(os.path.abspath(output)) or ".", exist_ok=True)
    image.convert("RGB").save(output, "PNG", optimize=True)
    print(json.dumps({"ok": True, "path": output, "width": image.width, "height": image.height}))


if __name__ == "__main__":
    main()
