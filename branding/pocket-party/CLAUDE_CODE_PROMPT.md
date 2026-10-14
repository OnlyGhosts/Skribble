# Implement Pocket Party in the current boredgames.io app

The user selected this direction. Implement it throughout the actual existing application, not as a new standalone demo. Read START_HERE.md, design-tokens.json and every specs/*.md. Open references/approved-pocket-party.png and preview/index.html. Read repository instructions and inspect the current app before modifying anything.

## Work order
1. Identify framework, styling system, shared UI, existing fonts, room-code format, join/create handlers, game selection, realtime transport, player identity and content settings. Preserve real behavior.
2. Integrate dark-default and light-theme tokens using the provided exact CSS variable names. Reuse existing theme persistence. Theme control belongs in app settings, not as a third homepage CTA.
3. Add Space Grotesk 500/600/700, Inter 400/500/600/700 and optional IBM Plex Mono 500/600 from their official Google Fonts distributions, self-host WOFF2 when practical and retain licenses. Do not substitute unrelated display fonts or install large libraries solely for styling.
4. Implement reusable buttons, inputs, panels, tiles, badges, timer, toasts, modals, sheets, tabs and chat styles, then apply Home, name entry and Lobby. Use the provided SVG assets as a baseline; refine their geometry if needed to visually match the approved design. No glass lines on mascot faces.
5. Rebrand all seven game surfaces, intermediate round/turn results and Podium using screen-specs.md. Preserve all current game controls, settings and permissions.
6. Verify with real room creation and joining, actual game rounds and invitation URLs; run the repository's appropriate checks. Review screenshots at 320x568, 390x844, 768px and 1440px. Compare visual output against the approved board and refine spacing, type, surfaces and hierarchy until coherent.

## Non-negotiable design
Default dark #141514 with subtly separated flat panels, off-white #F1F0E8, lime #C7E976 actions and lilac #A699D5 selection. Compact clean hierarchy, border-led surfaces, no neon glow, glossy shading or generic dashboard hero. Lowercase boredgames.io wordmark with games in lime in dark mode. Phone mascots small on home and celebrations only; no oversized artwork above controls. Homepage has only Join a room (four boxes directly visible + Join button) and Create a room. No tagline, catalogue, navigation, status widget or extra menu there.

## Compatibility and correctness
Codes are four characters, letters and digits, existing alphabet excludes I/L/O/0/1. Preserve backend validation and generation, invitation deep links and active rooms. Do not switch to letters-only, create local fake codes, replace APIs, hardcode game data in production, reset rooms, remove games or change hosting. Game selection occurs in the persistent room/lobby after creation. Preserve existing content options (including any middle tier such as Cheeky), timers, max players, sit-out, chat, host changes, reconnects and blackjack/poker rules. Do not show Ready badges in active gameplay unless the actual app uses them. Skribble's drawing and guessing roles have different toolbars; never show both sets as if one person does both.

## Acceptance
- Home two action paths; paste, focus, backspace, keyboard and server errors work.
- Real create/join and invitation flows remain intact.
- All screens use common theme tokens; no old lime/charcoal values scattered outside tokens.
- Each game has distinct icon/accent; selected and disabled states include text or symbols.
- Controls have 44px targets and verified contrast, no horizontal scrolling at 320px.
- Game stage and controls fit short phones; bottom sheets manage secondary panels.
- Drawings remain literal white canvases in both themes; drawing colour controls are not recoloured by UI theme.
- Light theme is fully usable; focus and error treatments visible in both themes.
- Reduced-motion supported; sound follows existing mute preferences, no autoplay.
- Production app uses no flattened mockup images as UI.

Finish with changed files, actual checks, visual comparison screenshots and remaining issues. Do not deploy or change DNS without a separate instruction. If screenshot/browser tools are unavailable, report that limit rather than claiming visual parity.
