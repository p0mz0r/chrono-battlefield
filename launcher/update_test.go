package main

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// A release v0.2.0 as GitHub serves its assets; sums is SHA256SUMS.txt (its real line for the exe when "").
func fakeRelease(t *testing.T, exe, sums string) string {
	t.Helper()
	if sums == "" {
		sums = fmt.Sprintf("%x  rhino-race-0.2.0.zip\n%x  rhino-race.exe\n", sha256.Sum256([]byte("zip")), sha256.Sum256([]byte(exe)))
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /releases/download/v0.2.0/rhino-race.exe", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(exe)) })
	mux.HandleFunc("GET /releases/download/v0.2.0/SHA256SUMS.txt", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(sums)) })
	gh := httptest.NewServer(mux)
	t.Cleanup(gh.Close)
	return gh.URL + "/releases"
}

// The running exe in a folder of its own, as an operator unzipped it.
func installedExe(t *testing.T) string {
	t.Helper()
	exe := filepath.Join(t.TempDir(), "rhino-race.exe")
	if err := os.WriteFile(exe, []byte("old exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	return exe
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		return "missing"
	}
	return string(b)
}

func TestInstallSwapsInTheNewExe(t *testing.T) {
	exe := installedExe(t)
	if err := install(fakeRelease(t, "new exe", ""), "v0.2.0", exe); err != nil {
		t.Fatal(err)
	}
	if got := read(t, exe); got != "new exe" {
		t.Errorf("exe = %q, want the new one", got)
	}
	if got := read(t, exe+".old"); got != "old exe" {
		t.Errorf(".old = %q, want the old exe", got)
	}
}

func TestAFailedInstallKeepsTheOldExe(t *testing.T) {
	for _, c := range []struct {
		name  string
		base  func(t *testing.T) string
		setup func(t *testing.T, exe string)
	}{
		{"checksum mismatch", func(t *testing.T) string {
			return fakeRelease(t, "new exe", fmt.Sprintf("%x  rhino-race.exe\n", sha256.Sum256([]byte("another exe"))))
		}, nil},
		{"no checksum for the exe", func(t *testing.T) string { return fakeRelease(t, "new exe", "abc  rhino-race-0.2.0.zip\n") }, nil},
		{"failed download", func(t *testing.T) string { return fakeRelease(t, "new exe", "") + "/missing" }, nil},
		{"offline", func(t *testing.T) string { return "http://127.0.0.1:1/releases" }, nil},
		{"folder can't be written", func(t *testing.T) string { return fakeRelease(t, "new exe", "") }, func(t *testing.T, exe string) {
			os.Mkdir(exe+".new", 0o755) // a write to it fails, as in a read-only folder
		}},
		{"swap fails half-way", func(t *testing.T) string { return fakeRelease(t, "new exe", "") }, func(t *testing.T, exe string) {
			calls := 0
			rename = func(from, to string) error {
				if calls++; calls == 2 {
					return fmt.Errorf("access denied")
				}
				return os.Rename(from, to)
			}
			t.Cleanup(func() { rename = os.Rename })
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			exe := installedExe(t)
			if c.setup != nil {
				c.setup(t, exe)
			}
			if err := install(c.base(t), "v0.2.0", exe); err == nil {
				t.Fatal("install succeeded, want an error")
			}
			if got := read(t, exe); got != "old exe" {
				t.Errorf("exe = %q, want the old one still in place", got)
			}
		})
	}
}

// GitHub answers /releases/latest with a redirect to the latest release's tag page.
func TestLatestTagFromTheRedirect(t *testing.T) {
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "HEAD" || r.URL.Path != "/releases/latest" {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, "https://github.com/p0mz0r/chrono-battlefield/releases/tag/v0.2.0", http.StatusFound)
	}))
	defer gh.Close()
	if tag, err := latestTag(gh.URL + "/releases"); err != nil || tag != "v0.2.0" {
		t.Errorf("latestTag = %q, %v; want v0.2.0", tag, err)
	}
	if tag, err := latestTag(gh.URL + "/nothing"); err == nil {
		t.Errorf("latestTag without a redirect = %q, want an error", tag)
	}
}

func TestNewerOnlyForAStrictlyGreaterTag(t *testing.T) {
	for _, c := range []struct {
		tag, current string
		want         bool
	}{
		{"v0.2.0", "0.1.0", true},
		{"v0.10.0", "0.9.0", true}, // numbers, not text
		{"v1.0.0", "0.9.9", true},
		{"v0.1.0", "0.1.0", false},
		{"v0.0.9", "0.1.0", false}, // never a downgrade
		{"v0.2", "0.1.0", false},   // not vX.Y.Z
		{"0.2.0", "0.1.0", false},
		{"v0.2.0-beta", "0.1.0", false},
		{"v0.2.0", "dev", false},
	} {
		if got := newer(c.tag, c.current); got != c.want {
			t.Errorf("newer(%q, %q) = %v, want %v", c.tag, c.current, got, c.want)
		}
	}
}
