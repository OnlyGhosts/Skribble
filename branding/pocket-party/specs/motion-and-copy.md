# Motion and sound

| Behavior | Duration / curve |
| --- | --- |
| Button hover/focus |100ms ease-out |
| Press |70ms ease-out,translateY1px |
| Route transition |160ms cubic-bezier(.2,.8,.2,1),opacity only;no delay before logic |
| Sheet enter |220ms cubic-bezier(.2,.8,.2,1),translateY16px→0 |
| Modal enter |160ms ease-out,opacity +scale.98→1 |
| Overlay exit |120ms ease-in |
| Toast |160ms enter,120ms exit;informational4s,errorpersistent |
| Card dealing |180ms percard,45ms stagger,translation<=24px |
| Timer |linear1s ringupdates;warningone150ms borderchange at5s;no blink |
| Winner |600ms small mascotbounce +900ms confetti max24 |

Reduced-motion:none of the translation/scale/confetti effects;instant state change or<=80msfade. Never animate canvas input,board positioning or keyboard focus. Sound uses existing opt-in/mute,never autoplay. Short neutral tap andsuccess sounds only if actual app already supplies them;no soundfiles bundled. Countdown sound at<=5s optional andmuted when user preference says so.

# Copy inventory
Home: Join a room; Room code; Join; Create a room.
Identity: Who's playing?; Name; Continue; Randomize.
Room: Copy code; Share invite; Copied; Pick a game; Players; Ready; Sitting out; You; Host; Start · {count} ready.
Empty lobby: No one else is here yet. / Share invite.
Waiting: Waiting for {host} to start.
Win: {name} wins! / {points} points.
Disconnect: Connection lost. Reconnecting… / Retry.
Invite: Join my room on boredgames.io. Code: {code}. {inviteUrl}
Errors: Enter all four characters.; That code isn't valid.; Room not found. Check the code.; This room is full.; Couldn't create the room. Try again.; Couldn't join. Try again.
Game: Your turn; Waiting for {name}; Type your guess…; Send; Submit; Vote; Ready; Fire {cell}; Hit; Stand; Double; Split; Fold; Check; Call {amount}; Raise to {amount}.
Content: Family; Cheeky (only if implemented); Unhinged ·18+.
Results: Play again; Back to lobby; Ready for the next game; Sit this one out.
Use onlyerrors supported by actual backend,not guessed error classifications. Preserve equivalent existing copy for edge cases. No promotional tagline.
