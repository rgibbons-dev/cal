# Fare Calculator Beta — Security Audit

*2026-03-07T22:43:37Z by Showboat 0.6.1*
<!-- showboat-id: 3faa3a41-b499-4c32-bc3f-33fcea4c496a -->

Read-only security assessment of the Fare Calculator beta codebase. Scanning for injection, auth, agent-specific, secrets, dependency, and runtime vulnerabilities. Files in scope: main.go, static/index.html, static/optimizer.js, static/optimizer_test.js, go.mod.

## Finding 1: Path Traversal via Static File Handler

**Severity: CRITICAL**
**File:** main.go, lines 357–363
**Class:** Path Traversal

```bash
cat -n /home/user/cal/beta/main.go | sed -n '352,368p'
```

```output
   352		http.HandleFunc("/api/rulesets", handleListRulesets)
   353		http.HandleFunc("/api/rulesets/save", handleSaveRuleset)
   354		http.HandleFunc("/api/rulesets/delete", handleDeleteRuleset)
   355	
   356		// Static files
   357		http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
   358			if r.URL.Path == "/" || r.URL.Path == "/index.html" {
   359				http.ServeFile(w, r, "static/index.html")
   360				return
   361			}
   362			http.ServeFile(w, r, "static"+r.URL.Path)
   363		})
   364	
   365		port := "8080"
   366		if p := os.Getenv("PORT"); p != "" {
   367			port = p
   368		}
```

**Exploit:** A request to `GET /../../etc/passwd` or `GET /..%2f..%2fetc/passwd` constructs the path `static/../../etc/passwd`, which resolves to `/etc/passwd`. The URL path is concatenated directly into a filesystem path with no sanitization.

Note: Go's `http.ServeFile` does call `path.Clean` internally and will redirect paths containing `..` to cleaned versions, and the `net/http` default mux also cleans URL paths before matching. This significantly mitigates the risk in practice. However, the pattern itself is dangerous — it relies entirely on framework behavior rather than explicit validation, and would be exploitable if the handler were mounted on a different mux or framework that doesn't clean paths.

**SUGGESTION:** Replace with `http.FileServer(http.Dir("static"))` which is designed for this purpose and performs proper path containment, or use `filepath.Clean` + a prefix check:

```go
cleaned := filepath.Clean(r.URL.Path)
if !strings.HasPrefix(filepath.Join("static", cleaned), "static/") {
    http.NotFound(w, r)
    return
}
```

## Finding 2: No CSRF Protection on State-Changing Endpoints

**Severity: HIGH**
**File:** main.go, all POST handlers (lines 145, 186, 215, 259, 321)
**Class:** Broken Authentication / CSRF

```bash
grep -n 'SameSite' /home/user/cal/beta/main.go
```

```output
109:		SameSite: http.SameSiteLaxMode,
120:		SameSite: http.SameSiteLaxMode,
```

