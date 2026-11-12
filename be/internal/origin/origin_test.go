package origin

import "testing"

func TestOriginAllowed(t *testing.T) {
	allowed := Normalize([]string{` "https://Stooges.vercel.app/" `, "https://*.vercel.app", "http://localhost:5173", ""})

	cases := map[string]bool{
		"":                                    true, // non-browser clients
		"https://stooges.vercel.app":          true, // quotes, slash, case normalised
		"https://stooges-git-main.vercel.app": true, // preview deploy via wildcard
		"http://localhost:5173":               true,
		"http://localhost:3000":               false,
		"https://evil.example":                false,
		"https://vercel.app.evil.example":     false,
		"http://stooges.vercel.app":           false, // wrong scheme
	}
	for origin, want := range cases {
		if got := Allowed(allowed, origin); got != want {
			t.Errorf("Allowed(%q) = %v, want %v", origin, got, want)
		}
	}
	if !Allowed(nil, "https://anything.example") {
		t.Error("an empty allow-list should allow any origin")
	}
}
