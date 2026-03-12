package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// ---------- Test helpers ----------

// setupTestDB creates an in-memory SQLite database for testing.
// Each test that calls this gets a fresh, isolated database.
func setupTestDB(t *testing.T) {
	t.Helper()
	os.Setenv("CAL_DB", ":memory:")
	initDB()
	t.Cleanup(func() {
		db.Close()
	})
}

// resetSessions clears the in-memory session store.
func resetSessions() {
	sessions.Lock()
	sessions.m = make(map[string]sessionEntry)
	sessions.Unlock()
}

// resetRateLimiter replaces the global auth rate limiter.
func resetRateLimiter() {
	authLimiter = newRateLimiter(1*time.Minute, 10)
}

// newTestMux builds the same mux+middleware stack as main().
func newTestMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/signup", handleSignup)
	mux.HandleFunc("/api/login", handleLogin)
	mux.HandleFunc("/api/logout", handleLogout)
	mux.HandleFunc("/api/me", handleMe)
	mux.HandleFunc("/api/rulesets", handleListRulesets)
	mux.HandleFunc("/api/rulesets/save", handleSaveRuleset)
	mux.HandleFunc("/api/rulesets/delete", handleDeleteRuleset)
	return securityHeaders(maxBodySize(mux))
}

// jsonPost creates a POST request with JSON body and content-type header.
func jsonPost(url, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

// jsonPostWithCookie creates a POST request with JSON body and a session cookie.
func jsonPostWithCookie(url, body, sessionToken string) *http.Request {
	req := jsonPost(url, body)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionToken})
	return req
}

// getWithCookie creates a GET request with a session cookie.
func getWithCookie(url, sessionToken string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionToken})
	return req
}

// decodeJSON decodes a response body into a map.
func decodeJSON(t *testing.T, body io.Reader) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(body).Decode(&m); err != nil {
		t.Fatalf("failed to decode JSON response: %v", err)
	}
	return m
}

// signupUser creates a user via the signup endpoint, returns the session token.
func signupUser(t *testing.T, handler http.Handler, username, password string) string {
	t.Helper()
	body := fmt.Sprintf(`{"username":"%s","password":"%s"}`, username, password)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", body))
	if w.Code != 200 {
		t.Fatalf("signup failed: %d %s", w.Code, w.Body.String())
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			return c.Value
		}
	}
	return ""
}

// ---------- Rate limiter ----------

func TestRateLimiter_AllowsUnderLimit(t *testing.T) {
	rl := newRateLimiter(1*time.Minute, 3)
	for i := 0; i < 3; i++ {
		if !rl.allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
}

func TestRateLimiter_BlocksOverLimit(t *testing.T) {
	rl := newRateLimiter(1*time.Minute, 3)
	for i := 0; i < 3; i++ {
		rl.allow("1.2.3.4")
	}
	if rl.allow("1.2.3.4") {
		t.Fatal("4th request should be blocked")
	}
}

func TestRateLimiter_SeparatesIPs(t *testing.T) {
	rl := newRateLimiter(1*time.Minute, 1)
	rl.allow("1.1.1.1")
	if !rl.allow("2.2.2.2") {
		t.Fatal("different IP should be allowed")
	}
}

func TestRateLimiter_WindowExpiry(t *testing.T) {
	rl := newRateLimiter(50*time.Millisecond, 1)
	rl.allow("1.2.3.4")
	if rl.allow("1.2.3.4") {
		t.Fatal("should be blocked immediately")
	}
	time.Sleep(60 * time.Millisecond)
	if !rl.allow("1.2.3.4") {
		t.Fatal("should be allowed after window expires")
	}
}

// ---------- clientIP ----------

func TestClientIP_XForwardedFor(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Forwarded-For", "10.0.0.1")
	if got := clientIP(r); got != "10.0.0.1" {
		t.Fatalf("expected 10.0.0.1, got %s", got)
	}
}

func TestClientIP_XForwardedForMultiple(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-Forwarded-For", "10.0.0.1, 10.0.0.2, 10.0.0.3")
	if got := clientIP(r); got != "10.0.0.1" {
		t.Fatalf("expected first entry 10.0.0.1, got %s", got)
	}
}

func TestClientIP_FallbackRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.168.1.1:54321"
	if got := clientIP(r); got != "192.168.1.1" {
		t.Fatalf("expected 192.168.1.1, got %s", got)
	}
}

