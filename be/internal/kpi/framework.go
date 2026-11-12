package kpi

// The KPI framework: each engineering level has its own weighted items, and
// a person's chat evidence is sorted into the items of their level.
//
// This is a fictional sample framework for the demo. Its shape (levels,
// seven weighted items each) follows a typical engineering ladder; replace
// the items and weights here with your own.

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// FrameworkName is shown on the dashboard.
const FrameworkName = "Orbit Engineering KPI (sample)"

// Level IDs.
const (
	LevelEngineer = "se"  // Software Engineer
	LevelSenior   = "sse" // Senior Software Engineer
)

// LevelInfo is one level of the framework.
type LevelInfo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Levels lists the framework's levels, junior first.
var Levels = []LevelInfo{
	{LevelEngineer, "Software Engineer (C3)"},
	{LevelSenior, "Senior Software Engineer (C2)"},
}

// PillarInfo is one KPI item. (Items were once called pillars; the name
// stays in the report format and the code.)
type PillarInfo struct {
	ID          Pillar `json:"id"`
	Level       string `json:"level"`
	Name        string `json:"name"`
	Weight      int    `json:"weight"` // percent of the level's KPI
	KPI         string `json:"kpi"`
	Description string `json:"description"` // what counts as evidence
}

// Pillars is every item of every level, in display order (by level, then by
// weight). Each level's weights add up to 100.
var Pillars = []PillarInfo{
	// Software Engineer (C3)
	{"se_delivery", LevelEngineer, "Technical Delivery", 30,
		"Ships dependable, well-tested features and owns their modules from start to finish.",
		"Features land with solid unit and integration tests, review comments get resolved, releases cause few follow-up bugs, and the work is written up in PRs, tickets, or short design notes. Tracked through defect rates and the business value of what shipped."},
	{"se_problem_solving", LevelEngineer, "Problem Solving", 25,
		"Turns vague problems into concrete steps with the trade-offs spelled out.",
		"Splits fuzzy tasks into smaller deliverables, suggests designs that will hold up as usage grows, explains the reasoning in a spike or design note, and delivers changes that make systems faster or more reliable, such as caching, retries, or rate limits."},
	{"se_improvement", LevelEngineer, "Continuous Improvement", 15,
		"Notices what slows the team down and fixes it without being asked.",
		"Spots wasted effort, smooths the developer workflow, suggests better ways of working, and improves monitoring or reliability. Can point to the result, such as a shorter setup time or an automated check, backed by docs, pipeline changes, or how widely it was adopted."},
	{"se_accountability", LevelEngineer, "Accountability", 10,
		"Follows through on commitments and is upfront when plans change.",
		"Meets sprint commitments, keeps scope in check, raises risks before they become surprises, and agrees new plans with the people affected. Shown by steady sprint delivery and few escalations."},
	{"se_collaboration", LevelEngineer, "Collaboration", 8,
		"Works with others to move the team forward and unblock peers.",
		"Joins design and planning discussions, gives useful review feedback, pairs with teammates who are stuck, and helps improve shared tools and habits. Visible in retros, pairing and mentoring sessions, and process changes the team adopts."},
	{"se_communication", LevelEngineer, "Communication", 7,
		"Keeps people informed clearly and honestly.",
		"Flags risks early, gives plain and honest status updates, speaks up in retros, escalates blockers with enough context to act on, and gives constructive feedback in code and design reviews."},
	{"se_mentorship", LevelEngineer, "Leadership & Mentorship", 5,
		"Sets a good example and helps others grow by sharing what they know.",
		"Helps newer teammates, writes onboarding or how-to notes, runs short knowledge sessions, and gives thoughtful code reviews. Tracked by how much the material is used, what peers say, and how quickly new joiners get up to speed."},

	// Senior Software Engineer (C2)
	{"sse_ownership", LevelSenior, "Technical Ownership & Delivery", 30,
		"Leads large, cross-team systems to a reliable, scalable, maintainable finish.",
		"Drives the design, rollout, and iteration of large systems, writes the specs, lines up the teams involved, and ships with few regressions. Tracked through defect rates, uptime, adoption of reworked systems, and measurable business or infrastructure impact."},
	{"sse_problem_solving", LevelSenior, "Strategic Problem Solving", 25,
		"Takes on the hardest, most open-ended problems and solves them for the long run.",
		"Breaks down unclear issues, gets to root causes, proposes well-structured fixes, heads off technical debt, and steadies systems nobody owns. Shown by fewer repeat incidents, performance gains, and risks dealt with before they hit."},
	{"sse_direction", LevelSenior, "Technical Direction & Influence", 15,
		"Shapes how several teams build, through architecture and shared practices.",
		"Leads design proposals and architecture reviews, gets tools or patterns adopted beyond their own team, guides infrastructure and performance choices, and steers engineering standards. Evidence includes proposals adopted, migrations completed across teams, and alignment in planning docs."},
	{"sse_standards", LevelSenior, "Continuous Improvement & Standards", 10,
		"Raises the bar for quality, reliability, and speed across teams.",
		"Introduces review checklists, pipeline improvements, observability tooling, or better processes, and shows the effect, such as less time spent debugging, quicker releases, or faster incident recovery. Backed by playbooks, dashboards, and practices other teams pick up."},
	{"sse_alignment", LevelSenior, "Cross-Functional Alignment", 8,
		"Builds trust between product, design, operations, and engineering to hit business goals.",
		"Helps product, design, operations, and engineering reach decisions that balance delivery speed with reliability, negotiates scope trade-offs, writes down what was agreed, and keeps stakeholders' trust. Seen in shared decision docs, retro outcomes, and agreed launch scope."},
	{"sse_mentorship", LevelSenior, "Mentorship & Team Multiplication", 7,
		"Grows other engineers so the whole team gets stronger.",
		"Mentors juniors and peers, gives structured feedback, writes growth or onboarding guides, and leads knowledge-sharing sessions. Tracked by peer feedback, faster onboarding, and mentees growing into bigger roles."},
	{"sse_change", LevelSenior, "Championing Change", 5,
		"Starts and carries through improvements that spread beyond their own team.",
		"Proposes, trials, and rolls out new practices or tools, wins people over by showing results rather than by pushing, and gets them adopted by other squads. Measured by adoption across teams and lasting changes in how people work."},
}

