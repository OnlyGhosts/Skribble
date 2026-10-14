> Superseded by the Pocket Party pack in [`branding/pocket-party/`](../../pocket-party/START_HERE.md); kept for reference only.

# boredgames.io rebrand handoff

Unzip into your existing project as `branding/`. Give Claude Code `CLAUDE_CODE_BRIEF.md` and ask it to implement the brief in the current repository.

## Contents
- CLAUDE_CODE_BRIEF.md: implementation prompt and acceptance checks.
- BRAND_GUIDE.md: authoritative visual decisions.
- UI_SPEC.md: homepage layout and interaction details.
- design-tokens.json and tokens.css: starting tokens.
- assets/: clean editable SVG phone mascots, smile favicon and live-text wordmarks.
- references/: approved dark mood board and earlier dark layout reference.

The written specifications override incidental details in generated images. The mood board accidentally includes Games / How it works / About links. Do not implement these. The final homepage has only Join a room and Create a room.

The SVG mascots are newly drawn editable interpretations, not exact vector traces. The wordmark SVGs use live system-font text, not outlined custom lettering. Finalize the font and outline the production logo in your design tool if exact reference matching is required. No font binaries are included and the reference's “Custom Geometric Sans” label is not an actual font identification.

This pack does not contain game code, a multiplayer backend or a deployable replacement application. Integrate it into the existing app.
