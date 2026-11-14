RHINO RACE
==========

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge
battlefield, in its own window that OBS captures. It reads the art, maps and
sounds from your own RA2 + Yuri's Revenge install; no EA file is in this
download. Needs Windows 10 or 11 (with Microsoft Edge, which Windows includes),
OBS Studio and an RA2 + Yuri's Revenge install.


START THE GAME
--------------

1. Unzip this folder somewhere it can stay, e.g. Documents\rhino-race.
2. Double-click rhino-race.exe. The first time, Windows may say "Windows
   protected your PC": click More info > Run anyway.
3. The game opens in its own window, and the first time its setup guides you
   through the rest: install, chat, OBS, courses, race setup, keys and a
   trial race. F2 opens setup again between races.

Closing the game window stops the game. Your setup is kept for this Windows
user, also when you unzip a newer release elsewhere.


KEYS
----

Click into the game window; the keys work while it has focus:
  S       race setup (course, join window, finish timer, audience interactions)
  Enter   start: open the join window
  P       pause / resume
  E E     end or cancel the race (press E twice within three seconds)
  C       camera: Overview / Director
          Overview: drag to pan, wheel to zoom
  1-9, 0  Director: cut to the tank in that place (0 = tenth), unless finished
  M       mute (remembered)
  F2      setup (between races)

Enter opens the join window with the last race setup, or opens race setup the
first time. The results screen shows both keys (Enter next race, S race setup).


CHAT COMMANDS
-------------

A command is the line alone, plus at most its one argument; case and extra
spaces don't matter, anything else is ignored. The stream lists the commands
that work right now.

Join window:
  !rhino               join the race (empty places are filled with bots)

During the race (each viewer waits a cooldown between commands):
  !boost [name]        a short burst of speed for a tank
  !shield              racers only: block harmful interactions for a moment
  !missile [name]      homing missile that stuns a tank (random without name)
  !v3 [back|fwd]       racers only: rocket in a straight line from your tank
  !tesla [name]        Tesla strike that stuns every tank near one
  !bridge B1           destroy that bridge (only courses with bridges in play)
  !nuke                only when the hype meter is full: enough viewers set
                       it off and every tank is stunned

Race setup switches each interaction on or off.

Each race writes its seed to rhino-race.log beside rhino-race.exe, never on
stream: "Rhino Race seed N: replay with ?course=...&seed=N". Include that line
when reporting a race that went wrong.


LICENCE
-------

GPL-3.0-or-later, see LICENSE. Source: https://github.com/p0mz0r/chrono-battlefield
Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project
is not affiliated with EA.
