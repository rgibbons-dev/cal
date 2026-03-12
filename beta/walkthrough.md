# Fare Calculator Beta — Code Walkthrough

*2026-02-25T02:31:19Z by Showboat 0.6.1*
<!-- showboat-id: 1a314c26-cdc2-4661-83b4-d069877dbbff -->

This walkthrough explains the entire Fare Calculator beta codebase from the ground up. We follow the data flow linearly: server startup, database schema, authentication, session management, the fare-rules API, the optimizer algorithm (the heart of the app), the frontend wiring, and the test suite. Four files comprise the whole application:

- **main.go** — Go web server: database, auth, session cookies, REST API, static file serving
- **static/optimizer.js** — Pure-logic fare optimizer, shared by browser and test suite
- **static/index.html** — Single-page frontend: calendar, fare rules UI, auth bar, ruleset save/load
- **static/optimizer_test.js** — Node.js test suite covering all 23 scenarios from the spec

## 1. Project Structure

The beta directory is self-contained. The Go server binary runs from `beta/` and serves `beta/static/` as the web root. No build step is needed for JavaScript — the browser loads ES modules natively via `<script type="module">`.

```bash
find /home/user/cal/beta -type f \! -path '*/.git/*' \! -name 'demo.md' \! -name 'go.sum' | sort | sed 's|/home/user/cal/beta/||'
```

```output
.gitignore
go.mod
main.go
static/index.html
static/optimizer.js
static/optimizer_test.js
walkthrough.md
```

## 2. Server Entrypoint — main()

The server starts in `main()` at the bottom of `main.go`. It initializes the database, registers seven API routes and a catch-all static file handler, then listens on port 8080 (overridable via `PORT` env var). The whole routing table is visible in one glance:

```bash
sed -n '342,371p' /home/user/cal/beta/main.go
```

```output
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
```

The static file handler is minimal: `/` and `/index.html` serve the single-page app; everything else maps to `static/` + the URL path. This means `/optimizer.js` resolves to `static/optimizer.js`, which is exactly what the browser's ES module import needs.

## 3. Database Schema — initDB()

SQLite3 is the persistence layer. The database file defaults to `cal.db` in the working directory (overridable via `CAL_DB` env var). WAL mode and a 5-second busy timeout are set in the connection string for safe concurrent reads. `SetMaxOpenConns(1)` enforces SQLite's single-writer constraint.

Two tables:

```bash
sed -n '36,65p' /home/user/cal/beta/main.go
```

```output
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
```

Key design choices:
- **users.pwhash** stores a bcrypt hash, never plaintext. The column name makes this explicit.
- **rulesets.rules** is a TEXT column holding a JSON array of fare rule objects. This avoids a normalized fare_rules table — the rules are always read and written as a unit, so JSON is the natural shape.
- **UNIQUE(user_id, name)** on rulesets means a user can't have two rulesets with the same name. The save endpoint exploits this with `ON CONFLICT ... DO UPDATE` for upsert behavior.

## 4. Session Management

Sessions are stored in-memory in a mutex-protected map. This is intentional: the app is single-server and session loss on restart is acceptable for this scale. Each session is a 32-byte cryptographically random token mapped to a user ID, username, and expiry time.

```bash
sed -n '20,32p' /home/user/cal/beta/main.go
```

```output
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
```

The session map uses `sync.RWMutex` — reads (`getSession`) take a read lock, writes (`createSession`, logout) take a write lock. This allows concurrent request handling without data races.

Token generation uses `crypto/rand`, not `math/rand`, producing 64 hex characters of entropy:

```bash
sed -n '69,75p' /home/user/cal/beta/main.go
```

```output
func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatal(err)
	}
	return hex.EncodeToString(b)
}
```

The session cookie is configured defensively:

```bash
sed -n '103,112p' /home/user/cal/beta/main.go
```

```output
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
```

- **HttpOnly: true** — JavaScript cannot read the cookie, preventing XSS token theft.
- **SameSite: Lax** — the cookie is not sent on cross-site POST requests, mitigating CSRF.
- **MaxAge: 7 days** — the browser discards the cookie after a week. The server also checks an in-memory expiry, so even if the cookie persists, the session is validated server-side.

## 5. Authentication Handlers

Three endpoints handle the auth lifecycle: signup, login, and logout. A fourth (`/api/me`) lets the frontend check the current session on page load.

### Signup (/api/signup)

The signup handler validates input, hashes the password with bcrypt at default cost (currently 10 rounds = 2^10 iterations), inserts into the database, and immediately creates a session so the user is logged in after registration:

```bash
sed -n '145,184p' /home/user/cal/beta/main.go
```

```output
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
```

Notice: the error path checks for `UNIQUE` in the error string to return a 409 Conflict for duplicate usernames, rather than a generic 500. The password is never logged or echoed back.

### Login (/api/login)

Login looks up the user by username, then uses `bcrypt.CompareHashAndPassword` to verify. This function is constant-time, preventing timing attacks. Both 'user not found' and 'wrong password' return the same generic 401 message to avoid username enumeration:

```bash
sed -n '186,213p' /home/user/cal/beta/main.go
```