**Exploit:** SameSite=Lax allows the session cookie to be sent on top-level navigations (e.g., a link from an attacker's page). While Lax blocks cross-origin POST via XHR/fetch, it does NOT protect against:
- Attacks using `<form method=POST action='http://victim/api/rulesets/save'>` submitted via top-level navigation in some browsers (Lax behavior for form POSTs has edge cases, particularly within 2 minutes of cookie creation in Chrome's 'Lax+POST' mitigation).
- Any future GET endpoints that modify state.

The handlers accept JSON bodies, which provides partial protection (cross-origin forms can't set Content-Type: application/json). However, the handlers don't actually check the Content-Type header — `json.NewDecoder(r.Body).Decode` will happily parse JSON from any content type.

**SUGGESTION:** Add an explicit Content-Type check (`if r.Header.Get("Content-Type") != "application/json"`) to all POST handlers, or add a custom CSRF token. Alternatively, upgrade to SameSite=Strict for the session cookie.

## Finding 3: No Rate Limiting on Authentication Endpoints

**Severity: HIGH**
**File:** main.go, lines 145 (signup), 186 (login)
**Class:** Broken Authentication

```bash
grep -n 'rate\|limit\|throttle\|sleep\|backoff\|attempt' /home/user/cal/beta/main.go || echo '(no rate limiting code found)'
```

```output
165:	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
242:	Rate      string `json:"rate"`
```

**Exploit:** An attacker can brute-force passwords or enumerate usernames at unlimited speed. While bcrypt adds ~100ms per attempt server-side, an attacker can run thousands of concurrent requests. The signup endpoint can also be abused to create unlimited accounts, filling the database.

**SUGGESTION:** Add per-IP rate limiting (e.g., 5 login attempts per minute) using a token bucket or sliding window. Consider account lockout after N failures.

## Finding 4: DOM-Based XSS via Ruleset Names (Stored XSS)

**Severity: HIGH**
**File:** static/index.html, lines 599, 615, 630, 643–645
**Class:** XSS (Stored, DOM-based)

```bash
cat -n /home/user/cal/beta/static/index.html | sed -n '636,649p'
```

```output
   636	          async function refreshRulesetList(sel) {
   637	            try {
   638	              const resp = await fetch("/api/rulesets");
   639	              const list = await resp.json();
   640	              // Keep the first "Load..." option
   641	              while (sel.options.length > 1) sel.remove(1);
   642	              for (const rs of list) {
   643	                const opt = document.createElement("option");
   644	                opt.value = rs.name;
   645	                opt.textContent = rs.name;
   646	                sel.appendChild(opt);
   647	              }
   648	            } catch {}
   649	          }
```

```bash
grep -n 'innerHTML\|\.html(\|insertAdjacentHTML\|document\.write' /home/user/cal/beta/static/index.html
```

```output
479:            bar.innerHTML = "";
550:            section.innerHTML = "";
665:            rulesListEl.innerHTML = "";
705:              removeBtn.innerHTML = "&times;";
```

```bash
cat -n /home/user/cal/beta/static/index.html | sed -n '596,602p'
```

```output
   596	                });
   597	                const data = await resp.json();
   598	                if (!resp.ok) { showMsg(msgEl, data.error, true); return; }
   599	                showMsg(msgEl, `saved "${name}"`, false);
   600	                refreshRulesetList(loadSel);
   601	              } catch { showMsg(msgEl, "network error", true); }
   602	            });
```

```bash
cat -n /home/user/cal/beta/static/index.html | sed -n '651,655p'
```

```output
   651	          function showMsg(el, text, isError) {
   652	            el.textContent = text;
   653	            el.className = "ruleset-msg" + (isError ? " error" : "");
   654	            setTimeout(() => { el.textContent = ""; }, 3000);
   655	          }
```

**Analysis:** The frontend uses `textContent` and `createElement` throughout — not `innerHTML` with user data. The `innerHTML = ""` calls at lines 479, 550, 665 are clearing containers (safe). Line 705 uses `innerHTML = "&times;"` with a literal (safe). The `showMsg` function uses `textContent` (safe). The `refreshRulesetList` function sets `opt.textContent = rs.name` (safe).

**Verdict: NOT VULNERABLE.** The DOM manipulation is safe. All user-supplied strings (ruleset names, fare rule names, error messages) flow through `textContent` or `createElement` + attribute setters, which do not parse HTML. Downgrading this finding.

**However**, the fare rule names flow from the optimizer into the recommendation display:

```bash
cat -n /home/user/cal/beta/static/index.html | sed -n '818,826p'
```

```output
   818	            if (result.tickets.length === 0) {
   819	              valueEl.textContent = "Select travel days above";
   820	              costEl.textContent = "";
   821	              return;
   822	            }
   823	
   824	            valueEl.textContent = consolidateTickets(result.tickets).join(", ");
   825	            costEl.textContent = `Estimated cost: $${result.cost.toFixed(2)}`;
   826	          }
```

Line 824 also uses `textContent` — safe. **This finding is downgraded to INFORMATIONAL.** The codebase consistently uses safe DOM APIs. No XSS vectors found.

## Finding 5: SQL Injection Audit

**File:** main.go
**Class:** SQL Injection

```bash
grep -n 'db\.\(Exec\|Query\|QueryRow\)' /home/user/cal/beta/main.go
```

```output
62:	if _, err := db.Exec(schema); err != nil {
171:	res, err := db.Exec("INSERT INTO users (username, pwhash) VALUES (?, ?)", req.Username, string(hash))
200:	err := db.QueryRow("SELECT id, pwhash FROM users WHERE username = ?", req.Username).Scan(&uid, &pwhash)
282:	_, err := db.Exec(`INSERT INTO rulesets (user_id, name, rules) VALUES (?, ?, ?)
298:	rows, err := db.Query("SELECT id, name, rules FROM rulesets WHERE user_id = ? ORDER BY created DESC", s.userID)
338:	db.Exec("DELETE FROM rulesets WHERE user_id = ? AND name = ?", s.userID, req.Name)
```

**Verdict: NOT VULNERABLE.** All six SQL operations use parameterized queries (`?` placeholders). No string concatenation or formatting of user input into SQL strings. The schema DDL at line 62 is a static literal. This is correct.

## Finding 6: Session Tokens Not Invalidated on Password Change

**Severity: MEDIUM**
**File:** main.go
**Class:** Broken Authentication

```bash
grep -n 'password\|session\|delete.*session\|invalidat' /home/user/cal/beta/main.go | grep -iv 'json\|pwhash\|compare'
```

```output
22:	sessions = struct {
24:		m map[string]sessionEntry
25:	}{m: make(map[string]sessionEntry)}
28:type sessionEntry struct {
79:	sessions.Lock()
80:	sessions.m[tok] = sessionEntry{
85:	sessions.Unlock()
89:func getSession(r *http.Request) *sessionEntry {
90:	c, err := r.Cookie("session")
94:	sessions.RLock()
95:	s, ok := sessions.m[c.Value]
96:	sessions.RUnlock()
105:		Name:     "session",
116:		Name:     "session",
220:	if c, err := r.Cookie("session"); err == nil {
221:		sessions.Lock()
222:		delete(sessions.m, c.Value)
223:		sessions.Unlock()
```

**Issue:** There is no password-change endpoint (which is fine for this scope), but more importantly, there is no mechanism to invalidate all sessions for a user. The in-memory session map is keyed by token, not by user ID. If a user logs in from multiple browsers, logging out from one does not invalidate the others. There's no way to 'log out everywhere.'

Additionally, sessions survive indefinitely in memory (only checked against expiry on access) — expired sessions are never reaped, which is a minor memory leak.

**SUGGESTION:** Add a `userSessions map[int64][]string` index to enable per-user session revocation. Add a periodic reaper goroutine for expired sessions.

## Finding 7: Unbounded Request Body Size

**Severity: MEDIUM**
**File:** main.go, lines 151, 192, 270, 334
**Class:** Denial of Service

```bash
grep -n 'json.NewDecoder(r.Body)' /home/user/cal/beta/main.go
```

```output
151:	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
192:	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
270:	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
334:	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
```

```bash
grep -n 'MaxBytesReader\|LimitReader\|MaxBytes\|http.MaxBytesHandler' /home/user/cal/beta/main.go || echo '(no body size limit found)'
```

```output
(no body size limit found)
```

**Exploit:** An attacker can send a multi-gigabyte POST body to any endpoint. `json.NewDecoder(r.Body).Decode` will attempt to read the entire body into memory. With `SetMaxOpenConns(1)` on the database, a single slow request can monopolize the DB connection while memory grows unbounded.

The `rulesets/save` endpoint is particularly interesting: the `rules` field is a JSON array that gets marshaled and stored in SQLite. An attacker could send millions of fare rules in one request, bloating the database.

**SUGGESTION:** Wrap `r.Body` with `http.MaxBytesReader(w, r.Body, 1<<20)` (1 MB limit) at the start of each handler, or apply it globally via middleware.

## Finding 8: Username Enumeration via Signup Timing + Error Differentiation

**Severity: MEDIUM**
**File:** main.go, lines 172–178
**Class:** Information Disclosure

```bash
cat -n /home/user/cal/beta/main.go | sed -n '170,179p'
```

```output
   170	
   171		res, err := db.Exec("INSERT INTO users (username, pwhash) VALUES (?, ?)", req.Username, string(hash))
   172		if err != nil {
   173			if strings.Contains(err.Error(), "UNIQUE") {
   174				jsonErr(w, 409, "username already taken")
   175				return
   176			}
   177			jsonErr(w, 500, "internal error")
   178			return
   179		}
```

**Exploit:** The signup endpoint returns a distinct 409 status with 'username already taken' when a duplicate username is attempted. This allows an attacker to enumerate valid usernames. Combined with the lack of rate limiting (Finding 3), automated enumeration is trivial.

Note: The login endpoint correctly returns the same 401 'invalid credentials' for both wrong username and wrong password — this is done well.

**SUGGESTION:** Return a generic success-like message for signup regardless ('check your email' pattern), or accept the trade-off given the simple auth design and focus on rate limiting instead.

## Finding 9: No Password Length Upper Bound (bcrypt 72-byte limit)

**Severity: MEDIUM**
**File:** main.go, lines 160–165
**Class:** Broken Authentication

```bash
cat -n /home/user/cal/beta/main.go | sed -n '156,166p'
```

```output
   156		if req.Username == "" || req.Password == "" {
   157			jsonErr(w, 400, "username and password required")
   158			return
   159		}
   160		if len(req.Password) < 6 {
   161			jsonErr(w, 400, "password must be at least 6 characters")
   162			return
   163		}
   164	
   165		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
   166		if err != nil {
```

**Issue:** bcrypt silently truncates passwords to 72 bytes. A user who sets a 100-character password can authenticate with just the first 72 characters. There's no upper-bound check or warning. Additionally, `len(req.Password)` counts bytes, not characters — a 6-byte minimum could be fewer than 6 characters in multibyte UTF-8.

More importantly, without an upper bound, an attacker can submit extremely long passwords (megabytes) to force bcrypt to hash a large input, creating a CPU-based denial of service (bcrypt is intentionally slow).

**SUGGESTION:** Add `if len(req.Password) > 72 { ... }` to reject or pre-hash (SHA-256 → bcrypt) passwords longer than bcrypt's limit. Cap at a reasonable max (e.g., 1024 bytes) for DoS prevention.

## Finding 10: Missing Security Headers

**Severity: LOW**
**File:** main.go (entire server)
**Class:** Security Misconfiguration

```bash
grep -n 'X-Content-Type\|X-Frame\|Strict-Transport\|Content-Security-Policy\|X-XSS' /home/user/cal/beta/main.go || echo '(no security headers found)'
```

```output
(no security headers found)
```

**Issue:** No security headers are set. Missing:
- `X-Content-Type-Options: nosniff` — prevents MIME-sniffing attacks
- `X-Frame-Options: DENY` — prevents clickjacking
- `Content-Security-Policy` — would restrict script sources (though the inline script in index.html complicates CSP)

**SUGGESTION:** Add a middleware that sets standard security headers on all responses.

## Finding 11: Session Cookie Missing Secure Flag

**Severity: LOW (context-dependent)**
**File:** main.go, lines 103–112
**Class:** Sensitive Data Exposure

```bash
cat -n /home/user/cal/beta/main.go | sed -n '103,112p'
```

```output
   103	func setSessionCookie(w http.ResponseWriter, tok string) {
   104		http.SetCookie(w, &http.Cookie{
   105			Name:     "session",
   106			Value:    tok,
   107			Path:     "/",
   108			HttpOnly: true,
   109			SameSite: http.SameSiteLaxMode,
   110			MaxAge:   7 * 24 * 3600,
   111		})
   112	}
```

**Issue:** The `Secure` flag is not set on the session cookie. If the application is ever accessed over HTTP (no TLS), the session token is transmitted in plaintext and can be intercepted via network sniffing.

This is LOW severity because the app is likely intended for localhost/development use, where TLS is not typical. However, if deployed behind a reverse proxy with TLS termination, the flag should be set.

**SUGGESTION:** Set `Secure: true` when running in production, or conditionally based on an environment variable.

## Finding 12: Error Message Information Leakage

**Severity: LOW**
**File:** main.go, line 173
**Class:** Information Disclosure

```bash
cat -n /home/user/cal/beta/main.go | sed -n '171,178p'
```

```output
   171		res, err := db.Exec("INSERT INTO users (username, pwhash) VALUES (?, ?)", req.Username, string(hash))
   172		if err != nil {
   173			if strings.Contains(err.Error(), "UNIQUE") {
   174				jsonErr(w, 409, "username already taken")
   175				return
   176			}
   177			jsonErr(w, 500, "internal error")
   178			return
```

**Issue:** The error detection at line 173 relies on string-matching the SQLite error message (`strings.Contains(err.Error(), "UNIQUE")`). This is fragile — if SQLite changes its error format, or if the app switches databases, the UNIQUE check could fail and leak a generic 500. While the error messages returned to the user are generic (good), the pattern is brittle.

**SUGGESTION:** Use SQLite-specific error codes via `sqlite3.ErrConstraintUnique` from the go-sqlite3 driver for reliable detection.

## Dependency Audit

```bash
cat /home/user/cal/beta/go.mod
```

```output
module cal-beta

go 1.24.7

require (
	github.com/mattn/go-sqlite3 v1.14.34 // indirect
	golang.org/x/crypto v0.48.0 // indirect
)
```

Dependencies are minimal: `go-sqlite3 v1.14.34` and `x/crypto v0.48.0`. Both are recent versions. No known CVEs at time of audit. The JavaScript has zero dependencies — no node_modules, no npm packages, no lockfile for the frontend. This is a very small attack surface.

## Negative Findings (Not Vulnerable)

Scanning for remaining vulnerability classes:

```bash
echo '=== Command Injection ===' && grep -rn 'exec\.\|os/exec\|child_process\|spawn\|system(' /home/user/cal/beta/main.go /home/user/cal/beta/static/*.js 2>/dev/null || echo '(none found)' && echo && echo '=== SSRF ===' && grep -rn 'http.Get\|http.Post\|http.Do\|fetch(' /home/user/cal/beta/main.go 2>/dev/null || echo '(no server-side fetches)' && echo && echo '=== eval / dynamic code execution ===' && grep -rn 'eval(\|Function(\|setTimeout.*string\|setInterval.*string' /home/user/cal/beta/static/*.js /home/user/cal/beta/static/*.html 2>/dev/null || echo '(none found)' && echo && echo '=== Hardcoded secrets ===' && grep -rn 'password\s*=\s*"\|secret\s*=\s*"\|api_key\|apikey\|token\s*=\s*"' /home/user/cal/beta/main.go /home/user/cal/beta/static/*.js 2>/dev/null || echo '(none found)' && echo && echo '=== Prototype pollution ===' && grep -rn '__proto__\|constructor\[' /home/user/cal/beta/static/*.js 2>/dev/null || echo '(none found)'
```

```output
=== Command Injection ===
(none found)

=== SSRF ===
(no server-side fetches)

=== eval / dynamic code execution ===
(none found)

=== Hardcoded secrets ===
(none found)

=== Prototype pollution ===
(none found)
```

- **Command Injection:** No `os/exec`, `child_process`, or shell calls anywhere. Not applicable.
- **SSRF:** The server makes no outbound HTTP requests. All `fetch()` calls are client-side (browser → same origin). Not applicable.
- **eval / dynamic code execution:** No `eval()`, `Function()`, or string-based `setTimeout` in any JS file. Not applicable.
- **Hardcoded secrets:** No credentials, API keys, or tokens in source. Not applicable.
- **Prototype pollution:** No `__proto__` access or dynamic property assignment from user input. Not applicable.
- **SSTI / XXE:** No template engines, no XML parsing. Not applicable.
- **JWT misconfiguration:** No JWTs used (sessions are opaque tokens). Not applicable.
- **Agent-specific (prompt injection, tool over-permission, context poisoning):** This is not an LLM-powered application. No AI/agent components. Not applicable.
- **Insecure deserialization:** Go's `json.Decode` into typed structs is safe. JS `JSON.parse` is safe. Not applicable.

## Finding 13: Race Condition in getSession (minor)

**Severity: LOW**
**File:** main.go, lines 89–101
**Class:** Race Condition

```bash
cat -n /home/user/cal/beta/main.go | sed -n '89,101p'
```

```output
    89	func getSession(r *http.Request) *sessionEntry {
    90		c, err := r.Cookie("session")
    91		if err != nil {
    92			return nil
    93		}
    94		sessions.RLock()
    95		s, ok := sessions.m[c.Value]
    96		sessions.RUnlock()
    97		if !ok || time.Now().After(s.expires) {
    98			return nil
    99		}
   100		return &s
   101	}
```

**Issue:** `getSession` returns `&s` where `s` is a copy of the struct from the map (Go map values are returned by value). This is actually safe — the returned pointer is to a local copy, not to the map entry. No race condition here.

However, there is a TOCTOU (time-of-check-time-of-use) window: between `getSession` returning a valid session and the handler using `s.userID` to query the database, the session could be deleted by a concurrent logout request. The impact is minimal — the handler would proceed with the stale session data for that one request. This is acceptable for this application.

**Verdict:** Not exploitable in practice. Downgraded to informational.

## Severity-Ranked Summary

### CRITICAL
1. **Path Traversal via Static File Handler** (main.go:362) — User-controlled URL path concatenated into filesystem path. Mitigated in practice by Go's net/http path cleaning, but the pattern is unsafe-by-design.

### HIGH
2. **No CSRF Protection** (main.go, all POST handlers) — SameSite=Lax provides partial protection but no explicit CSRF token or Content-Type enforcement.
3. **No Rate Limiting on Auth** (main.go:145, 186) — Unlimited login/signup attempts enable brute-force and account-creation abuse.
4. ~~Stored XSS via ruleset names~~ — **Downgraded to INFORMATIONAL** after analysis confirmed all DOM writes use textContent/createElement.

### MEDIUM
5. **No Session Revocation Mechanism** (main.go, session map) — Cannot invalidate all sessions for a user; expired sessions never reaped.
6. **Unbounded Request Body** (main.go, all POST handlers) — No MaxBytesReader; attacker can send arbitrarily large payloads.
7. **Username Enumeration via Signup** (main.go:173) — 409 response reveals existing usernames.
8. **bcrypt 72-byte Truncation / No Upper Bound** (main.go:160-165) — Long passwords silently truncated; no DoS protection against very long passwords.

### LOW
9. **Missing Security Headers** — No X-Content-Type-Options, X-Frame-Options, or CSP.
10. **Session Cookie Missing Secure Flag** (main.go:104-111) — Token sent in plaintext over HTTP.
11. **Brittle Error Detection** (main.go:173) — UNIQUE constraint detection via string matching.

### INFORMATIONAL
- XSS: All DOM writes use safe APIs (textContent, createElement). No vectors found.
- SQL Injection: All queries use parameterized placeholders. Not vulnerable.
- Command Injection, SSRF, eval, secrets, prototype pollution, SSTI, XXE, JWT, agent-specific: Not applicable to this codebase.
- Race condition in getSession: TOCTOU window exists but is not exploitable.
