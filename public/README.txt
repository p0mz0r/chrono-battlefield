RHINO RACE
==========

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge
battlefield, shown as an OBS browser source. It reads the art, maps and sounds
from your own RA2 + Yuri's Revenge install; no EA file is in this download.

Needs OBS Studio 30 or later and an RA2 + Yuri's Revenge install.


SET UP IN OBS
-------------

1. Unzip this folder somewhere it can stay, e.g. Documents\rhino-race.
2. In OBS, add a source: Sources > + > Browser. Name it "Rhino Race".
   - Tick "Local file" and browse to index.html in this folder.
   - Width 1920, height 1080.
   - Tick "Control audio via OBS" (the game gets its own mixer channel).
   - Untick "Shutdown source when not visible".
3. The page looks for the install by itself. If it shows the install setup
   screen instead, right-click the source > Interact, and choose the install
   folder (the one with ra2.mix and ra2md.mix). Choosing copies the files the
   game needs (about 600 MB) into OBS once; typing the folder's path instead
   reads it in place.
   F2 in Interact opens that screen again later, between races.
4. Add the hotkey script: Tools > Scripts > + > chrono-battlefield.lua (in
   this folder). Pick the "Rhino Race" source in the script settings.
5. In Settings > Hotkeys, bind the six "Rhino Race" actions: Start race,
   Race setup, Pause / resume, End race, Camera mode, Mute. They work while OBS is
   unfocused and from a Stream Deck System > Hotkey button. Choose key
   combinations no other app uses, and don't bind the plain Enter, P, E, C or
   M keys (those are the page keys below).


RUNNING A RACE
--------------

Start race opens the join window with the last race setup, or opens race
setup the first time; Race setup opens it between races. The results screen
shows both keys (Enter next race, S race setup). Viewers join with !rhino in chat; empty places are
filled with bots. Press End race twice within three seconds to end or cancel
a race.

Each race writes its seed to the OBS log (Help > Log Files > View Current
Log), never on stream: "Rhino Race seed N: replay with ?course=...&seed=N".
Include that line when reporting a race that went wrong.

The game doesn't connect to Twitch, YouTube or other chat itself. A chat
tool such as Streamer.bot passes chat lines in through obs-websocket: request
CallVendorRequest, vendor "obs-browser", request "emit_event", data
  {"event_name": "chronoChat",
   "event_data": {"viewerId": "twitch:123", "name": "Viewer", "text": "!rhino"}}
viewerId must be unique per viewer (e.g. platform + user id). Without chat
lines, a join window with no viewers closes and the game goes back to waiting.

Keys inside Interact:
  S       race setup (course, join window, finish timer, audience interactions)
  Enter   start: open the join window
  P       pause / resume
  E E     end or cancel the race
  C       camera: Overview / Director
  M       mute (remembered)
  F2      install setup (between races)


LICENCE
-------

GPL-3.0-or-later, see LICENSE. Source: https://github.com/p0mz0r/chrono-battlefield
Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project
is not affiliated with EA.
