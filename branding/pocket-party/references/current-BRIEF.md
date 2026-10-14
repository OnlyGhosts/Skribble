# boredgames.io: brand and UI exploration brief

You are a senior brand and product designer. I need **five distinct brand and UI design languages** for my web app, boredgames.io, then **image mockups of each** so I can pick one. The direction I pick will be built in code by another AI (Claude Code), so the final hand-off has to be precise.

Read this whole brief first. Do not ask me questions before Step 1. Make sensible assumptions and list them at the end of Step 1.

---

## 1. The product

- **What it is.** Free party games in the browser. Friends in the same room (or on a call) each play on their own phone. No app, no account.
- **How you get in.** One person taps Create room and gets a 4-character code, letters and digits, e.g. `K7QX` (no I, L, O, 0 or 1). Everyone else types it into four boxes or opens an invite link.
- **Rooms are parties.** The room stays together between games. The host picks the game in the lobby. Players ready up or sit a game out. For games with prompts or words, the host picks Family or Unhinged (18+) content.
- **Devices.** Phone-first: most players are on phones 320 to 430px wide. The host is often on a laptop or casting to a TV, so desktop must look good too.
- **Typing** uses the phone's own keyboard. No custom on-screen keyboards except Hangman's letter grid.
- **Audience.** Friend groups 16 to 35 at pre-drinks, sleepovers, house parties and group calls. Also families, in Family mode.
- **Name.** Keep the name **boredgames.io**. How you set it (case, the ".io", a symbol) is up to you.

## 2. The games

Each game needs its own accent colour and icon inside the system. More games are coming, so the system must scale to 15 or more.

| Game | What happens |
| --- | --- |
| Skribble | One player draws a secret word, everyone else races to guess it. |
| The Spy Game | Everyone knows the location except the spy. Ask questions, find the spy. |
| Quip Game (name may change) | Answer silly prompts, then everyone votes for the funniest answer. |
| Hangman | Guessers pick letters; the hangman draws the figure piece by piece on a canvas. |
| Battleships | 2 to 8 players, own boards or two teams, dice rolls let ships move. |
| Blackjack | Everyone against the house, with chips. |
| Poker | Texas Hold'em with chips. |

## 3. Screens and components every direction must cover

**The flow:** Home → "Who's playing?" (name and emoji avatar) → Lobby → In-game → round or turn results → Podium → back to Lobby.

- **Home.** Two choices only. Join a room (four code boxes and a Join button) and Create a room (one button). Nothing else is required on the page.
- **Lobby.** Room code with copy and share. Game picker grid. Player list with host, you, ready and sitting-out badges. Game settings (sliders, toggles, choice cards). Content mode cards (Family or Unhinged, only for games with prompts). Chat. Start button ("Start · 3 ready").
- **In-game.** Compact top bar (round, timer ring, players, chat, menu) with the game area below. Phone panels open as bottom sheets.
- **Podium.** Winner celebration, standings, Ready for the next game, host buttons for Play again and Back to lobby.

**Components:** buttons (primary, secondary, ghost, danger, disabled, loading), the 4-box code input (empty, filled, error), text inputs, sliders, toggles, choice cards, player chips with emoji avatars and badges, timer ring (normal, last 5 seconds, paused), chat lines (system, close guess, correct guess), toasts, bottom sheets, modals, tabs, panels, game tiles, playing cards, a letter-key grid, a game board grid, a drawing canvas with a toolbar, confetti.

## 4. The current direction (reference only)

The attached sheets show the current app: charcoal background, lime and lilac accents, flat panels, a heavy lowercase wordmark and two phone mascots. **I'm not convinced by it.** Use the screenshots to understand what is on each screen, not how it should look. All five directions must look clearly different from the current one and from each other.

## 5. Hard constraints

1. **Buildable on the mobile web** in HTML, CSS and SVG. Gradients, shadows, textures and illustration are fine if they run smoothly on a mid-range Android phone. No WebGL or video backgrounds.
2. **Fonts:** free web fonts only (Google Fonts or SIL Open Font License). At most two families, plus an optional monospace for room codes. Name them exactly.
3. **Logo:** must work as a flat vector (SVG) at 24px tall, in one colour, and as a square app icon from 16 to 512px.
4. **Themes:** a light and a dark theme. Say which one is the default.
5. **Accessibility:** WCAG AA contrast (4.5:1 body text, 3:1 large text and UI parts), 44px minimum tap targets, never colour alone, motion that respects reduced-motion settings.
6. **Phone layouts** work at 320×568 and 390×844 with no sideways scrolling. Game controls stay on screen without scrolling.
7. **Illustration and mascots**, if any, must be producible as SVG or a small set of PNGs. The UI must not depend on large background images.
8. **Copy voice:** short and human. **No filler taglines** and no lines like "Get your people together. A room code is all it takes." or "Made for one more round." That kind of copy reads as AI-written and I don't want it. If a line doesn't help someone do something, leave it out.

## 6. Step 1: five directions, in text

Make the five span a wide range. Some ideas for spread: playful cartoon, retro arcade, tactile tabletop or paper, bold editorial or sticker, glossy game show. Your call, but no two should feel alike.

For each direction give:

