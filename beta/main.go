package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	db       *sql.DB
	sessions = struct {
		sync.RWMutex
		m map[string]sessionEntry
	}{m: make(map[string]sessionEntry)}
)

type sessionEntry struct {
	userID   int64
	username string
	expires  time.Time
}

// ---------- DB setup ----------

func initDB() {
	dbPath := "cal.db"
	if p := os.Getenv("CAL_DB"); p != "" {
		dbPath = p
	}
	var err error
	db, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(1) // sqlite3 single-writer

	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id       INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT    NOT NULL UNIQUE,
		pwhash   TEXT    NOT NULL
	);
	CREATE TABLE IF NOT EXISTS rulesets (
		id      INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id),
		name    TEXT    NOT NULL,
		rules   TEXT    NOT NULL,
		created TEXT    NOT NULL DEFAULT (datetime('now')),
		UNIQUE(user_id, name)
	);`
	if _, err := db.Exec(schema); err != nil {
		log.Fatal(err)
	}
}

// ---------- Session helpers ----------

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatal(err)
	}
	return hex.EncodeToString(b)
}

func createSession(userID int64, username string) string {
	tok := newToken()
	sessions.Lock()
	sessions.m[tok] = sessionEntry{
		userID:   userID,
		username: username,
		expires:  time.Now().Add(7 * 24 * time.Hour),
	}
	sessions.Unlock()
	return tok
}

func getSession(r *http.Request) *sessionEntry {
	c, err := r.Cookie("session")
	if err != nil {
		return nil
	}
	sessions.RLock()
	s, ok := sessions.m[c.Value]
	sessions.RUnlock()
	if !ok || time.Now().After(s.expires) {
		return nil
	}
	return &s
}

func setSessionCookie(w http.ResponseWriter, tok string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   7 * 24 * 3600,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// ---------- JSON helpers ----------

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// ---------- Auth handlers ----------

type authReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func handleSignup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, 405, "method not allowed")
		return
	}
	var req authReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, 400, "invalid JSON")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		jsonErr(w, 400, "username and password required")
		return
	}
	if len(req.Password) < 6 {
		jsonErr(w, 400, "password must be at least 6 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonErr(w, 500, "internal error")
		return
	}

	res, err := db.Exec("INSERT INTO users (username, pwhash) VALUES (?, ?)", req.Username, string(hash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			jsonErr(w, 409, "username already taken")
			return
		}
		jsonErr(w, 500, "internal error")
		return
	}
	uid, _ := res.LastInsertId()
	tok := createSession(uid, req.Username)
	setSessionCookie(w, tok)
	jsonOK(w, map[string]string{"username": req.Username})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, 405, "method not allowed")
		return
	}
	var req authReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, 400, "invalid JSON")
		return
	}
	req.Username = strings.TrimSpace(req.Username)

	var uid int64
	var pwhash string
	err := db.QueryRow("SELECT id, pwhash FROM users WHERE username = ?", req.Username).Scan(&uid, &pwhash)
	if err != nil {
		jsonErr(w, 401, "invalid credentials")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(pwhash), []byte(req.Password)) != nil {
		jsonErr(w, 401, "invalid credentials")
		return
	}

	tok := createSession(uid, req.Username)
	setSessionCookie(w, tok)
	jsonOK(w, map[string]string{"username": req.Username})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, 405, "method not allowed")
		return
	}
	if c, err := r.Cookie("session"); err == nil {
		sessions.Lock()
		delete(sessions.m, c.Value)
		sessions.Unlock()
	}
	clearSessionCookie(w)
	jsonOK(w, map[string]string{"status": "ok"})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	s := getSession(r)
	if s == nil {
		jsonOK(w, map[string]any{"loggedIn": false})
		return
	}
	jsonOK(w, map[string]any{"loggedIn": true, "username": s.username})
}

// ---------- Ruleset handlers ----------

type fareRule struct {
	Name      string `json:"name"`
	Rate      string `json:"rate"`
	Frequency string `json:"frequency"`
	Trips     int    `json:"trips"`
	Days      int    `json:"days"`
}

type rulesetReq struct {
	Name  string     `json:"name"`
	Rules []fareRule `json:"rules"`
}

type rulesetResp struct {
	ID    int64      `json:"id"`
	Name  string     `json:"name"`
	Rules []fareRule `json:"rules"`
}

func handleSaveRuleset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, 405, "method not allowed")
		return
	}
	s := getSession(r)
	if s == nil {
		jsonErr(w, 401, "sign in to save rulesets")
		return
	}
	var req rulesetReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, 400, "invalid JSON")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		jsonErr(w, 400, "name required")
		return
	}

	rulesJSON, _ := json.Marshal(req.Rules)

	_, err := db.Exec(`INSERT INTO rulesets (user_id, name, rules) VALUES (?, ?, ?)
		ON CONFLICT(user_id, name) DO UPDATE SET rules = excluded.rules, created = datetime('now')`,
		s.userID, req.Name, string(rulesJSON))
	if err != nil {
		jsonErr(w, 500, "failed to save")
		return
	}
	jsonOK(w, map[string]string{"status": "saved", "name": req.Name})
}

func handleListRulesets(w http.ResponseWriter, r *http.Request) {
	s := getSession(r)
	if s == nil {
		jsonErr(w, 401, "sign in to view rulesets")
		return
	}
	rows, err := db.Query("SELECT id, name, rules FROM rulesets WHERE user_id = ? ORDER BY created DESC", s.userID)
	if err != nil {
		jsonErr(w, 500, "query failed")
		return
	}
	defer rows.Close()

	var out []rulesetResp
	for rows.Next() {
		var rs rulesetResp
		var rulesJSON string
		if err := rows.Scan(&rs.ID, &rs.Name, &rulesJSON); err != nil {
			continue
		}
		json.Unmarshal([]byte(rulesJSON), &rs.Rules)
		out = append(out, rs)
	}
	if out == nil {
		out = []rulesetResp{}
	}
	jsonOK(w, out)
}

func handleDeleteRuleset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, 405, "method not allowed")
		return
	}
	s := getSession(r)
	if s == nil {
		jsonErr(w, 401, "sign in required")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, 400, "invalid JSON")
		return
	}
	db.Exec("DELETE FROM rulesets WHERE user_id = ? AND name = ?", s.userID, req.Name)
	jsonOK(w, map[string]string{"status": "deleted"})
}

// ---------- Main ----------

func main() {
	initDB()

	// API
	http.HandleFunc("/api/signup", handleSignup)
	http.HandleFunc("/api/login", handleLogin)
	http.HandleFunc("/api/logout", handleLogout)
	http.HandleFunc("/api/me", handleMe)
	http.HandleFunc("/api/rulesets", handleListRulesets)
	http.HandleFunc("/api/rulesets/save", handleSaveRuleset)
	http.HandleFunc("/api/rulesets/delete", handleDeleteRuleset)

	// Static files
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			http.ServeFile(w, r, "static/index.html")
			return
		}
		http.ServeFile(w, r, "static"+r.URL.Path)
	})

	port := "8080"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}
	fmt.Printf("Fare calculator running at http://localhost:%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
