import { expect, test, type Page } from "@playwright/test";

/*
  The one journey the board exists for: sign in, add a task, drag it to In
  progress (which assigns you), then to Done — and see that it stuck after a
  reload, i.e. it was saved and not just moved on screen.

  Needs E2E_EMAIL / E2E_PASSWORD for an existing, active account that does not
  have to change its password.
*/

const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.skip(!EMAIL || !PASSWORD, "E2E_EMAIL and E2E_PASSWORD are not set");

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

function column(page: Page, name: RegExp) {
  return page.getByRole("region", { name });
}

/**
  dnd-kit listens for pointer events and only starts a drag after the pointer
  has travelled a few pixels, so the drag is walked in steps rather than
  teleported — a single jump never activates the sensor.
*/
async function dragTo(page: Page, from: ReturnType<Page["locator"]>, to: ReturnType<Page["locator"]>) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("nothing to drag");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 16 });
  await page.mouse.up();
}

test("add a task and drag it across the board", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  const title = `E2E chai order ${Date.now()}`;
  await page.getByRole("button", { name: /new task/i }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/title/i).fill(title);
  await dialog.getByRole("button", { name: /add task|create/i }).click();
  await expect(dialog).toBeHidden();

  const todo = column(page, /to do/i);
  const inProgress = column(page, /in progress/i);
  const done = column(page, /done/i);

  const card = () => page.getByRole("button", { name: new RegExp(title) }).first();
  await expect(todo.getByText(title)).toBeVisible();

  await dragTo(page, card(), inProgress);
  await expect(inProgress.getByText(title)).toBeVisible();
  // Dragging an unassigned task into In progress assigns whoever moved it.
  await expect(page.getByText("Assigned to you")).toBeVisible();

  await dragTo(page, card(), done);
  await expect(done.getByText(title)).toBeVisible();

  await page.reload();
  await expect(column(page, /done/i).getByText(title)).toBeVisible();
});