// ItemsFor returns the items of one level, in display order.
func ItemsFor(level string) []PillarInfo {
	var out []PillarInfo
	for _, p := range Pillars {
		if p.Level == level {
			out = append(out, p)
		}
	}
	return out
}

// ItemInfo looks an item up by ID.
func ItemInfo(id Pillar) (PillarInfo, bool) {
	for _, p := range Pillars {
		if p.ID == id {
			return p, true
		}
	}
	return PillarInfo{}, false
}

// ValidPillar reports whether p is an item of the framework.
func ValidPillar(p Pillar) bool {
	_, ok := ItemInfo(p)
	return ok
}

func validLevel(level string) bool {
	for _, l := range Levels {
		if l.ID == level {
			return true
		}
	}
	return false
}

// itemIDs lists every item ID, for the models' JSON schemas.
func itemIDs() []string {
	ids := make([]string, len(Pillars))
	for i, p := range Pillars {
		ids[i] = string(p.ID)
	}
	return ids
}

// Team says which level each person is at. Names are display names; anyone
// not listed is at Default.
type Team struct {
	Default string            `json:"default_level"`
	People  map[string]string `json:"people"`
}

// LevelOf returns a person's level.
func (t Team) LevelOf(name string) string {
	if l, ok := t.People[name]; ok {
		return l
	}
	if t.Default != "" {
		return t.Default
	}
	return LevelEngineer
}

// LoadTeam reads a team file. A missing file puts everyone at the default
// level (Software Engineer).
func LoadTeam(path string) (Team, error) {
	t := Team{Default: LevelEngineer}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return t, nil
	}
	if err != nil {
		return t, err
	}
	if err := json.Unmarshal(raw, &t); err != nil {
		return t, fmt.Errorf("parse %s: %w", path, err)
	}
	if t.Default == "" {
		t.Default = LevelEngineer
	}
	var bad []string
	for name, l := range t.People {
		if !validLevel(l) {
			bad = append(bad, fmt.Sprintf("%s: %q", name, l))
		}
	}
	if !validLevel(t.Default) {
		bad = append(bad, fmt.Sprintf("default_level: %q", t.Default))
	}
	if len(bad) > 0 {
		sort.Strings(bad)
		return t, fmt.Errorf("%s: unknown level (use %q or %q) for %s", path, LevelEngineer, LevelSenior, strings.Join(bad, ", "))
	}
	return t, nil
}

// AssignLevels records each participant's level on every unit.
func AssignLevels(units []Unit, team Team) {
	for i := range units {
		u := &units[i]
		u.Levels = map[string]string{}
		for _, m := range u.Messages {
			if !m.Excluded {
				u.Levels[m.Author] = team.LevelOf(m.Author)
			}
		}
	}
}
