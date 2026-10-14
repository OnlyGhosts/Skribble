# Implement the boredgames.io rebrand

You are working in the existing boredgames.io app. Implement the dark rebrand described in this pack. Start by reading BRAND_GUIDE.md, UI_SPEC.md and design-tokens.json, then visually inspect references/approved-dark-brand-moodboard.png. Written specs override incidental image details.

## First inspect the repository
Read repository instructions. Identify framework, routes, styling system, fonts, shared components, room code validation, room creation and join handlers, and game selection flow. Reuse existing architecture, dependencies and real backend behavior. Make a brief implementation plan and then do the work. Do not replace the project with a static mockup or wire fake rooms.

## Required result
1. Default dark charcoal and graphite theme, warm white text, lime primary action, lilac supporting brand accent.
2. Typographic lowercase boredgames.io wordmark and supplied phone-shaped mascots with no glass or inset face lines.
3. Homepage only has Join a room and Create a room. Join has FOUR individual visible code inputs and Join room button. Create has one prominent lime Create room button.
4. No game list or navigation menu on the homepage. Put existing game selection after create, preserving all games and settings.
5. Responsive desktop side-by-side panels and mobile stacked panels, with accessible interaction, copy/paste and error handling from UI_SPEC.md.
6. Integrate actual existing join/create logic. Preserve room invite deep links, websocket/realtime state, host controls, room lifecycle and other game behavior.
7. Apply shared tokens consistently across existing lobby/game surfaces where safe. Preserve gameplay layout and controls; homepage and shared chrome are the priority.
8. Update title, favicon and user-facing branding. Do not invent canonical URLs, change hosting, deploy or modify DNS. Leave infrastructure intact.

## Assets and font limitations
assets/*.svg are editable production starting points. Mascots are clean interpretations of the reference. Wordmarks contain live text and need font finalization for an exact logo match. Do not stretch them or claim they are exact outlined reproductions. Use a suitable existing font first. No font binaries are bundled. Avoid drawing the entire UI from a flattened mood-board image.

## Compatibility
The user requested four letters. Inspect the current server format and allowed alphabet. Do not break existing active rooms or invitations by changing code semantics. If incompatible, retain existing valid format and clearly document what must change for strict four-letter codes. Do not silently change server generation or data models.

## Validation and handoff
Run the app's existing relevant checks. Verify desktop and mobile widths 320, 390, 768 and 1440px, keyboard flow, paste, delete, focus, loading, errors, actual room creation and joining from another browser/session, invite deep links and post-create game selection. No fake success, placeholder buttons or visual-only room logic. Run available browser checks and report limitations honestly. Summarize changed files, checks performed, outstanding font/asset refinement and any compatibility issue. Do not deploy unless separately authorized.

## Acceptance checklist
- [ ] Exactly two homepage action paths; no catalogue or extra menu.
- [ ] Four separate code boxes visible before clicking anything.
- [ ] Real join/create handlers integrated and existing multiplayer works.
- [ ] Phone characters are flat, tall and have no inner screen/glass lines.
- [ ] Dark palette and lower-case wordmark match approved direction.
- [ ] No glow, glass, gradient or decorative AI-style effects.
- [ ] No overflow at 320px, keyboard and paste work, focus and error states clear.
- [ ] Existing game selection and gameplay remain available after creation.
- [ ] Fonts and vector fidelity limitations are reported rather than hidden.
