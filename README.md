# God's Chai Tasks

A shared task board for the God's Chai team. Everyone signs in with their own email and password. **Owners** have full access. **Staff** see the whole board but can change only the tasks they're working on.

The board has three columns: **To do → In progress → Done**. Drag a card to move it. Each card shows who is working on it, plus its labels, priority, due date, checklist progress and comment count. Click a card to open it. From there you can edit it, assign people, tick off checklist items, leave comments and see its history.

This app is separate from God's Chai Operations. It has its own database, its own logins and its own deployment. It lives in this repository only so the two apps share a home.

## Who can do what

| | Owner | Staff |
|---|---|---|
| See the whole board, open any task | ✓ | ✓ |
| Comment on any task | ✓ | ✓ |
| Edit or delete their own comments | ✓ | ✓ |
| Pick up an unclaimed task ("I'll take this") | ✓ | ✓ (only if it isn't done yet) |
| Move a task between columns | ✓ any task | only tasks they're on |
| Tick off, add and edit checklist items | ✓ any task | only tasks they're on |
| Create tasks; edit title, description, priority, due date, labels and assignees | ✓ | — |
| Archive, restore and delete tasks; delete anyone's comment | ✓ | — |
| Manage labels | ✓ | — |
| Add teammates, change roles, reset passwords, deactivate accounts | ✓ | — |
| Open and close sign-ups (who may create their own account) | ✓ | — |
| Ideas: share an idea, reply anywhere in a thread, upvote other people's posts (once each, not your own) | ✓ | ✓ |
| Ideas: edit or delete their own ideas and replies | ✓ | ✓ |
| Ideas: delete anyone's idea or reply | ✓ | — |

These rules live in one place, `src/lib/permissions.ts`. The server enforces them on every change. The browser uses the same rules to hide buttons a staff member can't use.

## Features

- **Board.** The three columns, with drag and drop. On a phone, each column is a tab: press-and-hold a card, then drag it onto another column's tab — the board switches to that column so you can drop the card exactly where it belongs, or drop it straight onto the tab to send it to the end of that column. The card's **⋯ → Move to** menu works too.
- **Who's working on it.** A task can have several assignees. If you drag an unassigned task into *In progress*, it's assigned to you. You can also use **I'll take this** to add yourself to a task.
- **Cards.** Labels (Kitchen, Marketing, …), priority, due date (red when overdue, amber when due today), checklist progress and comment count.
- **Task details.** Inline editing, assignees, labels (you can create new ones from here), priority, due date, a checklist, comments, and a history of who changed what.
- **Two people at once.** Open boards check for changes every few seconds, so a card a teammate moves shows up without reloading. If two people edit the same task at the same time, the second person is told and shown the latest version. Nobody's edit is silently overwritten.
- **Notifications.** A bell in the header shows what teammates have changed — new tasks, comments, assignments, moves, completions, and other edits — with an unread badge. After you allow notifications in the browser, the same changes can also arrive as device push notifications; tapping one opens the task. You are never notified about your own changes, and a bulk archive is sent as one summary. On iPhone, push requires opening the site after adding it to the Home Screen.
- **Filters.** My tasks, by person, by label, by priority, and search. Press `n` for a new task and `/` to search.
- **Archive.** Hide finished tasks from the board, and restore them later.
- **Ideas.** A Reddit-style page next to the board for opinions and ideas. Anyone can share an idea (a title, plus optional detail), and the team replies in nested threads — to the idea or to any reply. Upvote the good ones: one upvote each, and not on your own posts. Sort the list by **Top** (most upvoted, then newest) or **New**. Replies are ordered by upvotes, then oldest first; tap a reply's arrow or its thread line to collapse it. Deleting something that has replies leaves it in place as *[deleted]*, so the conversation under it stays readable; anything with no replies is removed outright. Ideas are separate from the board: they don't touch tasks or send board notifications.
- **Sign-up.** With email set up, new people can create their own Staff account from the sign-in page, confirmed by an emailed code. Owners can turn this off on the Team page. See [Sign-up](#sign-up).
- **Team.** Owners add teammates as Owner or Staff. The app creates a one-time password, and the new person chooses their own password the first time they sign in. Owners can also change someone's role, reset their password, or deactivate their account. A deactivated person's name stays on their old tasks and comments, but they can't sign in. The board always keeps at least one active owner.

## Deploy (Vercel + Neon)

1. In Vercel, choose **Add New → Project** and import this repository again. This creates a separate Vercel project for the board.
2. Under **Root Directory**, choose `gc-tasks`.
3. Under **Environment Variables**, add these two:
   - `AUTH_SECRET`: any random string of 32 or more characters.
   - `AUTH_TRUST_HOST`: `true`
   - For device push notifications, also add a VAPID pair: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` contact URI). The in-app bell works without them.
   - For **Forgot password?** and **sign-up** by email, also add `RESEND_API_KEY` and `EMAIL_FROM` (see [Password reset by email](#password-reset-by-email)). Without them, owners reset passwords and add people from the Team page.
4. Deploy. This first build fails because there is no database yet. That's expected. Next, open the project's **Storage** tab, choose **Create Database → Neon**, and connect it to the project. Leave the environment variable prefix empty. This sets `DATABASE_URL`, the pooled connection the app uses, and `DATABASE_URL_UNPOOLED`, the direct connection the build uses for migrations. (Migrations through the pooler leave a lock behind that can fail a later build; without `DATABASE_URL_UNPOOLED`, as locally and in CI, the build migrates over `DATABASE_URL`.) Then use **Deployments → ⋯ → Redeploy**. Each build applies the database migrations automatically.
5. Open the site. The first visit goes to **/setup**, where you create the first account, which is an owner. That page only works while there are no accounts. After that, add everyone else from the **Team** page.

## Password reset by email

With email set up, the sign-in page shows **Forgot password?**. People enter their email, get a 6-digit code (valid for 10 minutes, 5 tries, one use), and choose a new password with it. They're signed in straight away, and anyone signed in as them elsewhere is signed out. Without email set up, the link is hidden, /forgot-password doesn't exist, and the sign-in page says to ask an owner, as before.

1. Create an account at [resend.com](https://resend.com). Under **Domains**, add the domain the emails come from (for example `godschai.com`) and add the DNS records Resend shows you at your DNS provider. Wait until the domain shows as **Verified**.
2. Under **API Keys**, create a key with **Sending access** (you can limit it to that domain). Copy it; it starts with `re_`.
3. In Vercel, open **Settings → Environment Variables** and add:
   - `RESEND_API_KEY`: the key from step 2.
   - `EMAIL_FROM`: the sender, on the verified domain, for example `GC Tasks <tasks@godschai.com>`.
4. Redeploy (**Deployments → ⋯ → Redeploy**). The link appears on the sign-in page.

The form gives the same answer whether or not an email has an account, and deactivated accounts get no email. Code requests and attempts count against limits like sign-in does. If an email can't be sent, the error is in the Vercel logs (**Logs**, search for "Password reset email"); the code itself is never logged or stored, only a keyed hash of it.

`EMAIL_DEV_LOG_DIR` is for local browser tests only: when set, emails are written as JSON files to that folder instead of being sent. It's ignored on Vercel; never set it there.

## Sign-up

With email set up (the same Resend setup as [password reset](#password-reset-by-email): `RESEND_API_KEY` and `EMAIL_FROM`), the sign-in page shows **New to the team? Create an account**. Anyone with any email address can use it:

1. On **/signup** they enter their name, email and a password (twice).
2. They get a 6-digit code by email (valid for 10 minutes, 5 tries, one use) and enter it on the next page.
3. Their account is created as **Staff**, they're signed straight in, and every active owner gets a bell notification (and a push, if they've turned those on): *"Asha joined the board as Staff."* Owners can make them an owner from the Team page.

The page answers the same way whether or not an email already has an account. An email that does gets a short note by email instead of a code ("You already have one: sign in, or use Forgot password"), and nothing is created. Requests and code attempts count against limits like sign-in does. Until the code comes back there is no account, only a pending sign-up holding a bcrypt hash of the chosen password and a keyed hash of the code.

**Turning it off.** Staff can see every task on the board, so an open sign-up means anyone who finds the link can read the board. Owners switch **Allow sign-ups** on the **Team** page. It's on by default. When it's off, the link is hidden, /signup and /signup/verify don't exist, and sign-ups still waiting for their code are thrown away. If someone you don't know signs up, deactivate them from the Team page; they're signed out at once. Without email set up, sign-up is off whatever the switch says.

## Locked out?

If nobody can sign in, so nobody can reset a password from the Team page, use the recovery key:

1. In Vercel, open **Settings → Environment Variables** and add `RECOVERY_KEY`: a random string of 24 or more characters (for example the output of `openssl rand -hex 24`). Then redeploy.
2. Open **/recover** on the board, enter the key, the account's email and a new password. You're signed in, and everything on the account stays as it was. Anyone signed in as that account elsewhere is signed out.
3. Delete `RECOVERY_KEY` again and redeploy. Without it, /recover does not exist.

This is not a master password: it only sets a new password on one account. Wrong keys count against the same lockout as sign-in (5 tries, from all addresses together), and every use is logged.

## Run it locally

```bash
cd gc-tasks
cp .env.example .env          # point DATABASE_URL at a Postgres you can use
pnpm install
pnpm db:migrate
pnpm dev                      # http://localhost:3200 → /setup on first run
```

To create or reset an account from the command line, run this. Leave out `--password` to have one generated; the person will then be asked to choose their own the first time they sign in.

```bash
pnpm create-user --email you@example.com --name "Your Name" [--role owner|staff] [--password "…"] [--reset]
```

## Checks

```bash
pnpm typecheck && pnpm lint
pnpm test                     # unit tests; integration tests need a test database (below)
DATABASE_URL="postgresql://…/gctasks_test" pnpm test
pnpm build && pnpm start -p 3211 &
E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e
```

The integration tests empty every table between tests. To protect real data, they only run when `DATABASE_URL` contains `test`.

## How it's built

- Next.js 15 (App Router) with React 19 and TypeScript, Prisma 5 with Postgres, Auth.js v5 (email and password, with lockout after repeated failed sign-ins), Tailwind, and dnd-kit for drag and drop.
- `src/modules/tasks`: task logic. Every change to the board runs in a single database transaction that also increments a board revision counter. Open boards poll that counter, which is cheap, and fetch the board again only when it changes.
- `src/modules/ideas`: the Ideas page. An idea and all its replies live in one table (each reply points at its parent and at the idea it sits under, so a whole thread is one query). Upvotes are counted, not stored, with one row per person per post. Ideas writes run in their own transactions with a lock per thread, never the board's lock, so a busy thread doesn't make open boards refetch.
- Card order uses fractional positions. A dropped card takes the midpoint between its two neighbours, so other cards don't need to be renumbered.
- Edits to a task's content are checked against the task's version number. Moving a card doesn't change the version, so dragging a card never cancels someone else's edit in progress.