```output
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
```

### Logout and Me

Logout deletes the session from the in-memory map and expires the cookie. `/api/me` is a GET that returns `{loggedIn: true, username: '...'}` or `{loggedIn: false}` — the frontend calls this on page load to restore auth state:

```bash
sed -n '215,236p' /home/user/cal/beta/main.go
```

```output
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
```

## 6. Fare Ruleset API

The ruleset endpoints let authenticated users persist named sets of fare rules. Three operations: save (upsert), list, and delete.

### Save (/api/rulesets/save)

The save handler marshals the rules array to JSON and uses SQLite's `ON CONFLICT ... DO UPDATE` for upsert. If a ruleset with the same name already exists for this user, it overwrites. Otherwise it inserts:

```bash
sed -n '259,290p' /home/user/cal/beta/main.go
```

```output
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
```

### List (/api/rulesets)

Returns all rulesets for the logged-in user, ordered by most recently saved. The JSON `rules` column is deserialized back into Go structs for the response:

```bash
sed -n '292,319p' /home/user/cal/beta/main.go
```

```output
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
```

Note the `if out == nil { out = []rulesetResp{} }` guard — this ensures the JSON response is always `[]` rather than `null` when no rulesets exist, which is friendlier for frontend code.

That covers the entire Go server. Now we move to the heart of the application: the fare optimizer.

## 7. The Fare Optimizer — optimizer.js

This is the algorithmic core. It's a pure ES module with no DOM dependencies — the same file is imported by the browser (`<script type="module">`) and by Node.js (the test suite). Zero build tools, zero bundlers.

### 7a. Fare Type System

The optimizer understands four fare types, each with different semantics:

```bash
sed -n '1,31p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── Fare Optimizer (pure logic, no DOM) ───
// This module is shared between the UI and the test suite.

export const FREQ_OPTIONS = [
  ["n-fare",  "N-fare"],
  ["n-day",   "N-day"],
  ["weekly",  "Weekly"],
  ["monthly", "Monthly"],
];

export const FIELD_ACTIVE = {
  "n-fare":  { trips: true,  days: true  },
  "n-day":   { trips: false, days: true  },
  "weekly":  { trips: false, days: false },
  "monthly": { trips: false, days: false },
};

export const FIELD_HINT = {
  "n-fare":  { trips: "n", days: "expiry" },
  "n-day":   { trips: "",  days: "days"   },
  "weekly":  { trips: "",  days: ""       },
  "monthly": { trips: "",  days: ""       },
};

export const DEFAULT_RULES = [
  { name: "1-Trip",       rate: "",  frequency: "n-fare",  trips: 1,  days: 0  },
  { name: "10-Trip",      rate: "",  frequency: "n-fare",  trips: 10, days: 30 },
  { name: "3-Day Pass",   rate: "",  frequency: "n-day",   trips: 0,  days: 3  },
  { name: "Weekly Pass",  rate: "",  frequency: "weekly",  trips: 0,  days: 0  },
  { name: "Monthly Pass", rate: "",  frequency: "monthly", trips: 0,  days: 0  },
];
```

The four types:

| Type | Meaning | Parameters |
|------|---------|------------|
| **n-fare** | Buy N rides, use within an expiry window | trips (N), days (expiry) |
| **n-day** | Consecutive-day pass from first use (unlimited rides) | days (duration) |
| **weekly** | Calendar-aligned Sat–Fri pass (unlimited rides) | (none) |
| **monthly** | Calendar-aligned 1st–last pass (unlimited rides) | (none) |

`FIELD_ACTIVE` controls which input fields are enabled in the UI for each type. `DEFAULT_RULES` pre-populates the form with common fare structures (rates left blank for the user to fill in).

### 7b. Helper Functions

Before the optimizer itself, several helpers handle date math and ride expansion:

```bash
sed -n '33,71p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── Helpers ───

export function parseRate(val) {
  const n = parseFloat(String(val).replace(/\$/g, ""));
  return isNaN(n) ? 0 : n;
}

function compd(a, b) { return a.getTime() - b.getTime(); }

function daysBetween(a, b) {
  return Math.floor((b - a) / 86400000);
}

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

export function activeRules(fareRules, freq) {
  return fareRules.filter(r =>
    r.frequency === freq && r.name && parseRate(r.rate) > 0
  );
}

function cheapestRule(rules) {
  return rules.reduce((best, r) =>
    parseRate(r.rate) < parseRate(best.rate) ? r : best
  );
}

// ─── Expand tripMap into flat rides ───
export function expandRides(tripMap) {
  const rides = [];
  for (const [, entry] of tripMap) {
    for (let i = 0; i < entry.trips; i++) {
      rides.push(new Date(entry.date));
    }
  }
  return rides.sort(compd);
}
```

Key insight: `expandRides` converts the UI's `tripMap` (date → trip count) into a flat array of Date objects sorted chronologically. If a user taps a day 3 times, that date appears 3 times in the array. This 'expanded rides' array is what every grouping algorithm operates on.

`parseRate` strips dollar signs and parses to float. `activeRules` filters out any rule without a name or with a zero/empty rate — these are 'inactive' skeleton rules the user hasn't filled in yet.

