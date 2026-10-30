"""Issue #18: does RA2 let a tank cut a corner between two blockers?

Writes a flat skirmish map with four lanes and launches it through the CnCNet
spawner already in the install (gamemd-spawn.exe -SPAWN), windowed. At game
start a trigger hands each lane's Rhino to the player and a team script drives
it to the bottom of its lane, so nobody has to click anything.

Lanes, left to right on screen:
  A  wall of barricades, diagonal gaps only   (both orthogonal neighbours blocked)
  B  one barricade beside the diagonal path   (one orthogonal neighbour blocked)
  C  wall of trees, diagonal gaps only
  D  one tree beside the diagonal path

Reading the result:
  A/C  Rhino drives straight through the wall -> corner-cutting allowed.
       Rhino detours around the end of the wall -> refused.
  B/D  Rhino keeps a straight vertical line -> allowed with one blocked neighbour.
       Rhino jogs sideways around the blocker -> refused.

Usage:
  python corner_cut_test.py map OUT.map   write the map only (open it in Final Alert 2)
  python corner_cut_test.py run OUT.mp4   back up spawn files, launch windowed, record the
                                          window with ffmpeg for RECORD_S, quit, restore

The Rhinos drive about 2 s after the map appears (~10 s into the video) and take
about 2 s, so step through that stretch frame by frame. Needs Syringe.exe in the
install (Defender likes to quarantine it) and ffmpeg on PATH.

RA2_DIR names the install (docs/agents/ra2-install.md).
"""

import base64
import os
import shutil
import struct
import subprocess
import sys

W = H = 50  # [Map] Size; screen-space u = x - y spans about -W..W, v = x + y spans W..W+2H
TEST_ROW = W + H  # v of the wall row, about the map's vertical middle (even, so it lands on cells)
LANES = [("A", -20, "CABARR01", "wall"), ("B", -6, "CABARR01", "single"),
         ("C", 6, "TREE01", "wall"), ("D", 20, "TREE01", "single")]  # all fit one 1920x1080 view
DRIVE_AT = 25  # trigger elapsed-time units, not seconds: at top game speed this is ~2 s
RECORD_S = 30
CAMERA = 9  # waypoint the view jumps to; 0-7 are start locations
RUN_IN = 8  # cells above the wall the Rhino starts, and below it the waypoint sits


def cell(u, v):
    """Screen-space (u right, v down) to RA2 iso cell (x, y)."""
    assert (u + v) % 2 == 0, (u, v)
    return (u + v) // 2, (v - u) // 2


def all_cells():
    # Cell enumeration used by FA2 and CNCMaps for a Size of W x H.
    for y in range(H):
        for x in range(W * 2 - 2, -1, -1):
            dy = y * 2 + x % 2
            rx = (x + dy) // 2 + 1
            yield rx, dy - rx + W + 1


def lzo_literal(data):
    """LZO1X stream that stores data as one literal run (valid, just uncompressed)."""
    n = len(data)
    assert n >= 19
    r = n - 18
    zeros = (r - 1) // 255
    return b"\x00" + b"\x00" * zeros + bytes([r - 255 * zeros]) + data + b"\x11\x00\x00"


def iso_map_pack():
    raw = b"".join(struct.pack("<hhiBBB", x, y, 0, 0, 0, 0) for x, y in all_cells())
    out = b""
    for i in range(0, len(raw), 8184):
        chunk = raw[i:i + 8184]
        packed = lzo_literal(chunk)
        out += struct.pack("<HH", len(packed), len(chunk)) + packed
    b64 = base64.b64encode(out).decode()
    return "\n".join(f"{i + 1}={b64[j:j + 70]}" for i, j in enumerate(range(0, len(b64), 70)))