// ---------- Middleware: Security Headers ----------

func TestSecurityHeaders(t *testing.T) {
	setupTestDB(t)
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/me", nil))

	tests := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":       "DENY",
		"Referrer-Policy":       "strict-origin-when-cross-origin",
	}
	for header, want := range tests {
		if got := w.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
}

// ---------- Middleware: Max Body Size ----------

func TestMaxBodySize_RejectsOversizedPost(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	// 2 MB payload — should exceed the 1 MB limit
	bigBody := bytes.Repeat([]byte("x"), 2<<20)
	req := httptest.NewRequest("POST", "/api/signup", bytes.NewReader(bigBody))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code == 200 {
		t.Fatal("oversized POST should not succeed")
	}
}

// ---------- Middleware: Content-Type enforcement ----------

func TestContentTypeEnforcement_RejectsFormPost(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	req := httptest.NewRequest("POST", "/api/signup", strings.NewReader("username=test&password=secret"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 415 {
		t.Fatalf("expected 415, got %d", w.Code)
	}
}

// ---------- Auth: Signup ----------

func TestSignup_Success(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", `{"username":"alice","password":"secret123"}`))

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	data := decodeJSON(t, w.Body)
	if data["username"] != "alice" {
		t.Fatalf("expected username alice, got %v", data["username"])
	}

	// Should set a session cookie
	found := false
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" && c.Value != "" {
			found = true
			if !c.HttpOnly {
				t.Error("session cookie should be HttpOnly")
			}
		}
	}
	if !found {
		t.Fatal("expected session cookie to be set")
	}
}

