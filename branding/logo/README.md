# boredgames.io wordmark

The owner's pick (option B): "boredgames" in Poppins Black (900) with "games" in the accent colour,
".io" in Poppins Regular (400), tracking about -0.045em, every letter converted to an outline so
the logo needs no font. Poppins is released under the SIL Open Font License 1.1.

| File | Use |
| --- | --- |
| boredgames-logo-dark.svg | The full logo on dark: the two phones as the icon, as tall as the text, then the wordmark |
| boredgames-logo-light.svg | The full logo on light |
| boredgames-wordmark-dark.svg | On dark: off-white #F1F0E8, "games" lime #C7E976 |
| boredgames-wordmark-light.svg | On light: ink #141514, "games" deep olive #405D17 |
| boredgames-wordmark-ink.svg | One colour, ink |
| boredgames-wordmark-offwhite.svg | One colour, off-white |
| boredgames-wordmark-mono-current.svg | One colour, currentColor |
| boredgames-wordmark-two-tone-current.svg | currentColor with a --wordmark-accent "games" |

The app renders the full logo inline from client/src/platform/brand/wordmark.ts (the phones come
from client/src/platform/components/Mascots.tsx), so the site header always shows the icon too.
