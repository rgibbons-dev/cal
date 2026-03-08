# Refactoring UI Restyle & Security Fixes

*2026-03-08T20:32:08Z by Showboat 0.6.1*
<!-- showboat-id: 15b4d702-cddb-4096-b5ab-1d5e25856a11 -->

This demo verifies the security fixes and Refactoring UI restyle. All 10 security findings have been addressed in main.go, and the frontend CSS has been rebuilt with a design-system approach.

```bash
cd beta && go build -o cal-beta . && echo 'Go build: OK'
```

```output
Go build: OK
```

```bash
cd beta && node static/optimizer_test.js 2>&1 | tail -3
```

```output
========================================
Results: 47 passed, 0 failed, 0 skipped

```

### Security fixes applied (main.go)

1. **http.FileServer** replaces manual path-based file serving
2. **Content-Type enforcement** — POST/PUT/PATCH endpoints reject non-JSON requests (CSRF mitigation)
3. **bcrypt 72-byte limit** — passwords > 72 chars rejected before hashing
6. **Rate limiting** — per-IP sliding window (10 req/min on auth endpoints)
7. **Security headers middleware** — X-Content-Type-Options, X-Frame-Options, Referrer-Policy
8. **Username enumeration prevention** — signup returns success even on duplicate username
9. **Typed sqlite3 errors** — uses errors.As with sqlite3.Error for precise error handling
10. **Middleware chain** — securityHeaders → maxBodySize → mux
11. **Body size limit** — 1 MB max on POST/PUT/PATCH
12. **Session reaper** — goroutine cleans expired sessions every 15 minutes

### Refactoring UI restyle (index.html)

- **Font**: DM Sans → Inter (better screen rendering, tighter metrics)
- **Color system**: HSL-based CSS custom properties (--gray-50 through --gray-900, --blue-*, --red-*, --green-*)
- **Elevation**: Border-based cards → box-shadow system (--shadow-sm, --shadow-md, --shadow-lg)
- **Spacing**: Constrained to 4/8/12/16/20/24/32px scale
- **Focus states**: Blue ring (box-shadow + border-color) for accessibility
- **Typography**: Tighter hierarchy — 11/12/13/14/20px with weight 400-700
- **Trip colors**: Increased vibrancy for better contrast on calendar cells

```bash
cd beta && grep -c 'var(' static/index.html && echo 'CSS custom properties used throughout'
```

```output
58
CSS custom properties used throughout
```

```bash
cd beta && grep -c 'box-shadow' static/index.html && echo 'shadow-based elevation instances'
```

```output
9
shadow-based elevation instances
```

```bash
cd beta && grep -cE 'securityHeaders|maxBodySize|authLimiter|reapExpired|requireJSON|MaxBytesReader' main.go && echo 'security-related function references in main.go'
```

```output
14
security-related function references in main.go
```