### 7c. Grouping Algorithms

Three grouping functions partition rides into windows for each fare type. These are the building blocks the optimizer uses to evaluate costs.

**Weekly windows (Sat–Fri):** The `satBefore` function finds the Saturday on or before a given date, establishing the window start. `getWeeklyWindows` then greedily groups rides into Sat–Fri buckets:

```bash
sed -n '86,114p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── Weekly windows (Sat–Fri) ───
function satBefore(d) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  const diff = (s.getDay() + 1) % 7;
  s.setDate(s.getDate() - diff);
  return s;
}

function getWeeklyWindows(rides) {
  if (rides.length === 0) return [];
  const sorted = [...rides].sort(compd);
  const windows = [];
  let current = [sorted[0]];
  let windowStart = satBefore(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i];
    if (daysBetween(windowStart, d) < 7) {
      current.push(d);
    } else {
      windows.push(current);
      current = [d];
      windowStart = satBefore(d);
    }
  }
  if (current.length > 0) windows.push(current);
  return windows;
}
```

The Sat–Fri alignment comes from `(s.getDay() + 1) % 7` — JS getDay() returns 0=Sun through 6=Sat, so adding 1 and mod 7 gives the offset from the preceding Saturday.

**N-fare grouping:** Packs rides into groups of up to N, respecting an optional expiry window (days from the first ride in the group). If expiry is 0, no time limit is enforced:

```bash
sed -n '116,136p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── N-fare grouping ───
function getNFareGroups(rides, n, expiry) {
  if (rides.length === 0) return [];
  const sorted = [...rides].sort(compd);
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]];
    const anchor = sorted[i];
    let j = i + 1;
    while (j < sorted.length && group.length < n) {
      const span = daysBetween(anchor, sorted[j]);
      if (expiry > 0 && span >= expiry) break;
      group.push(sorted[j]);
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}
```

This is a greedy left-to-right scan: anchor the first ride, sweep forward collecting rides until you hit N or the expiry. Then start a new group. The expiry check (`span >= expiry`) is what makes scenario 4 (the 'expiry breaker') work — rides more than 30 days apart can't share a 10-trip ticket.

**N-day grouping:** Similar greedy scan, but the constraint is calendar days from the anchor rather than ride count. All rides within the duration window are covered by one pass:

```bash
sed -n '138,157p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── N-day grouping ───
function getNDayGroups(rides, duration) {
  if (rides.length === 0 || duration <= 0) return [];
  const sorted = [...rides].sort(compd);
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    const anchor = sorted[i];
    const group = [anchor];
    let j = i + 1;
    while (j < sorted.length) {
      if (daysBetween(anchor, sorted[j]) >= duration) break;
      group.push(sorted[j]);
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}
```

### 7d. The Optimizer — calculateOptimalTicket()

This is the main algorithm. It uses a **layered greedy** approach: process fare types in a fixed priority order, and at each layer, only apply a pass/ticket if it's actually cheaper than the per-ride baseline.

The priority order is: Monthly → N-day → Weekly → N-fare.

The key data structures:
- `coveredIdx` — a Set of ride indices already assigned to a ticket
- `remWithIdx()` — returns uncovered rides paired with their original indices
- `baseRideCost` — the cheapest per-ride cost from any n-fare rule (used as the 'alternative cost' when deciding whether a pass is worth it)

```bash
sed -n '175,208p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── Optimizer ───
//
// Layered greedy on individual rides:
//   1. Monthly  – calendar months (unlimited rides)
//   2. N-day    – consecutive-day pass from first use (unlimited rides)
//   3. Weekly   – calendar Sat–Fri (unlimited rides)
//   4. N-fare   – multi-ride tickets covering remaining rides
//
// Passes (monthly, n-day, weekly) are compared against the base per-ride
// cost derived from the cheapest n-fare rule (rate / trips).

export function calculateOptimalTicket(fareRules, tripMap) {
  const rides = expandRides(tripMap);
  if (rides.length === 0) return { tickets: [], cost: 0 };

  const weeklyRules  = activeRules(fareRules, "weekly");
  const monthlyRules = activeRules(fareRules, "monthly");
  const nFareRules   = activeRules(fareRules, "n-fare");
  const nDayRules    = activeRules(fareRules, "n-day");

  const allActive = [...weeklyRules, ...monthlyRules, ...nFareRules, ...nDayRules];
  if (allActive.length === 0) return { tickets: [], cost: 0 };

  const baseRideCost = getBaseRideCost(fareRules);

  let tickets = [];
  let totalCost = 0;
  let coveredIdx = new Set();

  function remWithIdx() {
    return rides
      .map((r, idx) => ({ ride: r, idx }))
      .filter(({ idx }) => !coveredIdx.has(idx));
  }
```

Now each layer. **Layer 1 — Monthly:** Group uncovered rides by calendar month. For each month, compare the monthly pass cost against paying per-ride. Only buy the pass if it's cheaper:

```bash
sed -n '210,231p' /home/user/cal/beta/static/optimizer.js
```

