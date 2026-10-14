# Screen implementation

## Responsive frame
Mobile side gutters16, max content440. Desktop max1120, gutters32, home max840 with two equal panels. App shell min-height100dvh with safe-area padding. Game shell grid rows auto minmax(0,1fr) auto, max-height100dvh; children min-height0. Secondary panels use sheets on phones and sidebars desktop. No giant artwork or filler section. At320x568 shrink home header spacing and mascot size before shrinking controls.

## Home
Header wordmark +small mascot pair. No tagline. Gap32 desktop/20 mobile. Join panel heading22,Room code label 12,four separate boxes,Join button. Second panel Create a room button; short helper only if useful. In dark mode Join lime,Create outline. Desktop side-by-side with baseline aligned. Mobile stacked. Exactly two action paths. Boxes empty initially; K7QX on references is an example, not default input. Autocapitalize, paste distributes,invalid chars filtered according to server alphabet,backspace returns,arrows navigate,Enter submit,no auto-submit on fourth character. Preserve input on error.

## Name
Who's playing? Name field,max existing16 characters,emoji preview,avatar palette,randomize if existing,Continue primary. Label host context only when relevant. Emoji first-class,never replace identity with mascot. Keep existing remembered name.

## Lobby
Top bar brand,room code +copy/share,settings existing flow. Phone: room bar then three-column seven-game grid thenplayers then host settings/chat access thenStart sticky footer. Long lobby sections scroll,footer never covers content. Selected tile lilac, dark ink icon/name +check. Seven games keep actual names. Settings/content preserve existing Family/Cheeky/Unhinged modes where implemented; mark18+ visibly. Ready/Sitting out,You/Host explicit. Start shows actual ready count anddisabled reason. No decorative screen-filling hero.

## Skribble
Compact round/timer/player/chat/menu bar. White canvas central. Drawer role:tools,palette,undo controls. Guesser role:guess textbox +Send,chat/score sheet. Never show a guesser drawing toolbar. Prompt secret/private by role,not leaked. Keep existing turn info and websocket timing.

## Spy Game
Accent teal;location card with small flat SVG illustration or icon. Clear You are the spy /You are not the spy text;private location hidden from spy. Questions/player status in sheet. Existing voting/guess counts unchanged.

## Quip Game
Accent amber;prompt panel,answer textarea,native keyboard,character count,Submit. Voting shows equal answer cards with explicit selected check,Vote,submitted count;anonymous answers remain anonymous until existing reveal phase.

## Hangman
Accent coral;word slots +remaining-lives text,white drawing canvas and either drawer toolbar or guesser letter grid. Grid7 columns at 320;44px vertical targets. Secret word private. Use actual drawing steps,word handling and rules.

## Battleships
Accent blue;top turn/timer,compact fleet/opponent tabs,square grid with coordinates,ship/status controls pinned underneath. Placement/dice-move/aim phases have their existing relevant controls. Selected cell crosshair +label (e.g.F1); hit/miss use symbols as well as colour. Sheet forplayer lists/chat.

## Blackjack
Accent green;dark surface table,white cards with red/black suits,dealer/player score tags,chip balance text,bets via real stepper/slider andquick chips. Playing phase Hit/Stand/Double/Split only as allowed. Disabled reason explicit. All balances areexisting virtual chips; no invented real-money claims.

## Poker
Accent pink;community cards,pot,currentturn label,compact seats andown private cards;fold/check/call/raise controls match actual legal options. Raise amount field native keyboard or existing slider. Seatlist sheet on mobile. No gameplay/rule changes.

## Round and turn results
Compact result panel,score delta,correct answer/reveal if phase permits,next-turnstatus,returnto original game rather than new navigation. Neutral space with game's accent. Avoid interrupting realtime flow with forced modal if it doesn't exist.

## Podium
Lime happy phone max 96height;winnername+points;top3 podiumsmall blocks usinglime/lilac/neutral;full standings list withnames andscore. Primary Ready for next game,secondarySit out;hostPlay again andBack to lobby. Preserve host-only controls andexisting next-game flow. Confetti brief andoptional; no continuous celebratory motion.
