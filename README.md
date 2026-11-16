# Road to SDE-2

A 60-day, 3-hours-a-day study plan from SDE-1 to SDE-2 offers, with a built-in progress tracker.

- **DSA:** NeetCode 150 in C++, 3 problems a day. Each links to LeetCode and to the NeetCode video for that problem.
- **Design:** LLD in Java → system design → revising your own resume (Kafka, Elasticsearch, ECS, MSK, DocumentDB, CDK, CloudWatch, DR/SRE) → behavioural → mocks.
- **Tracker:** tick tasks, star problems to re-solve, and see your streak and whether you're on schedule. Progress is saved in the browser and, once you sign in, in Supabase so it syncs across devices.

It's a plain static site with no build step: HTML, CSS and JavaScript only.

## Files

| File | What it is |
|---|---|
| `index.html` | The page skeleton. Loads everything else. |
| `styles.css` | All styling, light and dark mode. |
| `app.js` | Schedule logic, saving (browser + Supabase), sign-in, and drawing the page. |
| `data/plan.js` | **The plan content**: 60 design/revision sessions, career tasks, late-phase DSA tasks, links. Edit this to change the plan. |
| `data/nc.js` | The NeetCode 150 list, generated from NeetCode's own data. |
| `config.js` | Your Supabase URL and anon key (empty until you fill them in). |
| `supabase/migrations/001_progress.sql` | Creates the `progress` table and its security rules. |

## Run it on your laptop

```bash
cd ~/Documents/road-to-sde2
python3 -m http.server 8765
```
Then open http://localhost:8765. Stop it with `Ctrl+C`.
(Opening `index.html` by double-clicking also works, but sign-in only works from `http://` addresses.)

## Connect Supabase (one-time, about 10 minutes)

1. **Create the table.** In Supabase → *SQL Editor*, paste in the whole of `supabase/migrations/001_progress.sql` and click *Run*.
   This makes a `progress` table with row-level security on, so each signed-in user can only read and write their own row.
2. **Turn on email sign-in.** Supabase → *Authentication* → *Sign In / Providers* → make sure **Email** is enabled.
3. **Allow your site's address.** Supabase → *Authentication* → *URL Configuration*:
   - *Site URL*: where the site lives, e.g. `https://<your-github-username>.github.io/<repo-name>/`
   - *Redirect URLs*: add that same URL, plus `http://localhost:8765/` for local testing.
   The sign-in email link only works for addresses on this list.
4. **Add your keys.** Supabase → *Project Settings* → *API*. Copy the *Project URL* and the *anon public* key into `config.js`.
   - The anon key is designed to be public: the security rules from step 1 protect your data.
   - **Never** put the `service_role` key in this repo.
5. Reload the page, go to **Today → Your progress**, enter your email, and click the link in the email. You should see "Synced to your account".

**How syncing works:** each tick saves to the browser at once and to Supabase about half a second later. The first time you sign in on a browser, anything you ticked before signing in is merged into your account, so nothing is lost.

## Put it online (GitHub Pages, free)

1. Push this repo to GitHub.
2. On GitHub: *Settings* → *Pages* → *Source: Deploy from a branch* → branch `main`, folder `/ (root)` → *Save*.
3. After a minute or two the site is live at `https://<username>.github.io/<repo-name>/`. Use that exact address in Supabase step 3.

## Changing the plan

- To change a day's design session, edit its entry in `DESIGN` in `data/plan.js` (entry 1 = day 1). Each entry has:
  `k` (track: `lld`, `hld`, `res`, `beh`, `mock`), `t` title, `d` description, `l` links as `[label, url]`, and `q` self-check questions.
- Career tasks are in `CAREER`, keyed by day number. The DSA tasks for days 51–60 are in `DSA_LATE`.
- Ticks are stored by key (`p:<leetcode-slug>` for problems, `d<day>:design`, `d<day>:career`, `d<day>:dsa`), so editing text doesn't lose progress. Moving an item to a different day does change which day it counts towards.