```output
  // ── 1. Monthly ──
  if (monthlyRules.length > 0) {
    const rule = cheapestRule(monthlyRules);
    const rate = parseRate(rule.rate);

    const months = {};
    rides.forEach((r, idx) => {
      if (coveredIdx.has(idx)) return;
      const k = monthKey(r);
      if (!months[k]) months[k] = [];
      months[k].push(idx);
    });

    for (const [, idxs] of Object.entries(months)) {
      const altCost = idxs.length * (baseRideCost === Infinity ? rate : baseRideCost);
      if (rate < altCost) {
        tickets.push(rule.name);
        totalCost += rate;
        idxs.forEach(i => coveredIdx.add(i));
      }
    }
  }
```

The critical line is `const altCost = idxs.length * (baseRideCost === Infinity ? rate : baseRideCost)`. If there are no n-fare rules at all (baseRideCost is Infinity), the alternative cost equals the pass rate itself — meaning the pass always wins when it's the only option (scenario 18). Otherwise, it compares against what those rides would cost at per-ride rates.

**Layer 2 — N-day:** For each n-day rule, group remaining rides into duration-windows and apply the same cost comparison:

```bash
sed -n '233,255p' /home/user/cal/beta/static/optimizer.js
```

```output
  // ── 2. N-day ──
  if (nDayRules.length > 0) {
    for (const rule of nDayRules) {
      const rate = parseRate(rule.rate);
      const duration = rule.days || 1;
      const rem = remWithIdx();
      if (rem.length === 0) break;

      const groups = getNDayGroups(rem.map(r => r.ride), duration);
      let pool = [...rem];
      for (const group of groups) {
        const gIdx = mapGroupToIdx(group, pool);
        pool = pool.filter(r => !gIdx.includes(r.idx));

        const altCost = gIdx.length * (baseRideCost === Infinity ? rate : baseRideCost);
        if (rate < altCost) {
          tickets.push(rule.name);
          totalCost += rate;
          gIdx.forEach(i => coveredIdx.add(i));
        }
      }
    }
  }
```

Notice the `mapGroupToIdx` helper — grouping algorithms work on Date arrays, but the optimizer tracks coverage by index. This function maps a group of Dates back to their indices in the remaining-rides pool, handling duplicate dates correctly (important when multiple trips occur on the same day).

**Layer 3 — Weekly:** Same pattern, using Sat–Fri windows:

```bash
sed -n '257,277p' /home/user/cal/beta/static/optimizer.js
```

```output
  // ── 3. Weekly ──
  if (weeklyRules.length > 0) {
    const rule = cheapestRule(weeklyRules);
    const rate = parseRate(rule.rate);

    const rem = remWithIdx();
    const windows = getWeeklyWindows(rem.map(r => r.ride));

    let pool = [...rem];
    for (const win of windows) {
      const wIdx = mapGroupToIdx(win, pool);
      pool = pool.filter(r => !wIdx.includes(r.idx));

      const altCost = wIdx.length * (baseRideCost === Infinity ? rate : baseRideCost);
      if (rate < altCost) {
        tickets.push(rule.name);
        totalCost += rate;
        wIdx.forEach(i => coveredIdx.add(i));
      }
    }
  }
```

**Layer 4 — N-fare (the most complex):** All remaining rides must be covered by n-fare tickets. The optimizer tries two strategies and picks the cheaper:

1. **Pure strategy:** Try each n-fare rule independently and group all remaining rides with it.
2. **Mixed strategy:** For each bulk rule (trips > 1), group rides into bulk-sized chunks, but for the last partial group, compare buying a full bulk ticket vs. individual singles.

This is what allows scenario 5 (11 trips → 10-Trip + 1 single = $49.50 instead of 2×10-Trip = $88.00):

```bash
sed -n '279,348p' /home/user/cal/beta/static/optimizer.js
```

```output
  // ── 4. N-fare (covers all remaining rides) ──
  if (nFareRules.length > 0) {
    const rem = remWithIdx();
    if (rem.length > 0) {
      let bestPlan = null;
      let bestCost = Infinity;

      for (const rule of nFareRules) {
        const rate = parseRate(rule.rate);
        const n = rule.trips || 1;
        const expiry = rule.days || 0;

        const groups = getNFareGroups(rem.map(r => r.ride), n, expiry);
        let planTickets = [];
        let planCost = 0;

        for (const group of groups) {
          planTickets.push(rule.name);
          planCost += rate;
        }

        if (planCost < bestCost) {
          bestCost = planCost;
          bestPlan = { tickets: planTickets, cost: planCost };
        }
      }

      // Try mixing: bulk + singles
      if (nFareRules.length > 1 || (nFareRules[0] && (nFareRules[0].trips || 1) > 1)) {
        const singleRule = nFareRules.find(r => (r.trips || 1) === 1);
        const bulkRules = nFareRules.filter(r => (r.trips || 1) > 1);

        if (singleRule && bulkRules.length > 0) {
          for (const bulk of bulkRules) {
            const bulkRate = parseRate(bulk.rate);
            const bulkN = bulk.trips || 1;
            const bulkExpiry = bulk.days || 0;
            const singleRate = parseRate(singleRule.rate);

            const groups = getNFareGroups(rem.map(r => r.ride), bulkN, bulkExpiry);
            let planTickets = [];
            let planCost = 0;

            for (const group of groups) {
              const singlesCost = group.length * singleRate;
              if (bulkRate < singlesCost) {
                planTickets.push(bulk.name);
                planCost += bulkRate;
              } else {
                group.forEach(() => planTickets.push(singleRule.name));
                planCost += singlesCost;
              }
            }

            if (planCost < bestCost) {
              bestCost = planCost;
              bestPlan = { tickets: planTickets, cost: planCost };
            }
          }
        }
      }

      if (bestPlan) {
        tickets.push(...bestPlan.tickets);
        totalCost += bestPlan.cost;
        // Mark all remaining rides as covered
        rem.forEach(r => coveredIdx.add(r.idx));
      }
    }
  }
```

