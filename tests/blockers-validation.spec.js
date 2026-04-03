const { test, expect } = require('playwright/test');

const DEFAULT_BLOCKER_SCENARIO_STATE = {
  version: 1,
  activeScenarioId: 'default',
  scenarios: [{
    id: 'default',
    name: 'Default',
    calendars: {
      visible: true,
      filterInitialized: false,
      visibleCalendarIds: [],
      activeEventIds: [],
    },
    resources: {
      teamIds: [],
      memberIds: [],
    },
  }],
};

async function waitForApp(page) {
  await page.goto('http://127.0.0.1:5173');
  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('.gantt-view')).toBeVisible();
}

async function openBlockers(page) {
  await page.getByRole('button', { name: /Default:/ }).click();
  await expect(page.locator('.blocker-filter-menu')).toBeVisible();
}

async function closeBlockers(page) {
  const closeButton = page.locator('.blocker-filter-menu .assignment-picker-close');
  if (await closeButton.isVisible()) {
    await closeButton.click();
  }
  await expect(page.locator('.blocker-filter-menu')).toHaveCount(0);
}

function blockerMenu(page) {
  return page.locator('.blocker-filter-menu');
}

function checkboxByLabel(scope, label) {
  return scope.locator(`label:has-text("${label}")`).first().locator('input[type="checkbox"]');
}

test.describe('Blocker and resource planning validation', () => {
  test.beforeEach(async ({ request }) => {
    await request.put('http://127.0.0.1:3001/api/state', {
      data: {
        blockerScenarioState: DEFAULT_BLOCKER_SCENARIO_STATE,
      },
    });
  });

  test('calendar activation persists across visibility toggles and refresh', async ({ page }) => {
    await waitForApp(page);

    const chips = page.locator('.calendar-timeline-chip');
    await expect(chips.first()).toBeVisible();

    await openBlockers(page);
    const menu = blockerMenu(page);
    const singleCalendar = checkboxByLabel(menu, 'Regatta Schedule');
    await expect(singleCalendar).toBeChecked();
    await closeBlockers(page);

    await chips.first().dblclick();
    await expect(page.locator('.cal-event-overlay')).toHaveCount(1);

    await openBlockers(page);
    await singleCalendar.uncheck();
    await closeBlockers(page);
    await expect(page.locator('.cal-event-overlay')).toHaveCount(0);

    await chips.first().dblclick();
    await expect(page.locator('.calendar-notice-banner')).toContainText('Enable this calendar in Blockers');
    await expect(page.locator('.cal-event-overlay')).toHaveCount(0);

    await openBlockers(page);
    await singleCalendar.check();
    await closeBlockers(page);
    await expect(page.locator('.cal-event-overlay')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.cal-event-overlay')).toHaveCount(1);

    await openBlockers(page);
    await expect(checkboxByLabel(blockerMenu(page), 'Regatta Schedule')).toBeChecked();
  });

  test('team and member blocker selections render assigned task overlays', async ({ page }) => {
    await waitForApp(page);

    await openBlockers(page);
    const menu = blockerMenu(page);
    const aeroTeam = checkboxByLabel(menu, 'Aerodynamics');
    const peterMember = checkboxByLabel(menu, 'Peter');

    await aeroTeam.check();
    await closeBlockers(page);
    await expect(page.locator('.resource-blocker-strip')).toHaveCount(8);

    await openBlockers(page);
    await peterMember.check();
    await closeBlockers(page);
    await expect(page.locator('.resource-blocker-strip')).toHaveCount(11);

    await openBlockers(page);
    await checkboxByLabel(blockerMenu(page), 'Aerodynamics').uncheck();
    await checkboxByLabel(blockerMenu(page), 'Peter').uncheck();
    await closeBlockers(page);
    await expect(page.locator('.resource-blocker-strip')).toHaveCount(0);
  });

  test('assignment picker stays usable from context menu', async ({ page }) => {
    await waitForApp(page);

    const row = page.locator('.gantt-row.gantt-task-row').filter({ hasText: 'Execute tunnel campaign' }).first();
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    const assignMenuItem = page.locator('.context-menu .context-menu-item').filter({ hasText: 'Assign to' }).first();
    await expect(assignMenuItem).toBeVisible();
    await assignMenuItem.click();
    await expect(page.locator('.assignment-picker--popover')).toBeVisible();
    await expect(page.locator('.assignment-option')).toHaveCount(4);
    await expect(page.locator('.assignment-option').filter({ hasText: 'Peter' })).toBeVisible();
  });
});
