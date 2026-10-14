# Sound credits

Every recorded sound here comes from a [Kenney](https://kenney.nl) audio pack, released under
**Creative Commons Zero (CC0 1.0)**: <https://creativecommons.org/publicdomain/zero/1.0/>. No
attribution is required; it is given here anyway, with the original file each one was made from.

Packs used (each downloaded as the zip linked from its page):

| Pack | Page | Licence |
| --- | --- | --- |
| Casino Audio (1.1) | <https://kenney.nl/assets/casino-audio> | CC0 |
| Interface Sounds | <https://kenney.nl/assets/interface-sounds> | CC0 |
| UI Audio | <https://kenney.nl/assets/ui-audio> | CC0 |
| Impact Sounds | <https://kenney.nl/assets/impact-sounds> | CC0 |
| Sci-Fi Sounds | <https://kenney.nl/assets/sci-fi-sounds> | CC0 |
| Music Jingles | <https://kenney.nl/assets/music-jingles> | CC0 |

Every file was transcoded with ffmpeg to mono MP3 (64 kbps, 80 kbps for the musical stings),
silence trimmed at both ends and loudness evened out. `scripts/sounds/build.sh` with
`scripts/sounds/map.txt` rebuilds the whole folder from the packs.

## Files

| File | Pack | Original file | Licence |
| --- | --- | --- | --- |
| `ui/pop.mp3` | Interface Sounds | `Audio/drop_002.ogg` | CC0 |
| `ui/click.mp3` | UI Audio | `Audio/click2.ogg` | CC0 |
| `ui/key.mp3` | Interface Sounds | `Audio/select_002.ogg` | CC0 |
| `ui/chime.mp3` | Interface Sounds | `Audio/glass_001.ogg` | CC0 |
| `ui/blip.mp3` | Interface Sounds | `Audio/pluck_002.ogg` | CC0 |
| `ui/buzz.mp3` | Interface Sounds | `Audio/error_002.ogg` | CC0 |
| `ui/buzzer.mp3` | Interface Sounds | `Audio/error_006.ogg` | CC0 |
| `stings/start.mp3` | Music Jingles | `Audio/Pizzicato jingles/jingles_PIZZI10.ogg` | CC0 |
| `stings/fanfare.mp3` | Music Jingles | `Audio/Steel jingles/jingles_STEEL02.ogg` | CC0 |
| `stings/game-over.mp3` | Music Jingles | `Audio/Pizzicato jingles/jingles_PIZZI13.ogg` | CC0 |
| `stings/turn-end.mp3` | Music Jingles | `Audio/Pizzicato jingles/jingles_PIZZI06.ogg` | CC0 |
| `stings/win.mp3` | Music Jingles | `Audio/Steel jingles/jingles_STEEL10.ogg` | CC0 |
| `stings/solved.mp3` | Music Jingles | `Audio/Pizzicato jingles/jingles_PIZZI02.ogg` | CC0 |
| `stings/lose.mp3` | Music Jingles | `Audio/Pizzicato jingles/jingles_PIZZI04.ogg` | CC0 |
| `stings/sly.mp3` | Music Jingles | `Audio/Sax jingles/jingles_SAX12.ogg` | CC0 |
| `stings/sink.mp3` | Music Jingles | `Audio/8-Bit jingles/jingles_NES12.ogg` | CC0 |
| `table/deal-1.mp3` | Casino Audio | `Audio/card-slide-1.ogg` | CC0 |
| `table/deal-2.mp3` | Casino Audio | `Audio/card-slide-3.ogg` | CC0 |
| `table/deal-3.mp3` | Casino Audio | `Audio/card-slide-5.ogg` | CC0 |
| `table/flip.mp3` | Casino Audio | `Audio/card-place-2.ogg` | CC0 |
| `table/place-1.mp3` | Casino Audio | `Audio/card-place-1.ogg` | CC0 |
| `table/place-2.mp3` | Casino Audio | `Audio/card-place-4.ogg` | CC0 |
| `table/toss.mp3` | Casino Audio | `Audio/card-shove-1.ogg` | CC0 |
| `table/shuffle.mp3` | Casino Audio | `Audio/card-shuffle.ogg` (first 2.2 s, faded) | CC0 |
| `table/chip-lay-1.mp3` | Casino Audio | `Audio/chip-lay-1.ogg` | CC0 |
| `table/chip-lay-2.mp3` | Casino Audio | `Audio/chip-lay-3.ogg` | CC0 |
| `table/chips-1.mp3` | Casino Audio | `Audio/chips-stack-1.ogg` | CC0 |
| `table/chips-2.mp3` | Casino Audio | `Audio/chips-stack-3.ogg` | CC0 |
| `table/collect.mp3` | Casino Audio | `Audio/chips-handle-1.ogg` | CC0 |
| `table/push-all.mp3` | Casino Audio | `Audio/chips-handle-5.ogg` | CC0 |
| `table/knock.mp3` | Impact Sounds | `Audio/impactWood_light_002.ogg` then `Audio/impactWood_light_000.ogg` 0.14 s later | CC0 |
| `table/thud.mp3` | Impact Sounds | `Audio/impactSoft_heavy_000.ogg` | CC0 |
| `table/natural.mp3` | Interface Sounds | `Audio/confirmation_002.ogg` | CC0 |
| `battleships/dice.mp3` | Casino Audio | `Audio/dice-throw-1.ogg` | CC0 |
| `battleships/cannon.mp3` | Sci-Fi Sounds | `Audio/lowFrequency_explosion_001.ogg` (first 0.8 s, faded) | CC0 |
| `battleships/hit.mp3` | Sci-Fi Sounds | `Audio/explosionCrunch_000.ogg` | CC0 |
| `battleships/sink.mp3` | Sci-Fi Sounds | `Audio/explosionCrunch_004.ogg` (first 1.6 s, faded) | CC0 |
| `battleships/thud.mp3` | Impact Sounds | `Audio/impactPunch_heavy_002.ogg` | CC0 |
| `hangman/scratch.mp3` | Interface Sounds | `Audio/scratch_005.ogg` | CC0 |
| `spygame/gavel.mp3` | Impact Sounds | `Audio/impactWood_heavy_002.ogg` then `Audio/impactWood_heavy_000.ogg` 0.2 s later | CC0 |

## Made in code

No CC0 recording fitted these, so they are synthesised with Web Audio buffers in
`client/src/platform/lib/audio/synth.ts`: the splash (filtered noise, a falling plop and a few
drops), the whoosh (band-passed noise sweeping up and down), the drumroll (noise bursts speeding
up, with an accent and a low drum), the applause (many short band-passed noise claps over a soft
bed), and the short note cues kept from before (your turn, the last-seconds tick, the old
correct, turn end and fanfare cues).

## What plays when

| Game | Event | Sound | Source |
| --- | --- | --- | --- |
| Platform | Someone joins between games | `ui/pop.mp3` | Interface Sounds |
| Platform | You ready up (or count yourself in) | `ui/click.mp3` | UI Audio |
| Platform | The game starts | `stings/start.mp3` | Music Jingles |
| Platform | Your turn | note cue | made in code |
| Platform | Last 5 seconds of your clock | tick cue | made in code |
| Platform | Podium, on the winner's phone | `stings/fanfare.mp3` | Music Jingles |
| Platform | Podium, on everyone else's | `stings/game-over.mp3` | Music Jingles |
| Blackjack | Each card dealt, as it lands | `table/deal-1/2/3.mp3` | Casino Audio |
| Blackjack | Hole card turns over | `table/flip.mp3` | Casino Audio |
| Blackjack | A bet goes down (doubles and splits too) | `table/chip-lay-1/2.mp3` | Casino Audio |
| Blackjack | Your chips won | `table/collect.mp3` | Casino Audio |
| Blackjack | Your push | `ui/click.mp3` | UI Audio |
| Blackjack | Your hand busts | `table/thud.mp3` | Impact Sounds |
| Blackjack | Your blackjack | `table/natural.mp3` | Interface Sounds |
| Blackjack | The shoe is reshuffled | `table/shuffle.mp3` | Casino Audio |
| Poker | Hole cards dealt | `table/deal-1/2/3.mp3` | Casino Audio |
| Poker | Flop, turn and river | `table/place-1/2.mp3` | Casino Audio |
| Poker | Hands turn over at a showdown | `table/flip.mp3` | Casino Audio |
| Poker | Check | `table/knock.mp3` | Impact Sounds |
| Poker | Blinds, call, bet, raise | `table/chips-1/2.mp3` | Casino Audio |
| Poker | Bets swept into the pot | `table/chips-1/2.mp3` (soft) | Casino Audio |
| Poker | All in | `table/push-all.mp3` | Casino Audio |
| Poker | Fold | `table/toss.mp3` | Casino Audio |
| Poker | Pot slides to a winner | `table/collect.mp3` | Casino Audio |
| Poker | You won chips this hand | `stings/win.mp3` | Music Jingles |
| Battleships | The turn's die is rolled | `battleships/dice.mp3` | Casino Audio |
| Battleships | A shot is fired | `battleships/cannon.mp3` | Sci-Fi Sounds |
| Battleships | Miss | splash | made in code |
| Battleships | Hit | `battleships/hit.mp3` | Sci-Fi Sounds |
| Battleships | Sunk | `battleships/sink.mp3`, then `stings/sink.mp3` for the shooter's side | Sci-Fi Sounds, Music Jingles |
| Battleships | Your side moved a ship (only on your side) | whoosh | made in code |
| Battleships | Your ship is hit | `battleships/thud.mp3` | Impact Sounds |
| Scribble | The drawer picks the word | `ui/pop.mp3` | Interface Sounds |
| Scribble | Someone guesses the word (louder when it is you) | `ui/chime.mp3` | Interface Sounds |
| Scribble | Your guess is close | `ui/blip.mp3` | Interface Sounds |
| Scribble | Time runs out | `ui/buzzer.mp3` | Interface Sounds |
| Scribble | The turn ends | `stings/turn-end.mp3` | Music Jingles |
| Hangman | You tap a letter | `ui/key.mp3` | Interface Sounds |
| Hangman | A right letter | `ui/chime.mp3` | Interface Sounds |
| Hangman | A wrong letter or word | `ui/buzz.mp3` | Interface Sounds |
| Hangman | A section of the figure is drawn | `hangman/scratch.mp3` | Interface Sounds |
| Hangman | The word is solved | `stings/solved.mp3` | Music Jingles |
| Hangman | The hangman wins | `stings/lose.mp3` | Music Jingles |
| Spy Game | Your role is dealt for the round | whoosh | made in code |
| Spy Game | Someone calls an accusation | `spygame/gavel.mp3` | Impact Sounds |
| Spy Game | You cast a vote | `ui/click.mp3` | UI Audio |
| Spy Game | The spy is caught (the agents take the round) | `stings/win.mp3` | Music Jingles |
| Spy Game | The spy wins the round | `stings/sly.mp3` | Music Jingles |
| Spy Game | The spy guesses a wrong location | `ui/buzz.mp3` | Interface Sounds |
| Quip Game | You submit an answer | `ui/pop.mp3` | Interface Sounds |
| Quip Game | You vote or send your ranking | `ui/click.mp3` | UI Audio |
| Quip Game | A matchup's result is revealed | drumroll | made in code |
| Quip Game | A flawless or big win, and the final's result | applause | made in code |

Shared table moments (another seat's cards, chips and outcomes) play at half the level the
player's own get.
