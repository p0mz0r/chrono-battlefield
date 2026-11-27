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


UPDATES
-------

When a newer version is out, rhino-race.exe asks "Version X is available.
Update now?" as it starts, before the game window opens. Yes downloads it,
checks it and restarts on the new version with your setup kept; No starts
this version and asks again next time. Offline, it just starts. If an update
fails, the old version starts as before.

Only rhino-race.exe is updated. When a release adds or changes courses, its
release notes say so: download the zip again for the new courses folder.

Antivirus may flag rhino-race.exe for replacing itself, since it isn't
signed. Allow it, or update by unzipping the new release instead.

Each race writes its seed to rhino-race.log in %LOCALAPPDATA%\Rhino Race
(paste that into Explorer's address bar), never on stream: "Rhino Race seed
N: replay with ?course=...&seed=N". Include that line when reporting a race
that went wrong. It is kept when you unzip a newer release elsewhere.


LICENCE
-------

GPL-3.0-or-later, see LICENSE. Source: https://github.com/p0mz0r/chrono-battlefield
Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project
is not affiliated with EA.
