RHINO RACE
==========

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge
battlefield, run in its own window that OBS captures. It reads the art, maps
and sounds from your own RA2 + Yuri's Revenge install; no EA file is in this
download.

Needs Windows 10 or 11 (with Microsoft Edge, which Windows includes), OBS
Studio and an RA2 + Yuri's Revenge install.


START THE GAME
--------------

1. Unzip this folder somewhere it can stay, e.g. Documents\rhino-race.
2. Double-click rhino-race.exe. The first time, Windows may say "Windows
   protected your PC": click More info > Run anyway.
   The game opens in its own window (an Edge window with no tabs or address
   bar). Closing that window stops the game. Starting rhino-race.exe again
   while it runs just brings the window back.
3. The game looks for the install by itself. If it shows the install setup
   screen instead, type the folder that holds ra2.mix and ra2md.mix and click
   "Use this folder". F2 opens that screen again later, between races.

Setup, chat login and race choices are kept for this Windows user (in
%LOCALAPPDATA%\Rhino Race), also when you unzip a newer release elsewhere.


SET UP OBS
----------

1. Video: Sources > + > Window Capture. Window: "[msedge.exe]: Rhino Race".
   Capture method: Windows 10 (1903 and up). Untick "Capture Cursor".
2. Sound: Sources > + > Application Audio Capture. Window: the same
   "[msedge.exe]: Rhino Race". The game gets its own mixer channel.
3. Size the game window to fill your canvas (e.g. maximise it on a 1920x1080
   screen), or right-click the capture > Transform > Fit to screen.
Leave the game window open while streaming. Behind other windows is fine (it
keeps full speed); minimised is not: OBS then shows a black screen.


RUNNING A RACE
--------------

Click into the game window; the keys work while it has focus:
  S       race setup (course, join window, finish timer, audience interactions)
  Enter   start: open the join window
  P       pause / resume
  E E     end or cancel the race
  C       camera: Overview / Director
  M       mute (remembered)
  F2      install setup (between races)

Enter opens the join window with the last race setup, or opens race setup the
first time. The results screen shows both keys (Enter next race, S race setup).
Viewers join with !rhino in chat; empty places are filled with bots. Press E
twice within three seconds to end or cancel a race.

Chat comes in through Streamer.bot or by logging in to Twitch directly: pick
one under Chat source in install setup (F2). Do install setup before you go
live: OBS captures the whole game window, Twitch login code included.

Each race writes its seed to rhino-race.log beside rhino-race.exe, never on
stream: "Rhino Race seed N: replay with ?course=...&seed=N". Include that line
when reporting a race that went wrong.


ADDING COURSES
--------------

Ask the course maker for the course's .rhino-course.json file (one file per
course; a course on a custom map has the map inside). In the game window,
press S for race setup, choose Import courses..., and pick the file(s). Imported
courses appear in the course list marked "imported" and stay until you
Remove them there, also after a restart or a newer release.

LICENCE
-------

GPL-3.0-or-later, see LICENSE. Source: https://github.com/p0mz0r/chrono-battlefield
Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project
is not affiliated with EA.
