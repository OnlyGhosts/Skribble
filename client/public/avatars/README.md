The 50 avatar faces are Microsoft Fluent Emoji, in the "Color" style that Windows 11 shows, from
https://github.com/microsoft/fluentui-emoji (commit 1ffb34c752ecf5d402f04cfb4b392c77f57c54bc).
Copyright (c) Microsoft Corporation, used under the MIT License (full text in
LICENSE-fluentui-emoji.txt beside this file).

Each file is the original SVG drawn at 104 x 104 px and saved as WebP (about 3.4 KB each, 169,378
bytes for all 50). WebP rather than SVG because the SVGs use 372 blur filters between them and
weigh 830 KB even after svgo, too heavy for a phone drawing 50 at once in the picker.

The list, in order, with each face's name and file, is shared/platform/avatarFaces.ts. To add a
face, append it there (never reorder: saved avatars keep only the index) and run
`node scripts/avatars.mjs`.
