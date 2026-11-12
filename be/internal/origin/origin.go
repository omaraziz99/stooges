// Package origin matches browser Origin headers against an allow-list
// (ALLOWED_ORIGINS), for the relay's WebSocket and the accounts API.
package origin

import "strings"

// Normalize trims spaces, quotes, and trailing slashes, and lowercases.
func Normalize(origins []string) []string {
	var out []string
	for _, o := range origins {
		o = strings.ToLower(strings.TrimRight(strings.Trim(strings.TrimSpace(o), `"'`), "/"))
		if o != "" {
			out = append(out, o)
		}
	}
	return out
}

// Allowed reports whether a browser origin may connect. Requests with
// no Origin (non-browser clients such as the seed tool) are always allowed.
func Allowed(allowed []string, origin string) bool {
	if len(allowed) == 0 || origin == "" {
		return true
	}
	origin = strings.ToLower(origin)
	for _, pattern := range allowed {
		if matchWildcard(pattern, origin) {
			return true
		}
	}
	return false
}

// matchWildcard matches s against pattern, where each "*" matches any run of
// characters (e.g. "https://*.vercel.app").
func matchWildcard(pattern, s string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return pattern == s
	}
	if !strings.HasPrefix(s, parts[0]) {
		return false
	}
	s = s[len(parts[0]):]
	for _, part := range parts[1 : len(parts)-1] {
		i := strings.Index(s, part)
		if i < 0 {
			return false
		}
		s = s[i+len(part):]
	}
	return strings.HasSuffix(s, parts[len(parts)-1])
}