The line `rem.forEach(r => coveredIdx.add(r.idx))` at the end is a bug fix from the alpha version. Without it, the fallback block (below) would re-count all rides that were already handled by n-fare tickets, doubling the cost. This was caught by the test suite — every 'singles' scenario produced exactly 2x the expected cost.

**Fallback:** A safety net for edge cases where no rule passed the cost comparison (e.g., scenario 18 — only a monthly pass, 1 ride). The cheapest available rule is applied unconditionally:

```bash
sed -n '350,372p' /home/user/cal/beta/static/optimizer.js
```

```output
  // ── Fallback: any rides still uncovered ──
  const finalRem = remWithIdx();
  if (finalRem.length > 0) {
    const fallback = allActive.reduce((best, r) =>
      parseRate(r.rate) < parseRate(best.rate) ? r : best
    );
    const fbRate = parseRate(fallback.rate);
    if (fallback.frequency === "monthly" || fallback.frequency === "weekly" || fallback.frequency === "n-day") {
      tickets.push(fallback.name);
      totalCost += fbRate;
    } else {
      const n = fallback.trips || 1;
      const expiry = fallback.days || 0;
      const groups = getNFareGroups(finalRem.map(r => r.ride), n, expiry);
      for (const g of groups) {
        tickets.push(fallback.name);
        totalCost += fbRate;
      }
    }
  }

  return { tickets, cost: totalCost };
}
```

Finally, `consolidateTickets` is a display helper that collapses `['1-Trip', '1-Trip', '1-Trip']` into `['1-Trip x3']`:

```bash
sed -n '374,384p' /home/user/cal/beta/static/optimizer.js
```

```output
// ─── Display helper ───
export function consolidateTickets(ticketList) {
  const counts = ticketList.reduce((acc, t) => {
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([name, count]) =>
    count > 1 ? `${name} \u00d7${count}` : name
  );
}
```

## 8. The Frontend — index.html

The frontend is a single HTML file with inline CSS and a `<script type="module">` that imports from `optimizer.js`. No build step, no bundler. It has four concerns: auth bar, fare rules editor, calendar, and recommendation display.

### 8a. Module Import

The browser loads the optimizer as a native ES module:

```bash
sed -n '435,439p' /home/user/cal/beta/static/index.html
```

```output
        <script type="module">
          import {
            FREQ_OPTIONS, FIELD_ACTIVE, FIELD_HINT, DEFAULT_RULES,
            parseRate, calculateOptimalTicket, consolidateTickets
          } from "./optimizer.js";
```

This is the same file the test suite imports. No CDN, no build, no duplication.

### 8b. Auth Bar

The auth bar renders differently based on `currentUser`. When logged out, it shows username/password inputs plus Sign in and Sign up buttons. When logged in, it shows the username and a Sign out button. The `doAuth` helper handles both login and signup through a shared fetch-and-render pattern:

```bash
sed -n '464,544p' /home/user/cal/beta/static/index.html
```

```output
          // ─── Auth state ───
          let currentUser = null;

          async function checkAuth() {
            try {
              const resp = await fetch("/api/me");
              const data = await resp.json();
              currentUser = data.loggedIn ? data.username : null;
            } catch { currentUser = null; }
            renderAuthBar();
            renderRulesetSection();
          }

          function renderAuthBar() {
            const bar = document.getElementById("auth-bar");
            bar.innerHTML = "";

            if (currentUser) {
              const userSpan = document.createElement("span");
              userSpan.className = "auth-user";
              userSpan.textContent = currentUser;
              const logoutBtn = document.createElement("button");
              logoutBtn.textContent = "Sign out";
              logoutBtn.addEventListener("click", async () => {
                await fetch("/api/logout", { method: "POST" });
                currentUser = null;
                renderAuthBar();
                renderRulesetSection();
              });
              bar.appendChild(userSpan);
              bar.appendChild(logoutBtn);
            } else {
              const userIn = document.createElement("input");
              userIn.placeholder = "username";
              userIn.id = "auth-username";
              const passIn = document.createElement("input");
              passIn.type = "password";
              passIn.placeholder = "password";
              passIn.id = "auth-password";
              const loginBtn = document.createElement("button");
              loginBtn.textContent = "Sign in";
              const signupBtn = document.createElement("button");
              signupBtn.textContent = "Sign up";
              const msgSpan = document.createElement("span");
              msgSpan.className = "auth-msg";
              msgSpan.id = "auth-msg";

              async function doAuth(endpoint) {
                msgSpan.textContent = "";
                const body = JSON.stringify({
                  username: userIn.value.trim(),
                  password: passIn.value,
                });
                try {
                  const resp = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body,
                  });
                  const data = await resp.json();
                  if (!resp.ok) {
                    msgSpan.textContent = data.error || "error";
                    return;
                  }
                  currentUser = data.username;
                  renderAuthBar();
                  renderRulesetSection();
                } catch (e) {
                  msgSpan.textContent = "network error";
                }
              }

              loginBtn.addEventListener("click", () => doAuth("/api/login"));
              signupBtn.addEventListener("click", () => doAuth("/api/signup"));

              bar.appendChild(userIn);
              bar.appendChild(passIn);
              bar.appendChild(loginBtn);
              bar.appendChild(signupBtn);
              bar.appendChild(msgSpan);
            }
```

