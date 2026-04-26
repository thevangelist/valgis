# Valgis Brand Colors

A palette built from rock art itself: ochre pigment, deep cave shadow, and the cyan glow of a screen revealing what the eye missed.

## Core palette

| Role | Name | Hex | Usage |
|---|---|---|---|
| **Pigment** | Red Ochre | `#B33A1F` | Heritage accent, editorial highlights, the "pigment came up" moment |
| **Signal** | Cyan | `#22D3EE` | Primary action, CTA, interactive elements |
| **Stone** | Black | `#000000` | Background, theme color, PWA splash |
| **Shadow** | Zinc 900 | `#18181B` | Surfaces, cards, panels |
| **Lichen** | Zinc 800 | `#27272A` | Borders, dividers |
| **Bone** | White | `#FFFFFF` | Headlines, primary text |
| **Ash** | Zinc 400 | `#A1A1AA` | Body text, descriptions |
| **Dust** | Zinc 500 | `#71717A` | Footer, meta info |

## Pigment variants

| Use | Hex | Notes |
|---|---|---|
| Red Ochre primary | `#B33A1F` | Default heritage accent |
| Red Ochre dark | `#7A2614` | Hover/active on light surfaces |
| Red Ochre wash | `#D9614A` | Soft text accent on black background |

## Signal variants

| Use | Hex | Notes |
|---|---|---|
| Cyan primary | `#22D3EE` | Default interactive |
| Cyan hover | `#67E8F9` | |
| Cyan active | `#06B6D4` | |

## PWA icon gradient

**Pigment glow** — pigment emerging from cave shadow.

- Top: `#7A2614` (Red Ochre dark)
- Bottom: `#000000` (Black)
- Direction: top → bottom, linear

CSS:
```css
background: linear-gradient(180deg, #7A2614 0%, #000000 100%);
```

## Usage rules

1. **Stone is the canvas.** Background is always black. Never white surfaces.
2. **Two heroes, one job each.** Cyan for action, ochre for heritage. Never both in the same role.
3. **One cyan per view.** It is the primary action. Don't dilute it.
4. **Ochre is editorial.** Use for quotes, hero accents, and pigment-related moments. Never for buttons or alerts.
5. **Whites are bone, not bright.** Pure `#FFFFFF` for text only. Surfaces stay zinc.
6. **Subtlety on borders.** 60% opacity on dark borders avoids harsh lines.
