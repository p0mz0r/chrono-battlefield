// The launcher (ADR 0009): serves the built game on a fixed port, opens it in an Edge app window with its own
// profile, and stops when that window closes (or no page has been connected for idleGrace).
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed all:dist
var dist embed.FS

// The release, from package.json: tools/release.mjs sets it with -ldflags -X.
var version = "dev"

// The game's own folder: its Edge profile and seed log, kept when a new release is unzipped elsewhere.
var appData = filepath.Join(os.Getenv("LOCALAPPDATA"), "Rhino Race")

// Never change it: browser storage belongs to the origin, port included, so a new port loses setup and logins.
const host = "127.0.0.1:27135"

func main() {
	exe, err := os.Executable()
	if err != nil {
		fail(err.Error())
	}
	dir := filepath.Dir(exe)
	url := "http://" + host + "/"
	listener, err := net.Listen("tcp", host)
	if err != nil {
		// Taken: the game already runs, so open its window again. Never a second server.
		if res, err := http.Head(url); err == nil && res.Header.Get("X-Rhino-Race") != "" {
			openWindow(url)
			return
		}
		fail("Port " + host[strings.LastIndex(host, ":")+1:] + " is used by another program. Close it and start Rhino Race again.")
	}
	// Before the window opens, so it never asks during a race; offline or failing, it starts as it is (#211).
	os.Remove(exe + ".old") // left by the last update; still locked while that exe exits, then gone next start
	if version != "dev" {
		if tag, err := latestTag(releases); err == nil && newer(tag, version) &&
			messageBox("Version "+strings.TrimPrefix(tag, "v")+" is available. Update now?", mbYesNo|mbIconQuestion) == idYes {
			err := install(releases, tag, exe)
			if err == nil {
				listener.Close() // the new exe takes the port
				if err = exec.Command(exe).Start(); err == nil {
					return
				}
				// It didn't start: back to this version, on the port again.
				rename(exe+".old", exe)
				if listener, err = net.Listen("tcp", host); err != nil {
					fail("The update failed and the port was lost: " + err.Error() + ". Start Rhino Race again.")
				}
				err = errors.New("the new version did not start")
			}
			messageBox("The update failed: "+err.Error()+". Starting version "+version+".", mbIconWarning)
		}
	}
	game, _ := fs.Sub(dist, "dist")
	s := newServer(game, host, idleGrace)
	// The seed of each race, off stream, for bug reports.
	s.mux.HandleFunc("POST /__log", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Sec-Fetch-Site") != "same-origin" { // a page elsewhere can POST here too
			http.Error(w, "Not the game", http.StatusForbidden)
			return
		}
		line, _ := io.ReadAll(io.LimitReader(r.Body, 1000))
		os.MkdirAll(appData, 0o755)
		if f, err := os.OpenFile(filepath.Join(appData, "rhino-race.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			f.WriteString(time.Now().Format("2006-01-02 15:04:05 ") + string(line) + "\r\n")
			f.Close()
		}
	})
	// The course files in courses\ beside the exe, by name, for the page to import on start (#161).
	s.mux.HandleFunc("GET /__courses", func(w http.ResponseWriter, r *http.Request) {
		files := map[string]string{}
		names, _ := filepath.Glob(filepath.Join(dir, "courses", "*.rhino-course.json"))
		for _, name := range names {
			if stat, err := os.Stat(name); err == nil && stat.Size() < 8<<20 {
				if text, err := os.ReadFile(name); err == nil {
					files[filepath.Base(name)] = string(text)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(files)
	})
	go http.Serve(listener, s)
	closed := make(chan struct{})
	go func() {
		edge := openWindow(url)
		started := time.Now()
		edge.Wait()
		// An Edge that quits at once handed the window to one already running on this profile; the heartbeat decides then.
		// ponytail: a 10 s guess; closing the window that fast stops the server only after idleGrace. Ask Edge for its
		// windows (or watch the profile's lock) if that matters.
		if time.Since(started) > 10*time.Second {
			close(closed)
		}
	}()
	select {
	case <-closed:
	case <-s.idle:
	}
}

// openWindow starts Edge as an app window on the game's own profile. It sits in LOCALAPPDATA, not beside the exe,
// so setup and logins survive unzipping a new release elsewhere, and its paths stay short of Windows' 260 characters.
func openWindow(url string) *exec.Cmd {
	edge := ""
	for _, root := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if path := filepath.Join(root, `Microsoft\Edge\Application\msedge.exe`); root != "" && fileExists(path) {
			edge = path
			break
		}
	}
	if edge == "" {
		fail("Microsoft Edge was not found. Rhino Race runs in an Edge window.")
	}
	cmd := exec.Command(edge, "--app="+url, "--user-data-dir="+filepath.Join(appData, "profile"), "--no-first-run",
		// This process stays the browser (no relaunch, no running on in the background), so it exits when the window closes.
		"--edge-skip-compat-layer-relaunch", "--disable-background-mode",
		// Full frame rate while the window is covered; sound without a click first, as in a browser source.
		"--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
		"--autoplay-policy=no-user-gesture-required")
	// For agents: tools/attach.mjs reads this window's console and requests (docs/agents/ra2-install.md).
	if port := os.Getenv("RHINO_RACE_DEBUG_PORT"); port != "" {
		cmd.Args = append(cmd.Args, "--remote-debugging-port="+port)
	}
	if err := cmd.Start(); err != nil {
		fail("Could not start Edge: " + err.Error())
	}
	return cmd
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// fail shows the message in a box (the exe has no console) and exits.
func fail(message string) {
	messageBox(message, mbIconError)
	os.Exit(1)
}

// MessageBoxW's flags and the button it returns.
const (
	mbYesNo        = 0x4
	mbIconError    = 0x10
	mbIconQuestion = 0x20
	mbIconWarning  = 0x30
	idYes          = 6
)

// messageBox shows a MessageBoxW with these flags and returns the button pressed.
func messageBox(message string, flags uintptr) uintptr {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("Rhino Race")
	button, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), flags)
	return button
}