Note how `checkAuth()` is called at the end of `DOMContentLoaded` (line 920). This means the page loads and renders immediately — the auth check is async and updates the UI when it resolves. A user who isn't logged in sees the full fare calculator with no delay.

### 8c. Ruleset Save/Load

The ruleset section only renders when `currentUser` is set. It consists of a text input for naming, a Save button, a dropdown for loading, and a Delete button:

```bash
sed -n '604,618p' /home/user/cal/beta/static/index.html
```

```output
            loadSel.addEventListener("change", async () => {
              const name = loadSel.value;
              if (!name) return;
              try {
                const resp = await fetch("/api/rulesets");
                const list = await resp.json();
                const found = list.find(r => r.name === name);
                if (found) {
                  fareRules = found.rules.map(r => ({ ...r }));
                  renderRules();
                  recalculate();
                  showMsg(msgEl, `loaded "${name}"`, false);
                }
              } catch { showMsg(msgEl, "network error", true); }
              loadSel.value = "";
```

The load action is the critical line: `fareRules = found.rules.map(r => ({ ...r }))`. It replaces the entire `fareRules` array with shallow copies from the server response, then re-renders the rule cards and recalculates. The dropdown resets to 'Load...' afterward. No confirmation dialog — the subtitle explains this behavior to the user upfront.

### 8d. Calendar and Trip State

The calendar is generated dynamically based on the current date. Each day cell is a click target that cycles through 0→1→2→3→4→0 trips, stored in a `Map` keyed by date string:

```bash
sed -n '880,902p' /home/user/cal/beta/static/index.html
```

```output
              span.addEventListener("click", function () {
                const allActive = fareRules.filter(r => r.name && parseRate(r.rate) > 0);
                if (allActive.length === 0) {
                  alert("Configure at least one fare rule with a name and rate first.");
                  return;
                }

                const entry = tripMap.get(dateKey);
                const current = entry ? entry.trips : 0;
                const next = (current + 1) % 5;

                if (next === 0) {
                  tripMap.delete(dateKey);
                } else {
                  tripMap.set(dateKey, {
                    date: new Date(thisYear, thisMonth, thisDay),
                    trips: next,
                  });
                }

                applyTripVisual(this, next);
                recalculate();
              });
```

The modular `% 5` creates the cycle: 0→1→2→3→4→0. When trips reach 0, the entry is deleted from the map. This is what scenario 15 tests — tapping 5 times returns to empty, and the optimizer correctly sees zero rides.

Each tap immediately calls `recalculate()`, which calls `calculateOptimalTicket(fareRules, tripMap)` and updates the recommendation display. The entire optimizer runs on every click — fast enough for the data sizes involved (max ~60 days × 4 trips = 240 rides).

### 8e. Visual Feedback

Trip counts are shown as color gradients on calendar cells. The `tripBackground` function produces CSS gradients that split the cell into colored quadrants:

```bash
sed -n '447,459p' /home/user/cal/beta/static/index.html
```

```output
          function tripBackground(n) {
            switch (n) {
              case 1: return C1;
              case 2: return `linear-gradient(to right, ${C1} 50%, ${C2} 50%)`;
              case 3:
                return `linear-gradient(to bottom, ${C1} 50%, ${C2} 50%) left/50% 100% no-repeat, ` +
                       `linear-gradient(${C3}, ${C3}) right/50% 100% no-repeat`;
              case 4:
                return `linear-gradient(to bottom, ${C1} 50%, ${C2} 50%) left/50% 100% no-repeat, ` +
                       `linear-gradient(to bottom, ${C3} 50%, ${C4} 50%) right/50% 100% no-repeat`;
              default: return "";
            }
          }
```

1 trip = solid terra cotta. 2 = left/right split (terra cotta + blue). 3 = top-left, bottom-left, right (three colors). 4 = four quadrants. The legend at the top of the calendar shows which color means which count.

## 9. The Test Suite — optimizer_test.js

