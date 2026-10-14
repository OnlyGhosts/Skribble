# Landing page specification

## Information architecture
Only two primary paths: Join a room and Create a room. No game catalogue, marketing sections, navigation menu, sign-in CTA, about links or settings controls on the landing screen. Existing necessary legal links can stay in a discreet footer if the app already needs them.

## Header and hero
Wordmark at top left, generous surrounding space. Hero “Less bored.” / “More games.” with off-white and optional lilac second line. Copy: “Get your people together. A room code is all it takes.” Place the two small phone characters beside the hero on desktop; on mobile shrink them or hide them if they push the controls below the fold. Prioritize the form over art.

## Desktop
Centered max-width 1120px; side gutters 32–48px. Two equally sized panels side by side, gap 24px. Page #141514, panels #20221F, thin border, 12px panel radius, padding 28–32px. The join panel contains heading, room-code label, four input boxes and Join room button. Create panel contains heading, short copy and lime Create room button. Align button baselines.

## Mobile
24px outer gutters, decreasing to 16px on narrow devices. Join panel first, Create panel second, gap 16px. Four boxes stay in one row: equal flexible columns with an 8–12px gap. No horizontal overflow at 320px. Input height 56–64px; buttons at least 48px. Keep the hero compact and both actions easy to reach.

## Join interaction
Four visible separate boxes on the homepage, one letter each. Use faint A/B/C/D placeholders, not prefilled values. Accessible group label “Room code”; each input has “Letter 1” through “Letter 4”. Uppercase letters automatically. Advance after typing. Backspace in an empty input returns to the preceding one. Arrow keys move between inputs. Pasting a four-letter code distributes it across boxes. Submit with Enter or Join room. Show field-level errors and preserve code on failure. Provide loading/disabled states during requests, announce errors in a polite live region, and focus the first invalid box. Do not repeatedly submit or auto-submit on fourth letter.

User requested FOUR LETTERS. Check the existing backend's real code format before changing validation or generation. If it uses alphanumeric codes or excludes ambiguous letters, preserve compatibility and explain that constraint rather than changing the backend silently. Do not invent a disconnected four-letter room service.

## Create interaction
Create room calls the existing room creation handler, then takes the host into the existing room/lobby/game selection flow. Game selection belongs after creation, not on this homepage. Preserve game settings, invitation links, host permissions and connection behavior. Never generate fake client-only codes as if they were real rooms.

## Accessibility and states
Visible keyboard focus, associated labels, input autocomplete off and autocapitalize characters, no colour-only error indicators. Good text contrast, semantic forms/buttons, usable zoom. Loading, invalid-code, room-not-found, full-room and network-error states use existing response semantics. Do not promise an unimplemented state. Respect prefers-reduced-motion. Mascots have empty alt when decorative; wordmark has boredgames.io accessible name.
