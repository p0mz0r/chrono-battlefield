// The launcher updates itself from this repo's GitHub releases (ADR 0010, #211).
package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// The release pages, not the API (no rate limit, no JSON). Its asset names are a contract with installed exes.
const releases = "https://github.com/p0mz0r/chrono-battlefield/releases"

// latestTag reads the latest release's tag from where /releases/latest redirects (…/releases/tag/vX.Y.Z).
// A short timeout: it runs before the window opens, and offline it must not hold up the start.
func latestTag(base string) (string, error) {
	client := http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Head(base + "/latest")
	if err != nil {
		return "", err
	}
	res.Body.Close()
	_, tag, ok := strings.Cut(res.Header.Get("Location"), "/releases/tag/")
	if !ok || tag == "" {
		return "", errors.New("no latest release: " + res.Status)
	}
	return tag, nil
}

// newer reports whether tag (vX.Y.Z) is a strictly greater release than current (X.Y.Z). Anything else is not newer.
func newer(tag, current string) bool {
	t, c := parseVersion(strings.TrimPrefix(tag, "v")), parseVersion(current)
	if !strings.HasPrefix(tag, "v") || t == nil || c == nil {
		return false
	}
	for i := range t {
		if t[i] != c[i] {
			return t[i] > c[i]
		}
	}
	return false
}

// install downloads tag's rhino-race.exe, checks it against the release's SHA256SUMS.txt and swaps it in for exe,
// which stays beside it as .old (Windows lets a running exe be renamed, not overwritten). On any error exe is
// left as it was.
func install(base, tag, exe string) error {
	// ponytail: no progress window, the whole exe in memory, 60 s per file; a progress window if the exe outgrows ~8 MB.
	client := http.Client{Timeout: 60 * time.Second}
	get := func(name string, limit int64) ([]byte, error) {
		res, err := client.Get(base + "/download/" + tag + "/" + name)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("%s: %s", name, res.Status)
		}
		return io.ReadAll(io.LimitReader(res.Body, limit))
	}
	sums, err := get("SHA256SUMS.txt", 1<<16)
	if err != nil {
		return err
	}
	want := ""
	for _, line := range strings.Split(string(sums), "\n") {
		if sum, name, ok := strings.Cut(strings.TrimSpace(line), "  "); ok && name == "rhino-race.exe" {
			want = sum
		}
	}
	if want == "" {
		return errors.New("SHA256SUMS.txt has no line for rhino-race.exe")
	}
	data, err := get("rhino-race.exe", 256<<20)
	if err != nil {
		return err
	}
	if fmt.Sprintf("%x", sha256.Sum256(data)) != want {
		return errors.New("the download does not match its checksum")
	}
	// Written beside it first, so a folder that can't be written to fails before the exe is touched.
	defer os.Remove(exe + ".new") // gone already once it is the exe
	if err := os.WriteFile(exe+".new", data, 0o755); err != nil {
		return err
	}
	if err := rename(exe, exe+".old"); err != nil {
		return err
	}
	if err := rename(exe+".new", exe); err != nil {
		rename(exe+".old", exe)
		return err
	}
	return nil
}

// os.Rename, swapped in a test to fail the swap half-way.
var rename = os.Rename

func parseVersion(s string) []int {
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return nil
	}
	n := make([]int, 3)
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 {
			return nil
		}
		n[i] = v
	}
	return n
}