The test suite imports the same `optimizer.js` module and runs entirely in Node.js with no browser, no DOM, no dependencies. It defines helpers to construct tripMap entries from dates and trip counts, then runs each of the 23 scenarios from the test spec.

### 9a. Test Helpers

The test infrastructure is minimal — no framework, just assertion functions that track pass/fail counts:

```bash
sed -n '6,91p' /home/user/cal/beta/static/optimizer_test.js
```

```output
import { calculateOptimalTicket, consolidateTickets } from "./optimizer.js";

// ─── Helpers ───

function makeTripMap(entries) {
  // entries: [{ date: Date, trips: number }, ...]
  const m = new Map();
  for (const e of entries) {
    const key = e.date.toDateString();
    m.set(key, { date: new Date(e.date), trips: e.trips });
  }
  return m;
}

function dateDays(year, month, day) {
  return new Date(year, month - 1, day);
}

// Generate N weekday dates starting from a given date
function weekdaysFrom(start, count) {
  const dates = [];
  const d = new Date(start);
  while (dates.length < count) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Generate all weekdays in a month
function allWeekdays(year, month) {
  const dates = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// Generate all Sat/Sun in a range
function allWeekends(year, month) {
  const dates = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 0 || d.getDay() === 6) {
      dates.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(condition, scenario, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${detail}`);
  } else {
    failed++;
    const msg = `  FAIL: ${detail}`;
    console.log(msg);
    failures.push(`Scenario ${scenario}: ${detail}`);
  }
}

function assertCost(result, expected, scenario, label) {
  const actual = Math.round(result.cost * 100) / 100;
  const exp = Math.round(expected * 100) / 100;
  assert(actual === exp, scenario, `${label} cost: expected $${exp.toFixed(2)}, got $${actual.toFixed(2)}`);
}

function assertTickets(result, expectedConsolidated, scenario, label) {
  const actual = consolidateTickets(result.tickets).sort();
  const expected = [...expectedConsolidated].sort();
  const match = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  assert(match, scenario, `${label} tickets: expected [${expected}], got [${actual}]`);
}
```

`makeTripMap` constructs the same Map shape the UI uses, keyed by `date.toDateString()`. `dateDays(2026, 2, 10)` is shorthand for Feb 10, 2026 (1-indexed months, unlike JS's 0-indexed `new Date()`).

`assertCost` rounds to 2 decimal places to avoid floating-point noise. `assertTickets` sorts both arrays before comparing so ticket order doesn't matter.

### 9b. Example Scenario

Here's how scenario 5 (11 trips in 30 days) translates from the English spec to code:

```bash
sed -n '153,166p' /home/user/cal/beta/static/optimizer_test.js
```

```output
// ── Scenario 5: 11 trips in 30 days ──
console.log("\nScenario 5 — 11 trips in 30 days");
{
  const rules = [
    { name: "1-Trip", rate: "5.50", frequency: "n-fare", trips: 1, days: 0 },
    { name: "10-Trip", rate: "44.00", frequency: "n-fare", trips: 10, days: 30 },
  ];
  const dates = [];
  for (let i = 1; i <= 11; i++) dates.push({ date: dateDays(2026, 2, i), trips: 1 });
  const trips = makeTripMap(dates);
  const r = calculateOptimalTicket(rules, trips);
  assertCost(r, 49.50, 5, "10+1 combo");
  assertTickets(r, ["10-Trip", "1-Trip"], 5, "10+1 combo");
}
```

The spec says: 11 trips within 30 days with NJT fares ($5.50 single, $44.00 for 10-trip). Expected: 10-Trip x1 + 1-Trip x1 = $49.50. The test creates 11 date entries (Feb 1–11), calls the optimizer, and asserts both cost and ticket breakdown.

### 9c. Running the Suite

Let's run it to confirm everything passes:

```bash
cd /home/user/cal/beta/static && node optimizer_test.js
```

```output

=== Fare Optimizer Test Suite ===

Scenario 1 — Single trip, single day
  PASS: single trip cost: expected $3.75, got $3.75
  PASS: single trip tickets: expected [1-Trip], got [1-Trip]

Scenario 2 — Single day, 4 trips
  PASS: 4 singles cost: expected $15.00, got $15.00
  PASS: 4 singles tickets: expected [1-Trip ×4], got [1-Trip ×4]

Scenario 3 — Exact 10-trip fit across scattered days
  PASS: 10-trip bundle cost: expected $44.00, got $44.00
  PASS: 10-trip bundle tickets: expected [10-Trip], got [10-Trip]

Scenario 4 — 10-trip expiry breaker
  PASS: expiry splits cost: expected $55.00, got $55.00
  PASS: expiry splits tickets: expected [1-Trip ×10], got [1-Trip ×10]

Scenario 5 — 11 trips in 30 days
  PASS: 10+1 combo cost: expected $49.50, got $49.50
  PASS: 10+1 combo tickets: expected [1-Trip,10-Trip], got [1-Trip,10-Trip]

Scenario 6 — Bulk overkill: 3 trips with expensive 10-trip
  PASS: singles beat bulk cost: expected $11.25, got $11.25
  PASS: singles beat bulk tickets: expected [1-Trip ×3], got [1-Trip ×3]

