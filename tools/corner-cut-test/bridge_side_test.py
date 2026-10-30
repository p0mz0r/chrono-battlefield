"""Issue #66: can a tank use the side cells of a high bridge deck?

FA2 places a high bridge as one line of overlay cells, but the art is about three
cells wide. This loads Hills (the install's loose copy, Maps/Yuri's Revenge/xhills.map,
same terrain and overlays as Hills.mmx) with two Rhinos at the ends of its long
wooden bridge, overlay line (76..97, 75), and records what they do:

  1. Head-on: W drives from the west end to the east end, E the other way, at once.
     They pass side by side on the deck  -> the deck is wider than its overlay line.
     One waits, backs off or detours     -> the deck is one cell wide.
  2. Side cells: W then drives to (86, 74), E to (86, 76), the cells either side of
     the deck's middle. A destination spanned by a bridge is reached at deck height,
     so a Rhino that stops up on the deck means the game counts that cell as deck;
     one that drives down and round to the ground below means it doesn't.

Usage:
  python bridge_side_test.py map OUT.map   write the map only
  python bridge_side_test.py run OUT.mp4   launch and record, as corner_cut_test.py run

RA2_DIR names the install (docs/agents/ra2-install.md).
"""

import os
import re
import sys

from corner_cut_test import run, team_type, waypoint_letters

WEST, EAST = (73, 75), (101, 75)  # Bridge Run's waypoints just off each end of the deck
SIDES = {"W": (86, 74), "E": (86, 76)}
CAMERA = (86, 75)
DRIVE_AT = 25  # elapsed-time units, ~2 s at top speed (see corner_cut_test.py)
RECORD_S = 60


def build_map():
    path = os.path.join(os.environ["RA2_DIR"], "Maps", "Yuri's Revenge", "xhills.map")
    text = open(path, encoding="latin1").read().replace("\r\n", "\n")
    text = re.sub(r"\n\[Digest\]\n[^[]*", "\n", text)  # we change the map, so its digest no longer holds

    wps = {9: CAMERA, 10: WEST, 11: EAST, 12: SIDES["W"], 13: SIDES["E"]}  # Hills uses 0-3 and 78-99
    add = {"Waypoints": [f"{n}={y * 1000 + x}" for n, (x, y) in wps.items()],
           "Triggers": [], "Events": [], "Actions": [], "Tags": []}
    sections = []
    for i, (name, start, goal, side) in enumerate([("W", 10, 11, 12), ("E", 11, 10, 13)]):
        tf, sc, tm, tr, tg = (f"0660{i}{k}00" for k in "12345")
        sections += [f"[{tf}]\nName=Rhino {name}\n0=1,HTNK\nGroup=-1",
                     f"[{sc}]\nName=Cross {name}\n0=3,{goal}\n1=3,{side}",
                     team_type(tm, f"Bridge {name}", tf, sc, start)]
        add["Triggers"].append(f"{tr}=Neutral,<none>,Bridge {name},0,1,1,1,0")
        add["Events"].append(f"{tr}=1,13,0,{DRIVE_AT}")
        add["Actions"].append(f"{tr}=1,80,1,{tm},0,0,0,0,{waypoint_letters(start)}")
        add["Tags"].append(f"{tg}=0,Bridge {name},{tr}")
    # Reveal the map (action 16) and centre the camera on the bridge (112) at start.
    add["Triggers"].append("06609400=Neutral,<none>,Reveal,0,1,1,1,0")
    add["Events"].append("06609400=1,13,0,0")
    add["Actions"].append(f"06609400=2,16,0,0,0,0,0,0,A,112,0,0,0,0,0,0,{waypoint_letters(9)}")
    add["Tags"].append("06609500=0,Reveal,06609400")

    for section, lines in add.items():
        text = text.replace(f"\n[{section}]\n", f"\n[{section}]\n" + "".join(l + "\n" for l in lines), 1)
    listing = {"TaskForces": sections[0::3], "ScriptTypes": sections[1::3], "TeamTypes": sections[2::3]}
    for section, bodies in listing.items():
        ids = [b[1:b.index("]")] for b in bodies]
        text += f"\n[{section}]\n" + "".join(f"{n}={k}\n" for n, k in enumerate(ids)) + "\n" + "\n\n".join(bodies) + "\n"
    return text


if __name__ == "__main__":
    if sys.argv[1:2] == ["map"]:
        with open(sys.argv[2], "w", newline="\r\n") as f:
            f.write(build_map())
    elif sys.argv[1:2] == ["run"] and len(sys.argv) == 3:
        run(sys.argv[2], build_map(), RECORD_S)
    else:
        sys.exit(__doc__)