func TestSignup_MissingFields(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	cases := []struct {
		name string
		body string
	}{
		{"empty username", `{"username":"","password":"secret123"}`},
		{"empty password", `{"username":"alice","password":""}`},
		{"whitespace username", `{"username":"  ","password":"secret123"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, jsonPost("/api/signup", tc.body))
			if w.Code != 400 {
				t.Fatalf("expected 400, got %d", w.Code)
			}
		})
	}
}

func TestSignup_PasswordTooShort(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", `{"username":"alice","password":"abc"}`))

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	data := decodeJSON(t, w.Body)
	if !strings.Contains(data["error"].(string), "at least 6") {
		t.Fatalf("expected min-length error, got %v", data["error"])
	}
}

func TestSignup_PasswordTooLong(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	longPass := strings.Repeat("a", 73)
	body := fmt.Sprintf(`{"username":"alice","password":"%s"}`, longPass)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", body))

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	data := decodeJSON(t, w.Body)
	if !strings.Contains(data["error"].(string), "at most 72") {
		t.Fatalf("expected max-length error, got %v", data["error"])
	}
}

func TestSignup_Password72CharsExactly_Succeeds(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	pass := strings.Repeat("a", 72)
	body := fmt.Sprintf(`{"username":"alice","password":"%s"}`, pass)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", body))

	if w.Code != 200 {
		t.Fatalf("72-char password should succeed, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSignup_DuplicateUsername_NoEnumeration(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	// First signup
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, jsonPost("/api/signup", `{"username":"alice","password":"secret123"}`))
	if w1.Code != 200 {
		t.Fatalf("first signup failed: %d", w1.Code)
	}

	// Duplicate — should return 200 to prevent enumeration
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, jsonPost("/api/signup", `{"username":"alice","password":"other12345"}`))
	if w2.Code != 200 {
		t.Fatalf("duplicate signup should return 200 (anti-enumeration), got %d", w2.Code)
	}

	// But the duplicate should NOT get a session cookie
	for _, c := range w2.Result().Cookies() {
		if c.Name == "session" && c.Value != "" {
			t.Fatal("duplicate signup should not receive a session cookie")
		}
	}
}

func TestSignup_WrongMethod(t *testing.T) {
	setupTestDB(t)
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/signup", nil))

	if w.Code != 405 {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestSignup_InvalidJSON(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	req := httptest.NewRequest("POST", "/api/signup", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ---------- Auth: Login ----------

func TestLogin_Success(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	// Create user first
	signupUser(t, handler, "alice", "secret123")
	resetSessions() // clear signup session to test login independently

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/login", `{"username":"alice","password":"secret123"}`))

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	found := false
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" && c.Value != "" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected session cookie on login")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	signupUser(t, handler, "alice", "secret123")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/login", `{"username":"alice","password":"wrongpass"}`))

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	setupTestDB(t)
	resetRateLimiter()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/login", `{"username":"nobody","password":"secret123"}`))

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestLogin_WrongMethod(t *testing.T) {
	setupTestDB(t)
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/login", nil))
	if w.Code != 405 {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestLogin_RateLimited(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	// Use a tight rate limiter for this test
	authLimiter = newRateLimiter(1*time.Minute, 2)

	// Two attempts are fine
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, jsonPost("/api/login", `{"username":"x","password":"y"}`))
		if w.Code == 429 {
			t.Fatalf("attempt %d should not be rate limited", i+1)
		}
	}

	// Third should be rate limited
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/login", `{"username":"x","password":"y"}`))
	if w.Code != 429 {
		t.Fatalf("expected 429, got %d", w.Code)
	}
}

// ---------- Auth: Logout ----------

func TestLogout_ClearsCookie(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/logout", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: tok})
	handler.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// Cookie should be cleared (MaxAge = -1)
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" && c.MaxAge != -1 {
			t.Fatal("session cookie should have MaxAge=-1 after logout")
		}
	}

	// Session should no longer be valid
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, getWithCookie("/api/me", tok))
	data := decodeJSON(t, w2.Body)
	if data["loggedIn"] != false {
		t.Fatal("session should be invalid after logout")
	}
}

func TestLogout_WithoutSession(t *testing.T) {
	setupTestDB(t)
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/api/logout", nil))
	if w.Code != 200 {
		t.Fatalf("logout without session should return 200, got %d", w.Code)
	}
}

// ---------- Auth: Me ----------

func TestMe_LoggedIn(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, getWithCookie("/api/me", tok))

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	data := decodeJSON(t, w.Body)
	if data["loggedIn"] != true {
		t.Fatal("expected loggedIn=true")
	}
	if data["username"] != "alice" {
		t.Fatalf("expected alice, got %v", data["username"])
	}
}

func TestMe_NotLoggedIn(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/me", nil))

	data := decodeJSON(t, w.Body)
	if data["loggedIn"] != false {
		t.Fatal("expected loggedIn=false without session")
	}
}

func TestMe_ExpiredSession(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	// Manually create an expired session
	tok := newToken()
	sessions.Lock()
	sessions.m[tok] = sessionEntry{
		userID:   1,
		username: "alice",
		expires:  time.Now().Add(-1 * time.Hour),
	}
	sessions.Unlock()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, getWithCookie("/api/me", tok))

	data := decodeJSON(t, w.Body)
	if data["loggedIn"] != false {
		t.Fatal("expired session should return loggedIn=false")
	}
}

func TestMe_InvalidToken(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, getWithCookie("/api/me", "bogus-token-that-does-not-exist"))

	data := decodeJSON(t, w.Body)
	if data["loggedIn"] != false {
		t.Fatal("invalid token should return loggedIn=false")
	}
}

// ---------- Rulesets: Save ----------

func TestSaveRuleset_Success(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	body := `{"name":"commute","rules":[{"name":"Single","rate":"3.50","frequency":"n-fare","trips":1,"days":0}]}`
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPostWithCookie("/api/rulesets/save", body, tok))

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeJSON(t, w.Body)
	if data["status"] != "saved" {
		t.Fatalf("expected saved, got %v", data["status"])
	}
}

func TestSaveRuleset_UpsertOverwrites(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	// Save v1
	body1 := `{"name":"commute","rules":[{"name":"Single","rate":"3.50","frequency":"n-fare","trips":1,"days":0}]}`
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, jsonPostWithCookie("/api/rulesets/save", body1, tok))
	if w1.Code != 200 {
		t.Fatalf("first save failed: %d", w1.Code)
	}

	// Save v2 with same name — should overwrite
	body2 := `{"name":"commute","rules":[{"name":"Monthly","rate":"90.00","frequency":"monthly","trips":0,"days":0}]}`
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, jsonPostWithCookie("/api/rulesets/save", body2, tok))
	if w2.Code != 200 {
		t.Fatalf("upsert failed: %d", w2.Code)
	}

	// List — should have only one "commute" with the monthly rule
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, getWithCookie("/api/rulesets", tok))
	var list []rulesetResp
	json.NewDecoder(w3.Body).Decode(&list)
	if len(list) != 1 {
		t.Fatalf("expected 1 ruleset, got %d", len(list))
	}
	if list[0].Rules[0].Name != "Monthly" {
		t.Fatalf("expected upserted Monthly rule, got %s", list[0].Rules[0].Name)
	}
}

func TestSaveRuleset_RequiresAuth(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/rulesets/save", `{"name":"test","rules":[]}`))

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestSaveRuleset_EmptyName(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPostWithCookie("/api/rulesets/save", `{"name":"","rules":[]}`, tok))

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestSaveRuleset_WhitespaceName(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPostWithCookie("/api/rulesets/save", `{"name":"   ","rules":[]}`, tok))

	if w.Code != 400 {
		t.Fatalf("expected 400 for whitespace-only name, got %d", w.Code)
	}
}

func TestSaveRuleset_RequiresJSON(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	req := httptest.NewRequest("POST", "/api/rulesets/save", strings.NewReader("name=test"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "session", Value: tok})

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != 415 {
		t.Fatalf("expected 415, got %d", w.Code)
	}
}

// ---------- Rulesets: List ----------

func TestListRulesets_Empty(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, getWithCookie("/api/rulesets", tok))

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var list []rulesetResp
	json.NewDecoder(w.Body).Decode(&list)
	if len(list) != 0 {
		t.Fatalf("expected empty list, got %d items", len(list))
	}
}

func TestListRulesets_ReturnsSavedData(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	// Save two rulesets
	for _, name := range []string{"commute", "weekend"} {
		body := fmt.Sprintf(`{"name":"%s","rules":[{"name":"Single","rate":"3.50","frequency":"n-fare","trips":1,"days":0}]}`, name)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, jsonPostWithCookie("/api/rulesets/save", body, tok))
		if w.Code != 200 {
			t.Fatalf("save %s failed: %d", name, w.Code)
		}
	}

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, getWithCookie("/api/rulesets", tok))

	var list []rulesetResp
	json.NewDecoder(w.Body).Decode(&list)
	if len(list) != 2 {
		t.Fatalf("expected 2 rulesets, got %d", len(list))
	}
}

func TestListRulesets_RequiresAuth(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/rulesets", nil))

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestListRulesets_IsolatesBetweenUsers(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tokAlice := signupUser(t, handler, "alice", "secret123")
	tokBob := signupUser(t, handler, "bob", "secret456")

	// Alice saves a ruleset
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPostWithCookie("/api/rulesets/save",
		`{"name":"alice-rules","rules":[{"name":"Single","rate":"3.50","frequency":"n-fare","trips":1,"days":0}]}`,
		tokAlice))

	// Bob should not see Alice's ruleset
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, getWithCookie("/api/rulesets", tokBob))

	var list []rulesetResp
	json.NewDecoder(w2.Body).Decode(&list)
	if len(list) != 0 {
		t.Fatalf("Bob should see 0 rulesets, got %d", len(list))
	}
}

// ---------- Rulesets: Delete ----------

func TestDeleteRuleset_Success(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	// Save then delete
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, jsonPostWithCookie("/api/rulesets/save",
		`{"name":"commute","rules":[]}`, tok))

	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, jsonPostWithCookie("/api/rulesets/delete",
		`{"name":"commute"}`, tok))
	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d", w2.Code)
	}

	// Verify it's gone
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, getWithCookie("/api/rulesets", tok))
	var list []rulesetResp
	json.NewDecoder(w3.Body).Decode(&list)
	if len(list) != 0 {
		t.Fatalf("expected 0 rulesets after delete, got %d", len(list))
	}
}

func TestDeleteRuleset_RequiresAuth(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/rulesets/delete", `{"name":"anything"}`))

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestDeleteRuleset_CannotDeleteOtherUsersRuleset(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tokAlice := signupUser(t, handler, "alice", "secret123")
	tokBob := signupUser(t, handler, "bob", "secret456")

	// Alice saves
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, jsonPostWithCookie("/api/rulesets/save",
		`{"name":"alice-rules","rules":[{"name":"Single","rate":"3.50","frequency":"n-fare","trips":1,"days":0}]}`,
		tokAlice))

	// Bob tries to delete Alice's ruleset
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, jsonPostWithCookie("/api/rulesets/delete",
		`{"name":"alice-rules"}`, tokBob))

	// Alice's ruleset should still exist
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, getWithCookie("/api/rulesets", tokAlice))
	var list []rulesetResp
	json.NewDecoder(w3.Body).Decode(&list)
	if len(list) != 1 {
		t.Fatalf("Alice's ruleset should survive Bob's delete attempt, got %d", len(list))
	}
}

func TestDeleteRuleset_WrongMethod(t *testing.T) {
	setupTestDB(t)
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/rulesets/delete", nil))
	if w.Code != 405 {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

// ---------- Session: Cookie attributes ----------

func TestSessionCookie_HttpOnlyAndSameSite(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	secureCookies = false
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", `{"username":"alice","password":"secret123"}`))

	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			if !c.HttpOnly {
				t.Error("cookie must be HttpOnly")
			}
			if c.SameSite != http.SameSiteLaxMode {
				t.Error("cookie must be SameSite=Lax")
			}
			if c.Secure {
				t.Error("cookie should not be Secure when secureCookies=false")
			}
		}
	}
}

func TestSessionCookie_SecureWhenEnabled(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	secureCookies = true
	defer func() { secureCookies = false }()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", `{"username":"alice","password":"secret123"}`))

	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			if !c.Secure {
				t.Error("cookie should be Secure when secureCookies=true")
			}
		}
	}
}

// ---------- Integration: full auth lifecycle ----------

func TestAuthLifecycle_SignupMeLogoutMe(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	// Signup
	tok := signupUser(t, handler, "alice", "secret123")
	if tok == "" {
		t.Fatal("expected session token from signup")
	}

	// Me — logged in
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, getWithCookie("/api/me", tok))
	d1 := decodeJSON(t, w1.Body)
	if d1["loggedIn"] != true || d1["username"] != "alice" {
		t.Fatalf("expected loggedIn=true alice, got %v", d1)
	}

	// Logout
	w2 := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/logout", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: tok})
	handler.ServeHTTP(w2, req)

	// Me — logged out
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, getWithCookie("/api/me", tok))
	d3 := decodeJSON(t, w3.Body)
	if d3["loggedIn"] != false {
		t.Fatal("expected loggedIn=false after logout")
	}
}

// ---------- Edge cases: signup with leading/trailing whitespace ----------

func TestSignup_TrimsUsername(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/signup", `{"username":"  alice  ","password":"secret123"}`))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	data := decodeJSON(t, w.Body)
	if data["username"] != "alice" {
		t.Fatalf("expected trimmed username 'alice', got %q", data["username"])
	}
}

func TestLogin_TrimsUsername(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	signupUser(t, handler, "alice", "secret123")
	resetSessions()

	// Login with whitespace around username
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, jsonPost("/api/login", `{"username":"  alice  ","password":"secret123"}`))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ---------- Edge cases: response content types ----------

func TestAPIResponses_AreJSON(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{"GET", "/api/me", ""},
		{"POST", "/api/signup", `{"username":"alice","password":"secret123"}`},
		{"POST", "/api/login", `{"username":"nobody","password":"wrong1"}`},
		{"POST", "/api/logout", ""},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			var req *http.Request
			if ep.body != "" {
				req = jsonPost(ep.path, ep.body)
			} else {
				req = httptest.NewRequest(ep.method, ep.path, nil)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			ct := w.Header().Get("Content-Type")
			if !strings.HasPrefix(ct, "application/json") {
				t.Errorf("expected application/json, got %q", ct)
			}
		})
	}
}

// ---------- Edge case: concurrent session creation ----------

func TestConcurrentSignups(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	// Signup 20 different users concurrently
	done := make(chan bool, 20)
	for i := 0; i < 20; i++ {
		go func(n int) {
			body := fmt.Sprintf(`{"username":"user%d","password":"secret123"}`, n)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, jsonPost("/api/signup", body))
			done <- (w.Code == 200)
		}(i)
	}

	successes := 0
	for i := 0; i < 20; i++ {
		if <-done {
			successes++
		}
	}

	// With rate limiting (10/min/IP), some may be rate limited
	// but since all come from the same httptest address, we expect at least 10
	if successes < 10 {
		t.Fatalf("expected at least 10 successful signups, got %d", successes)
	}
}

// ---------- Edge case: token uniqueness ----------

func TestNewToken_Uniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		tok := newToken()
		if len(tok) != 64 {
			t.Fatalf("expected 64-char hex token, got %d chars", len(tok))
		}
		if seen[tok] {
			t.Fatal("duplicate token generated")
		}
		seen[tok] = true
	}
}

// ---------- Edge case: login preserves bcrypt password correctly ----------

func TestLogin_72CharPasswordBoundary(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	pass := strings.Repeat("b", 72)
	signupUser(t, handler, "alice", pass)
	resetSessions()

	// Login with the same 72-char password
	w := httptest.NewRecorder()
	body := fmt.Sprintf(`{"username":"alice","password":"%s"}`, pass)
	handler.ServeHTTP(w, jsonPost("/api/login", body))
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ---------- Edge case: save ruleset with complex rule data ----------

func TestSaveRuleset_PreservesAllFields(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	rules := `[
		{"name":"Monthly","rate":"90.00","frequency":"monthly","trips":0,"days":0},
		{"name":"Weekly","rate":"26.00","frequency":"weekly","trips":0,"days":0},
		{"name":"10-Trip","rate":"32.00","frequency":"n-fare","trips":10,"days":0},
		{"name":"Single","rate":"3.75","frequency":"n-fare","trips":1,"days":0}
	]`
	body := fmt.Sprintf(`{"name":"NJT Full","rules":%s}`, rules)
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, jsonPostWithCookie("/api/rulesets/save", body, tok))
	if w1.Code != 200 {
		t.Fatalf("save failed: %d", w1.Code)
	}

	// Load and verify every field roundtrips
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, getWithCookie("/api/rulesets", tok))
	var list []rulesetResp
	json.NewDecoder(w2.Body).Decode(&list)
	if len(list) != 1 {
		t.Fatalf("expected 1, got %d", len(list))
	}
	if len(list[0].Rules) != 4 {
		t.Fatalf("expected 4 rules, got %d", len(list[0].Rules))
	}

	monthly := list[0].Rules[0]
	if monthly.Name != "Monthly" || monthly.Rate != "90.00" || monthly.Frequency != "monthly" {
		t.Fatalf("Monthly rule roundtrip failed: %+v", monthly)
	}
	tenTrip := list[0].Rules[2]
	if tenTrip.Trips != 10 || tenTrip.Frequency != "n-fare" {
		t.Fatalf("10-Trip rule roundtrip failed: %+v", tenTrip)
	}
}

// ---------- Integration: full ruleset lifecycle ----------

func TestRulesetLifecycle_SaveListDelete(t *testing.T) {
	setupTestDB(t)
	resetSessions()
	resetRateLimiter()
	handler := newTestMux()

	tok := signupUser(t, handler, "alice", "secret123")

	// Save
	rules := `[{"name":"Single","rate":"3.50","frequency":"n-fare","trips":1,"days":0},{"name":"10-Trip","rate":"32.00","frequency":"n-fare","trips":10,"days":0}]`
	saveBody := fmt.Sprintf(`{"name":"NJT","rules":%s}`, rules)
	w1 := httptest.NewRecorder()
	handler.ServeHTTP(w1, jsonPostWithCookie("/api/rulesets/save", saveBody, tok))
	if w1.Code != 200 {
		t.Fatalf("save failed: %d", w1.Code)
	}

	// List and verify rules roundtrip
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, getWithCookie("/api/rulesets", tok))
	var list []rulesetResp
	json.NewDecoder(w2.Body).Decode(&list)
	if len(list) != 1 || list[0].Name != "NJT" {
		t.Fatalf("expected [NJT], got %v", list)
	}
	if len(list[0].Rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(list[0].Rules))
	}
	if list[0].Rules[0].Rate != "3.50" {
		t.Fatalf("expected rate 3.50, got %s", list[0].Rules[0].Rate)
	}

	// Delete
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, jsonPostWithCookie("/api/rulesets/delete", `{"name":"NJT"}`, tok))
	if w3.Code != 200 {
		t.Fatalf("delete failed: %d", w3.Code)
	}

	// Verify empty
	w4 := httptest.NewRecorder()
	handler.ServeHTTP(w4, getWithCookie("/api/rulesets", tok))
	var list2 []rulesetResp
	json.NewDecoder(w4.Body).Decode(&list2)
	if len(list2) != 0 {
		t.Fatalf("expected empty after delete, got %d", len(list2))
	}
}
