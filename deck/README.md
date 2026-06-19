# Lumen — Pitch Deck

A self-contained, offline pitch deck for the **Band of Agents Hackathon** submission.
One file, no internet needed (no CDNs, no fonts to download) — safe to run during a live demo.

## Present it

Open `deck/index.html` in any browser (Chrome recommended).

| Key | Action |
|---|---|
| `→` / `Space` / click-right | next slide |
| `←` / click-left | previous slide |
| `Home` / `End` | first / last slide |
| `F` | fullscreen |
| `P` | print → save as PDF |

Touch swipe works on tablets/phones. The URL hash (`#7`) deep-links to a slide, so you can refresh without losing your place.

## Export to PDF (for the lablab submission)

1. Open `deck/index.html` in **Chrome**.
2. Press `P` (or `Ctrl/Cmd + P`).
3. In the print dialog:
   - **Destination:** Save as PDF
   - **Layout:** Landscape
   - **Margins:** None
   - **More settings → Background graphics:** ON ✅ (critical — keeps the dark theme + colors)
4. Save as `Lumen-Pitch-Deck.pdf` and upload to the submission.

Every slide prints as one full landscape page.

## Edit before submitting

Open `index.html` and search for these — they're the only things you'll likely want to change:

- **Team names / handles** — slide 14 (`Team Lumen`). Add the real member names.
- **Links** — slide 14 has the repo link and a placeholder `▶ live demo & 3-min video`. Drop in the deployed URL + the YouTube/Loom video link once they exist.
- **Numbers** — the demo figures (`88%` / `95.5%` adjudicators, `78/95 supported · 2 contradicted`, `$35,700`, `$1,980`) are from the live Band run on 2026-06-19. Re-confirm against your final recorded take if it differs.

14 slides total. Content is plain HTML — no build step.