Scenario 7 — Weekly break-even (MTA), singles should win
  PASS: singles win over weekly cost: expected $29.00, got $29.00
  PASS: singles win over weekly tickets: expected [1-Ride ×10], got [1-Ride ×10]

Scenario 8 — Weekly pass worth it
  PASS: weekly wins cost: expected $34.00, got $34.00
  PASS: weekly wins tickets: expected [7-Day Unlimited], got [7-Day Unlimited]

Scenario 9 — Monthly vs weekly, singles should win
  PASS: cost $75.00 <= singles $75.00
  PASS: cost $75.00 < monthly $104.50

Scenario 10 — Monthly wins with volume
  PASS: monthly wins cost: expected $104.50, got $104.50
  PASS: monthly wins tickets: expected [Monthly], got [Monthly]

Scenario 11 — 3-day pass edges out singles
  PASS: 3-day pass wins cost: expected $21.75, got $21.75
  PASS: 3-day pass wins tickets: expected [3-Day Pass], got [3-Day Pass]

Scenario 12 — 3-day pass not worth it
  PASS: singles win cost: expected $11.25, got $11.25
  PASS: singles win tickets: expected [1-Trip ×3], got [1-Trip ×3]

Scenario 13 — Rides straddle two weekly windows
  PASS: all singles across windows cost: expected $43.50, got $43.50
  PASS: all singles across windows tickets: expected [1-Ride ×15], got [1-Ride ×15]

Scenario 14 — Cross-month boundary
  PASS: singles across months cost: expected $90.00, got $90.00
  PASS: singles across months tickets: expected [1-Trip ×24], got [1-Trip ×24]

Scenario 15 — Zero-trip tap regression
  PASS: empty trips cost: expected $0.00, got $0.00
  PASS: no tickets for empty trips

Scenario 16 — Reset clears everything (same as empty state)
  PASS: reset state cost: expected $0.00, got $0.00
  PASS: no tickets after reset

Scenario 17 — No rules configured
  PASS: no rules = no cost cost: expected $0.00, got $0.00
  PASS: no rules = no tickets

Scenario 18 — Only monthly pass configured, 1 ride
  PASS: only option cost: expected $100.00, got $100.00
  PASS: only option tickets: expected [Monthly], got [Monthly]

Scenario 19 — N-day with multi-trip days at boundary
  PASS: 3-day pass covers gap cost: expected $21.75, got $21.75
  PASS: 3-day pass covers gap tickets: expected [3-Day Pass], got [3-Day Pass]

Scenario 20 — Competing n-fare rules
  PASS: cost $24.75 <= $26.25 (singles baseline)

Scenario 21 — Weekend-only rider
  PASS: cost $46.40 <= singles $46.40
  PASS: cost $46.40 < monthly $132.00

Scenario 22 — All fare types active, high volume commuter
  PASS: monthly wins with all types cost: expected $104.50, got $104.50
  PASS: monthly wins with all types tickets: expected [Monthly], got [Monthly]

Scenario 23 — Break-even boundary for weekly
  PASS: weekly wins at 12 rides cost: expected $34.00, got $34.00
  PASS: weekly wins at 12 rides tickets: expected [7-Day Unlimited], got [7-Day Unlimited]

Scenario 23b — Below break-even (11 rides)
  PASS: singles at 11 rides cost: expected $31.90, got $31.90
  PASS: singles at 11 rides tickets: expected [1-Ride ×11], got [1-Ride ×11]

========================================
Results: 47 passed, 0 failed, 0 skipped

```

47/47 pass. The scenarios cover:

- **Basic operation** (1, 2, 15, 16, 17) — single trip, multi-trip, zero trips, reset, no rules
- **N-fare grouping** (3, 4, 5, 6, 20) — exact fit, expiry splitting, partial fill + singles, bulk overkill, competing rules
- **Weekly passes** (7, 8, 13, 23, 23b) — below break-even, above break-even, cross-window split, exact boundary
- **Monthly passes** (9, 10, 14, 18) — low volume (singles win), high volume (monthly wins), cross-month, only-option fallback
- **N-day passes** (11, 12, 19) — tight margin win, not worth it, gap in selected days
- **Full stack** (21, 22) — all rule types active, weekend-only rider

## 10. Data Flow Summary

Putting it all together, here's the complete request flow:

1. Browser loads `/` → Go serves `static/index.html`
2. Browser fetches `/optimizer.js` → Go serves `static/optimizer.js` as ES module
3. `DOMContentLoaded` fires → calendar renders, `checkAuth()` calls `/api/me`
4. User clicks a day → `tripMap` updates → `calculateOptimalTicket(fareRules, tripMap)` runs → recommendation updates
5. User signs in → `POST /api/login` → session cookie set → ruleset section appears
6. User saves a ruleset → `POST /api/rulesets/save` → JSON stored in SQLite
7. User loads a ruleset → `GET /api/rulesets` → `fareRules` replaced → rules re-render → optimizer recalculates

The optimizer is the only computation-heavy path, and it runs entirely client-side. The server is a thin persistence layer for auth and rulesets.
