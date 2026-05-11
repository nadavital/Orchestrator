#!/usr/bin/env python3
"""Generate layered Apple Icon Composer source assets for Orchestrator."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "resources/icons/OrchestratorIcon.icon"
ASSETS_DIR = ICON_DIR / "Assets"
SOURCE_SHEET = ROOT / "resources/icons/Sources/OrchestratorIconLayerSource.png"

CANVAS = 1024


def source_panel(index: int) -> Image.Image:
    source = Image.open(SOURCE_SHEET).convert("RGBA")
    panel_w = source.width // 3
    panel = source.crop((index * panel_w, 0, (index + 1) * panel_w, source.height))
    return panel.resize((CANVAS, CANVAS), Image.Resampling.LANCZOS)


def is_chroma_or_separator(r: int, g: int, b: int) -> bool:
    chroma = r > 190 and b > 190 and g < 80
    separator = r > 235 and g > 235 and b > 235
    return chroma or separator


def make_head_colors() -> Image.Image:
    colors = {
        "red": (255, 33, 34, 255),
        "green": (70, 211, 53, 255),
        "yellow": (255, 211, 23, 255),
        "blue": (0, 108, 255, 255),
    }
    source = source_panel(0)
    source_pixels = source.load()
    mid_x = CANVAS // 2
    mid_y = CANVAS // 2

    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rectangle((0, 0, mid_x, mid_y), fill=colors["red"])
    draw.rectangle((mid_x, 0, CANVAS, mid_y), fill=colors["green"])
    draw.rectangle((0, mid_y, mid_x, CANVAS), fill=colors["yellow"])
    draw.rectangle((mid_x, mid_y, CANVAS, CANVAS), fill=colors["blue"])

    mask = Image.new("L", (CANVAS, CANVAS), 0)
    mask_pixels = mask.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            if x < 2 or x >= CANVAS - 2 or y < 2 or y >= CANVAS - 2:
                continue
            r, g, b, a = source_pixels[x, y]
            if a > 0 and not is_chroma_or_separator(r, g, b):
                mask_pixels[x, y] = 255

    masked = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    masked.paste(layer, (0, 0), mask)

    return masked


def make_flat_masked_layer(panel: Image.Image, color: tuple[int, int, int, int], kind: str) -> Image.Image:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    mask_pixels = mask.load()
    pixels = panel.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            if x < 2 or x >= CANVAS - 2 or y < 2 or y >= CANVAS - 2:
                continue
            r, g, b, a = pixels[x, y]
            if a == 0 or is_chroma_or_separator(r, g, b):
                continue
            if kind == "face":
                score = max(0, 160 - max(r, g, b))
            elif kind == "features":
                score = max(0, g - max(r, b) - 35)
            else:
                raise ValueError(f"Unknown mask kind: {kind}")
            mask_pixels[x, y] = min(255, score * 3)

    mask = mask.filter(ImageFilter.GaussianBlur(0.4))
    mask = mask.point(lambda v: 0 if v < 12 else min(255, int(v * 1.2)))
    layer = Image.new("RGBA", (CANVAS, CANVAS), color)
    output = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    output.paste(layer, (0, 0), mask)
    return output


def make_face_plate() -> Image.Image:
    return make_flat_masked_layer(source_panel(1), (6, 10, 9, 255), "face")


def make_face_features() -> Image.Image:
    return make_flat_masked_layer(source_panel(2), (84, 255, 62, 255), "features")


def write_icon_json() -> None:
    data = {
        "fill": "automatic",
        "groups": [
            {
                "layers": [
                    {
                        "image-name": "OrchestratorIcon_HeadColors.png",
                        "name": "Head Colors",
                        "position": {
                            "scale": 1,
                            "translation-in-points": [0, 0],
                        },
                    },
                    {
                        "image-name": "OrchestratorIcon_FacePlate.png",
                        "name": "Face Plate",
                        "position": {
                            "scale": 1,
                            "translation-in-points": [0, 0],
                        },
                    },
                    {
                        "image-name": "OrchestratorIcon_FaceFeatures.png",
                        "name": "Face Features",
                        "position": {
                            "scale": 1,
                            "translation-in-points": [0, 0],
                        },
                    },
                ],
                "position": {
                    "scale": 1,
                    "translation-in-points": [0, 0],
                },
                "shadow": {
                    "kind": "neutral",
                    "opacity": 0.5,
                },
                "translucency": {
                    "enabled": True,
                    "value": 0.4,
                },
            }
        ],
        "supported-platforms": {
            "circles": ["watchOS"],
            "squares": "shared",
        },
    }
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    (ICON_DIR / "icon.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    for asset in ASSETS_DIR.glob("OrchestratorIcon_*.png"):
        asset.unlink()

    layers = {
        "HeadColors": make_head_colors(),
        "FacePlate": make_face_plate(),
        "FaceFeatures": make_face_features(),
    }

    for name, image in layers.items():
        image.save(ASSETS_DIR / f"OrchestratorIcon_{name}.png")

    write_icon_json()


if __name__ == "__main__":
    main()
