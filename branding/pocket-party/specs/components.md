# Component specification

All dimensions CSS px. Common focus: 2px --color-focus outline +3px offset. Hit target>=44px. Disabled: surface2 fill, muted text, disabled semantics, no click. Loading preserves width and label, aria-busy, 16px spinner or reduced-motion text. Hover uses token hover; pressed translates1px and darkens slightly without layout shift. Errors include icon+text.

| Component | Geometry / states |
| --- | --- |
| Primary button | height48, padding0 20, radius8, Inter600 15, lime fill/dark text. Desktop max none; mobile full width for main actions |
| Secondary | same geometry, transparent surface, border1.5px strong, primary text; hover surface2 |
| Ghost | height44, padding 12, no border; hover surface2 |
| Danger | danger-soft fill, danger-text,1px danger border; destructive actions labelled |
| Code input | four equal columns gap8; at 320 inner width256 yields58px wide; height60, radius 10, border1.5px strong, mono 600 28. Empty hints text-faint. Filled text; focus primary border; error danger border +message |
| Text field | height48, radius8, border1 strong, padding 12; textarea min104; persistent label and error below |
| Slider |44px interaction track,4px visible rail,22px thumb, labelled numeric value, keyboard accessible |
| Toggle |44px hit area;44x26 visual track,20px thumb; explicit label and checked semantics |
| Choice card |min64 high,12px padding,radius 10,1px border; selected soft fill,strong accent border,checkmark |
| Panel |radius14,border1 default,padding16 mobile/24 desktop;flat surface |
| Game tile |phone 3 cols gap8, min 80 high;icon24,label 12 600; radius 12. Selected lilac fill +ink text +checkmark. Inactive surface; disabled text reason |
| Player chip/row |44–48 high,emoji avatar28 in36 circle;name14;Ready includes check+label;host crown+Host;You text; sitting out muted badge |
| Timer ring |44 diameter,stroke3,value14 600; normal primary, last5 danger+digits; paused || icon and Paused label. No blinking |
| Chat |font 13,lines1.4; system muted; correct success-soft/text +check; close warning-soft/text +Almost; guessed secondary-soft/text +Guessed |
| Toast |max360,side gutters16,padding 12,radius 10,icon20,text14; polite status,errors persist until dismissed |
| Sheet |max 90dvh,radius20 top corners,padding16,safe-area bottom;drag-handle decorative;close44,focus trapped,inert background;scroll secondary content |
| Modal |width min(440,100%-32),radius20,padding24;backdrop token,focus trap,return focus,Escape unless server-critical |
| Tabs |44 high,12 horizontal;padding;underline2 or filled segment;aria-selected |
| Playing card |2:3 ratio,min44x66,radius6;white face;red #AF233B and black #171717 suits;rank text;card back lilac geometric pattern |
| Letter grid |7 columns at 320,gap4,key min36x44;correct check and missed strike,disabled semantics;grows when space allows |
| Game board |square flexible 8x8 or actual existing rules grid,thin lines;coordinates;selected thick outline +crosshair. Do not change board size/rules |
| Drawing canvas |white,4:3 preferred, radius8, edge1 default;toolbar44 target buttons,secondary palette horizontal scroll. Use available aspect if viewport short |
| Confetti |SVG/CSS max24 pieces,duration<=900ms,does not block taps;none under reduced motion |

Do not apply UI accent tokens to user drawings or card suit colours. Border3.0 contrast is verified for control strong border against input backgrounds; decorative panel boundaries may be quieter. Body and label pairs must pass4.5; large text3.0. Validate actual composited colours, not isolated hex values.