def build_map():
    terrain, structures, waypoints = [], [], {}
    units, taskforces, scripts, teams, triggers, events, actions, tags = ([] for _ in range(8))

    def wp(n, u, v):
        x, y = cell(u, v)
        waypoints[n] = y * 1000 + x

    # Player start (MCV) sits between lanes B and C so the opening camera frames all four.
    wp(0, 0, TEST_ROW - 4)
    wp(1, 0, W + 8)  # AI, top of the map, clear of the lanes
    wp(CAMERA, 0, TEST_ROW)

    for i, (name, uc, blocker, kind) in enumerate(LANES):
        # Path runs straight down the screen along u = uc + 1: every step is a
        # diagonal iso step. Its orthogonal neighbours at the wall row are
        # (uc, TEST_ROW) and (uc + 2, TEST_ROW).
        if kind == "wall":
            blocked = [(uc + 2 * k, TEST_ROW) for k in range(-3, 4)]
        else:
            blocked = [(uc, TEST_ROW)]
        for u, v in blocked:
            x, y = cell(u, v)
            if blocker.startswith("TREE"):
                terrain.append(f"{y * 1000 + x}={blocker}")
            else:
                structures.append(f"{len(structures)}=Neutral,{blocker},256,{x},{y},0,None,0,0,0,0,0,None,None,None,0,0")

        start, goal = 10 + 2 * i, 11 + 2 * i
        wp(start, uc + 1, TEST_ROW - RUN_IN - 1)
        wp(goal, uc + 1, TEST_ROW + RUN_IN + 1)

        tf, sc, tm, tr, tg = (f"0100{i}{k}00" for k in "12345")
        taskforces.append((tf, f"[{tf}]\nName=Rhino {name}\n0=1,HTNK\nGroup=-1"))
        scripts.append((sc, f"[{sc}]\nName=Drive {name}\n0=3,{goal}"))
        teams.append((tm, team_type(tm, f"Lane {name}", tf, sc, start)))
        # Event 13 = elapsed time; action 80 = reinforcement at waypoint, 112 = jump camera to waypoint.
        triggers.append(f"{tr}=Neutral,<none>,Lane {name},0,1,1,1,0")
        events.append(f"{tr}=1,13,0,{DRIVE_AT}")
        actions.append(f"{tr}=2,80,1,{tm},0,0,0,0,{waypoint_letters(start)},"
                       f"112,0,0,0,0,0,0,{waypoint_letters(CAMERA)}")
        tags.append(f"{tg}=0,Lane {name},{tr}")

    # Reveal the whole map at start (action 16) so screenshots show every lane.
    triggers.append("01009400=Neutral,<none>,Reveal,0,1,1,1,0")
    events.append("01009400=1,13,0,0")
    actions.append(f"01009400=2,16,0,0,0,0,0,0,A,112,0,0,0,0,0,0,{waypoint_letters(CAMERA)}")
    tags.append("01009500=0,Reveal,01009400")

    def listing(section, items):
        return f"[{section}]\n" + "\n".join(f"{n}={k}" for n, (k, _) in enumerate(items)) + "\n\n" + \
            "\n\n".join(body for _, body in items)

    return f"""[Basic]
Name=Corner cut test (issue 18)
NewINIFormat=4
Official=no
MultiplayerOnly=1
Percent=0
InitTime=10000
IgnoreGlobalAITriggers=yes

[Map]
Theater=TEMPERATE
Size=0,0,{W},{H}
LocalSize=2,4,{W - 4},{H - 8}

[Header]
NumberStartingPoints=2

[SpecialFlags]
FogOfWar=no
Inert=no
DestroyableBridges=yes
MCVDeploy=no
InitialVeteran=no
FixedAlliance=no
HarvesterImmune=no
TiberiumGrows=no
TiberiumSpreads=no
IonStorms=no
Meteorites=no
Visceroids=no

[Lighting]
Ambient=1.000000
Red=1.000000
Green=1.000000
Blue=1.000000
Ground=0.000000
Level=0.000000

[Waypoints]
{chr(10).join(f"{n}={c}" for n, c in sorted(waypoints.items()))}

[Terrain]
{chr(10).join(terrain)}

[Structures]
{chr(10).join(structures)}

{listing("TaskForces", taskforces)}

{listing("ScriptTypes", scripts)}

{listing("TeamTypes", teams)}

[Triggers]
{chr(10).join(triggers)}

[Events]
{chr(10).join(events)}

[Actions]
{chr(10).join(actions)}

[Tags]
{chr(10).join(tags)}

[IsoMapPack5]
{iso_map_pack()}
"""