1. **Name**, one-line idea, three adjectives, who it appeals to most.
2. **Logo concept:** wordmark treatment, symbol if any, app icon idea.
3. **Palette** with hex values for both themes, mapped to the roles in section 9. Add one accent per game.
4. **Typography:** display, body and mono fonts, with size and weight for H1, H2, body, label and the code boxes.
5. **Shape and surface:** corner radii, borders, shadows, textures, spacing (tight or airy).
6. **Components:** one sentence each on buttons, code boxes, panels, player chips, timer, overlays and toasts.
7. **Illustration, mascot and icon** style.
8. **Motion and sound:** 3 to 5 principles, e.g. how cards deal, how a win is celebrated.
9. **Voice:** 5 microcopy samples for an empty lobby, waiting for the host, you won, connection lost, and the invite share text.
10. **Risks** and trade-offs.

## 7. Step 2: one style board per direction

Make one image per direction, using the same layout each time so they compare fairly. Use this prompt, filling in the direction:

> A clean, realistic UI design presentation board, 16:9 landscape, for a party-games web app called "boredgames.io", in the [DIRECTION NAME] style: [two-sentence description of the look, palette hex values, fonts]. Top row: three phone screens side by side. Phone 1: the home screen with the logo "boredgames.io", a "Join a room" panel with four code boxes showing K 7 Q X and a Join button, and a "Create a room" button. Phone 2: the lobby with a grid of game tiles (Skribble, The Spy Game, Quip Game, Hangman, Battleships, Blackjack, Poker), a player list of four friends with emoji avatars and Ready badges, and a "Start · 4 ready" button. Phone 3: an in-game screen of the drawing game Skribble with a top bar (round 2/3, a circular timer, players, chat) and a drawing canvas. Bottom strip: the logo large, the app icon, colour swatches with hex labels, a type specimen, and a row of buttons. All text legible English and spelled exactly. No device frames beyond simple rounded phone outlines.

If you have room, make a second board per direction with: the podium (a winner celebration and standings), a Blackjack table with cards and chips, and the Spy Game location card.

## 8. Step 3: hand-off, only for the direction I pick

When I tell you which one I picked, produce:

1. **design-tokens.json** in exactly the format in section 9.
2. **Logo construction notes:** letterforms, font if based on one, symbol geometry, spacing, colours, so it can be rebuilt as SVG. Plus the app icon.
3. **Component spec:** for each component in section 3, sizes, radii, borders, states (hover, pressed, focus, disabled), in px.
4. **Motion spec:** durations in ms and easing curves for page transitions, overlays, toasts, card dealing, timer warnings, the win celebration.
5. **Asset list:** every illustration or mascot needed, each with a ready-to-use image prompt and the exact file name.
6. **Copy list:** button labels, empty states, error messages, the invite share text.
7. **Final screen images** of Home, Lobby, Podium, and one screen per game, phone size, as the visual reference.

## 9. Token format for the hand-off

These names match the app's existing CSS variables, so the hand-off drops straight in. Give every value for both themes.

```json
{
  "name": "Direction name",
  "defaultTheme": "dark",
  "fonts": {
    "display": { "family": "", "weights": [800], "source": "Google Fonts" },
    "body": { "family": "", "weights": [400, 600, 700], "source": "Google Fonts" },
    "mono": { "family": "", "weights": [600], "source": "Google Fonts" }
  },
  "themes": {
    "dark": {
      "--color-bg": "page background",
      "--color-surface": "panels and cards",
      "--color-surface-2": "raised or nested surfaces",
      "--color-surface-3": "inputs, wells, inactive keys",
      "--color-border": "default borders",
      "--color-border-strong": "input and control borders",
      "--color-text": "main text",
      "--color-text-muted": "secondary text",
      "--color-text-faint": "hints and placeholders",
      "--color-primary": "main action fill",
      "--color-primary-hover": "",
      "--color-primary-contrast": "text on primary",
      "--color-primary-soft": "tinted primary background",
      "--color-primary-text": "primary used as text",
      "--color-secondary": "supporting accent fill",
      "--color-secondary-hover": "",
      "--color-secondary-contrast": "",
      "--color-secondary-soft": "",
      "--color-secondary-text": "",
      "--color-success": "", "--color-success-soft": "", "--color-success-text": "",
      "--color-warning": "", "--color-warning-soft": "", "--color-warning-text": "",
      "--color-danger": "", "--color-danger-soft": "", "--color-danger-text": "",
      "--color-info-soft": "",
      "--color-focus": "focus ring",
      "--overlay-bg": "modal backdrop, rgba allowed",
      "--canvas-bg": "drawing canvas",
      "--chat-correct-bg": "", "--chat-correct-fg": "",
      "--chat-close-bg": "", "--chat-close-fg": "",
      "--chat-guessed-bg": "", "--chat-guessed-fg": ""
    },
    "light": { "...": "same keys" }
  },
  "radius": { "--radius-sm": "", "--radius-md": "", "--radius-lg": "", "--radius-pill": "" },
  "shadow": { "--shadow-sm": "", "--shadow-md": "", "--shadow-lg": "" },
  "space": { "--space-1": "4px", "--space-2": "8px", "...": "up to --space-8" },
  "type": {
    "h1": { "mobile": "", "desktop": "", "weight": 0, "lineHeight": 0, "letterSpacing": "" },
    "h2": {}, "body": {}, "label": {}, "codeBox": {}
  },
  "gameAccents": {
    "skribble": "", "spygame": "", "quipgame": "", "hangman": "",
    "battleships": "", "blackjack": "", "poker": ""
  }
}
```

## 10. Attached files

- **sheet-A-site-screens.png:** home (desktop and phone, dark and light), the name step, the lobby (phone and desktop), the podium.
- **sheet-B-game-screens.png:** Skribble, The Spy Game, Quip Game, Hangman, Battleships, Blackjack.
- **sheet-C-current-brand.png:** the current logo, mascots and palette, which are being replaced.
