package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const testHost = "127.0.0.1:27135"

func get(t *testing.T, s http.Handler, url string, header ...string) *http.Response {
	t.Helper()
	req := httptest.NewRequest("GET", url, nil)
	req.Host = testHost
	for i := 0; i < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec.Result()
}

func body(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The page's URL for an absolute path: each segment encoded, as encodeURIComponent does (`C:` → `C%3A`).
func absURL(path string) string {
	parts := strings.Split(filepath.ToSlash(path), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return "/abs/" + strings.ReplaceAll(strings.Join(parts, "/"), ":", "%3A")
}

func TestReadsAnInstallFileByAbsolutePathWithRange(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Red Alert II")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "ra2.mix"), []byte("0123456789"), 0o644)
	s := newServer(fstest.MapFS{}, testHost, idleGrace)
	file := absURL(filepath.Join(dir, "ra2.mix"))

	if res := get(t, s, file); res.StatusCode != 200 || body(t, res) != "0123456789" {
		t.Fatalf("whole file: %d", res.StatusCode)
	}
	if res := get(t, s, file, "Range", "bytes=2-4"); res.StatusCode != 206 || body(t, res) != "234" {
		t.Fatalf("range: %d", res.StatusCode)
	}
	// Edge's cache fails concurrent Range requests on one cacheable file (ERR_CACHE_OPERATION_NOT_SUPPORTED).
	if res := get(t, s, file, "Range", "bytes=0-0"); res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("cacheable: %q", res.Header.Get("Cache-Control"))
	}
	if res := get(t, s, absURL(filepath.Join(dir, "language.mix"))); res.StatusCode != 404 {
		t.Fatalf("missing file: %d", res.StatusCode)
	}
}

func TestRefusesFilesTheGameNeverReads(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("x"), 0o644)
	s := newServer(fstest.MapFS{}, testHost, idleGrace)
	if res := get(t, s, absURL(filepath.Join(dir, "secret.txt"))); res.StatusCode != 403 {
		t.Fatalf("got %d", res.StatusCode)
	}
	if res := get(t, s, "/abs/relative/ra2.mix"); res.StatusCode != 403 {
		t.Fatalf("relative path: %d", res.StatusCode)
	}
}

// A page elsewhere could point its own host name at 127.0.0.1 (DNS rebinding) and read the install.
func TestRefusesAForeignHost(t *testing.T) {
	s := newServer(fstest.MapFS{"index.html": {Data: []byte("game")}}, testHost, idleGrace)
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "evil.example:27135"
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("got %d", rec.Code)
	}
	if res := get(t, s, "/"); res.StatusCode != 200 || body(t, res) != "game" {
		t.Fatalf("own host: %d", res.StatusCode)
	}
}

func closedWithin(idle <-chan struct{}, d time.Duration) bool {
	select {
	case <-idle:
		return true
	case <-time.After(d):
		return false
	}
}

func TestQuitsOnlyOnceNoPageHeldOnForTheGrace(t *testing.T) {
	s := newServer(fstest.MapFS{}, testHost, 100*time.Millisecond)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Host = testHost
		s.ServeHTTP(w, r)
	}))
	defer srv.Close()
	res, err := http.Get(srv.URL + "/__alive")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close() // before srv.Close, which waits for the held request
	if closedWithin(s.idle, 300*time.Millisecond) {
		t.Fatal("quit while a page was connected")
	}
	res.Body.Close() // the window closes
	if !closedWithin(s.idle, time.Second) {
		t.Fatal("still running a second after the page left")
	}
}

func TestQuitsWhenNoPageEverConnects(t *testing.T) {
	if !closedWithin(newServer(fstest.MapFS{}, testHost, 50*time.Millisecond).idle, time.Second) {
		t.Fatal("never quit")
	}
}