def team_type(tm, name, tf, sc, start):
    """A one-shot team for the player at start A that runs script sc from waypoint start."""
    return f"""[{tm}]
Name={name}
House=<Player @ A>
TaskForce={tf}
Script={sc}
Waypoint={waypoint_letters(start)}
VeteranLevel=1
MindControlDecision=0
Loadable=no
Full=no
Annoyance=no
GuardSlower=no
Recruiter=no
Autocreate=no
Prebuild=no
Reinforce=no
Droppod=no
UseTransportOrigin=no
Whiner=no
LooseRecruit=no
Aggressive=no
Suicide=no
Priority=5
Max=1
TechLevel=0
Group=-1
OnTransOnly=no
AvoidThreats=no
IonImmune=no
TransportsReturnOnUnload=no
AreTeamMembersRecruitable=no
IsBaseDefense=no
OnlyTargetHouseEnemy=no"""


def waypoint_letters(n):
    """FA2 waypoint letters: A=0 ... Z=25, AA=26 ..."""
    s = chr(ord("A") + n % 26)
    n //= 26
    while n:
        s = chr(ord("A") + (n - 1) % 26) + s
        n = (n - 1) // 26
    return s


SPAWN_INI = """[Settings]
Name=Tester
Scenario=spawnmap.ini
UIGameMode=Battle
UIMapName=Corner cut test
PlayerCount=1
Side=6
Color=0
AIPlayers=1
Seed=18
ShortGame=False
MCVRedeploy=True
Crates=False
MultiEngineer=False
AlliesAllowed=False
BridgeDestroy=True
Superweapons=False
BuildOffAlly=False
Ra2Mode=False
Credits=10000
UnitCount=0
GameSpeed=0
Bases=Yes
FogOfWar=No
GameMode=1

[HouseHandicaps]
Multi2=0

[SpawnLocations]
Multi1=0
Multi2=1

[HouseCountries]
Multi2=0

[HouseColors]
Multi2=3
"""


def run(video, map_text=None, record_s=RECORD_S):
    ra2 = os.environ["RA2_DIR"]
    # The CnCNet client owns these; put them back after the game exits.
    touched = {"spawn.ini": SPAWN_INI, "spawnmap.ini": map_text or build_map()}
    backups = {}
    for name, text in touched.items():
        path = os.path.join(ra2, name)
        if os.path.exists(path):
            backups[path] = path + ".issue18.bak"
            shutil.copy2(path, backups[path])
        with open(path, "w", newline="\r\n") as f:
            f.write(text)
    windowed = [("RA2MD.ini", "Video.Windowed=False", "Video.Windowed=True"),
                ("RA2MD.ini", "ScreenWidth=1024", "ScreenWidth=1920"),
                ("RA2MD.ini", "ScreenHeight=768", "ScreenHeight=1080"),
                ("ddraw.ini", "windowed=False", "windowed=True")]
    for name, old, new in windowed:
        path = os.path.join(ra2, name)
        if path not in backups:
            backups[path] = path + ".issue18.bak"
            shutil.copy2(path, backups[path])
        text = open(path, encoding="latin1").read()
        open(path, "w", encoding="latin1").write(text.replace(old, new, 1))
    try:
        # The CnCNet client's launch line (Resources/ClientDefinitions.ini); the spawner only works injected.
        game = subprocess.Popen('Syringe.exe -i=Ares.dll -i=CnCNet-Spawner.dll -i=Phobos.dll gamemd-spawn.exe '
                                '--args="-SPAWN -LOG -CD -Include -Inheritance -RA2ModeSaveID=0x8d113b94"',
                                cwd=ra2, executable=os.path.join(ra2, "Syringe.exe"))
        # ponytail: grabs the desktop at (0,0), where cnc-ddraw puts the 1920x1080 window; find the
        # window rect with user32 if it ever opens elsewhere.
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "gdigrab", "-framerate", "10",
                        "-offset_x", "0", "-offset_y", "0", "-video_size", "1926x1108", "-i", "desktop",
                        "-t", str(record_s), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                        os.path.abspath(video)])
        subprocess.run(["taskkill", "/IM", "gamemd-spawn.exe", "/F"])
        game.wait()
    finally:
        for path, bak in backups.items():
            shutil.move(bak, path)


if __name__ == "__main__":
    if sys.argv[1:2] == ["map"]:
        with open(sys.argv[2], "w", newline="\r\n") as f:
            f.write(build_map())
    elif sys.argv[1:2] == ["run"] and len(sys.argv) == 3:
        run(sys.argv[2])
    else:
        sys.exit(__doc__)
