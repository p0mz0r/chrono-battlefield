package main

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The install files the game reads: MIXes and maps. Nothing else on disk is served.
var gameFile = regexp.MustCompile(`(?i)\.(mix|mmx|yro|map|yrm|mpr)$`)

// How long the server waits with no page connected before it quits. A reload reconnects well within it.
const idleGrace = 30 * time.Second

type server struct {
	mux  *http.ServeMux
	host string
	// Closed once no page has held /__alive for the grace.
	idle  chan struct{}
	once  sync.Once
	mu    sync.Mutex
	pages int
	timer *time.Timer
}

// newServer serves the built game from game and, under /abs/<absolute path>, the operator's install in place.
// Only requests addressed to host (127.0.0.1:<port>) are answered.
func newServer(game fs.FS, host string, grace time.Duration) *server {
	s := &server{mux: http.NewServeMux(), host: host, idle: make(chan struct{})}
	s.timer = time.AfterFunc(grace, func() { s.once.Do(func() { close(s.idle) }) })
	s.mux.Handle("/", http.FileServerFS(game))
	s.mux.HandleFunc("/abs/", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.FromSlash(strings.TrimPrefix(r.URL.Path, "/abs/"))
		if !filepath.IsAbs(path) || !gameFile.MatchString(path) {
			http.Error(w, "Not a game file", http.StatusForbidden)
			return
		}
		file, err := os.Open(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		stat, err := file.Stat()
		if err != nil || stat.IsDir() {
			http.NotFound(w, r)
			return
		}
		// Never cached: Edge fails concurrent Range requests on one cacheable file (ERR_CACHE_OPERATION_NOT_SUPPORTED).
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, stat.Name(), time.Time{}, file)
	})
	// The page holds this open while it runs; see idle.
	s.mux.HandleFunc("/__alive", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.pages++
		s.timer.Stop()
		s.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		s.mu.Lock()
		if s.pages--; s.pages == 0 {
			s.timer.Reset(grace)
		}
		s.mu.Unlock()
	})
	return s
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Host != s.host && r.Host != "localhost"+s.host[strings.LastIndex(s.host, ":"):] {
		http.Error(w, "Wrong host", http.StatusForbidden)
		return
	}
	w.Header().Set("X-Rhino-Race", version) // tells a second launcher the game already runs, and which release
	s.mux.ServeHTTP(w, r)
}
