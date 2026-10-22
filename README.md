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
- **Team.** Owners add teammates as Owner or Staff. The app creates a one-time password, and the new person chooses their own password the first time they sign in. Owners can also change someone's role, reset their password, or deactivate their account. A deactivated person's name stays on their old tasks and comments, but they can't sign in. The board always keeps at least one active owner.

## Deploy (Vercel + Neon)

1. In Vercel, choose **Add New → Project** and import this repository again. This creates a separate Vercel project for the board.
2. Under **Root Directory**, choose `gc-tasks`.
3. Under **Environment Variables**, add these two:
   - `AUTH_SECRET`: any random string of 32 or more characters.
   - `AUTH_TRUST_HOST`: `true`
   - For device push notifications, also add a VAPID pair: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` contact URI). The in-app bell works without them.
4. Deploy. This first build fails because there is no database yet. That's expected. Next, open the project's **Storage** tab, choose **Create Database → Neon**, and connect it to the project. Leave the environment variable prefix empty. This sets `DATABASE_URL`, the pooled connection the app uses, and `DATABASE_URL_UNPOOLED`, the direct connection the build uses for migrations. (Migrations through the pooler leave a lock behind that can fail a later build; without `DATABASE_URL_UNPOOLED`, as locally and in CI, the build migrates over `DATABASE_URL`.) Then use **Deployments → ⋯ → Redeploy**. Each build applies the database migrations automatically.
5. Open the site. The first visit goes to **/setup**, where you create the first account, which is an owner. That page only works while there are no accounts. After that, add everyone else from the **Team** page.

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
- Card order uses fractional positions. A dropped card takes the midpoint between its two neighbours, so other cards don't need to be renumbered.
- Edits to a task's content are checked against the task's version number. Moving a card doesn't change the version, so dragging a card never cancels someone else's edit in progress.
