const { test, expect } = require('playwright/test');
const exampleTasks = require('../data/workspaces/example/tasks.json');
const examplePersonnel = require('../data/workspaces/example/personnel.json');

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

async function resetWorkspace(page) {
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async ({ tasks, personnel, state }) => {
    await fetch('/api/tasks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tasks),
    });
    await fetch('/api/personnel', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(personnel),
    });
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  }, {
    tasks: exampleTasks,
    personnel: examplePersonnel,
    state: { blockerScenarioState: DEFAULT_BLOCKER_SCENARIO_STATE },
  });
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
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test.skip('calendar activation persists across visibility toggles and refresh', async ({ page }) => {
    await waitForApp(page);

    const chips = page.locator('.calendar-timeline-chip');
    await expect(chips.first()).toBeVisible({ timeout: 15000 });

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
    const blockerStrips = page.locator('.resource-blocker-strip');
    await expect(blockerStrips).toHaveCount(8);
    const countWithTeam = await blockerStrips.count();

    await openBlockers(page);
    await peterMember.check();
    await closeBlockers(page);
    await expect.poll(async () => blockerStrips.count()).toBeGreaterThan(countWithTeam);

    await openBlockers(page);
    await checkboxByLabel(blockerMenu(page), 'Aerodynamics').uncheck();
    await checkboxByLabel(blockerMenu(page), 'Peter').uncheck();
    await closeBlockers(page);
    await expect(blockerStrips).toHaveCount(0);
  });

  test('assignment picker stays usable from context menu', async ({ page }) => {
    await waitForApp(page);

    const row = page.locator('.gantt-row.gantt-task-row').filter({ hasText: 'Execute tunnel campaign' }).first();
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    const assignMenuItem = page.locator('.context-menu .context-menu-item').filter({ hasText: 'Assign to' }).first();
    await expect(assignMenuItem).toBeVisible();
    await assignMenuItem.click();
    const popoverOptions = page.locator('.assignment-picker--popover .assignment-option');
    await expect(page.locator('.assignment-picker--popover')).toBeVisible();
    await expect(popoverOptions.first()).toBeVisible();
    await expect(popoverOptions.filter({ hasText: 'Clear assignment' })).toBeVisible();
    await expect(popoverOptions.filter({ hasText: 'Peter' })).toBeVisible();
    await expect(popoverOptions.filter({ hasText: 'Coach Boat 1' })).toBeVisible();
  });

  test('asset management modal supports custom types, groups, assignment, and blockers', async ({ page }) => {
    await waitForApp(page);

    await page.getByRole('button', { name: 'Manage Assets' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Flexible Planning Model')).toBeVisible();

    await page.getByRole('button', { name: 'Add Asset Type' }).click();
    const typeCard = page.locator('.personnel-type-card').last();
    await typeCard.getByPlaceholder('Asset type name').fill('Vehicles');
    await typeCard.getByRole('button', { name: 'Customize Wording' }).click();
    await typeCard.locator('.personnel-inline-field').nth(0).locator('input').fill('Pool');
    await typeCard.locator('.personnel-inline-field').nth(1).locator('input').fill('Pools');
    await typeCard.locator('.personnel-inline-field').nth(2).locator('input').fill('Van');
    await typeCard.locator('.personnel-inline-field').nth(3).locator('input').fill('Vans');

    await page.getByRole('button', { name: 'Groups', exact: true }).click();
    await page.getByRole('button', { name: 'Add Group' }).click();
    const groupCard = page.locator('.personnel-column .personnel-card').last();
    await groupCard.getByPlaceholder('Group name').fill('Support Vans');
    await groupCard.locator('select').selectOption({ label: 'Vehicles' });

    await page.getByRole('button', { name: 'Assets', exact: true }).click();
    await page.getByRole('button', { name: 'Add Asset' }).click();
    const assetCard = page.locator('.personnel-column .personnel-card').last();
    await assetCard.getByPlaceholder('Asset name').fill('Van 1');
    await assetCard.locator('select').selectOption({ label: 'Vehicles' });
    await assetCard.locator('.personnel-team-check').filter({ hasText: 'Support Vans' }).locator('input').first().check();

    await page.getByRole('button', { name: 'Save Assets' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const row = page.locator('.gantt-row.gantt-task-row').filter({ hasText: 'Execute tunnel campaign' }).first();
    await row.click({ button: 'right' });
    await page.locator('.context-menu .context-menu-item').filter({ hasText: 'Assign to' }).first().click();
    await page.locator('.assignment-option').filter({ hasText: 'Van 1' }).first().evaluate((element) => element.click());
    await page.locator('.assignment-option').filter({ hasText: 'Coach Boat 1' }).first().evaluate((element) => element.click());
    await page.locator('.assignment-picker--popover .assignment-picker-close').click();
    await expect.poll(async () => page.evaluate(async () => {
      const response = await fetch('/api/tasks');
      const data = await response.json();
      const stack = [...(data.items || [])];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node.id === 'task-tunnel-campaign') {
          return (node.assigneeIds || []).length;
        }
        if (node.children?.length) stack.push(...node.children);
      }
      return 0;
    })).toBeGreaterThan(1);

    await openBlockers(page);
    const menu = blockerMenu(page);
    await expect(menu.getByText('Vehicles')).toBeVisible();
    await checkboxByLabel(menu, 'Van 1').check();
    await checkboxByLabel(menu, 'Coach Boat 1').check();
    await closeBlockers(page);
    const strips = page.locator('.resource-blocker-strip');
    await expect.poll(async () => strips.count()).toBeGreaterThan(1);
    const titles = await strips.evaluateAll((els) => els.map((el) => el.getAttribute('title')));
    expect(titles.some((title) => title?.includes('Van 1'))).toBeTruthy();
    expect(titles.some((title) => title?.includes('Coach Boat 1'))).toBeTruthy();
  });

  test('task editor blocker toggle persists and drives fleet overlays', async ({ page }) => {
    await waitForApp(page);

    const row = page.locator('.gantt-row.gantt-task-row').filter({ hasText: 'Downselect robust design candidate' }).first();
    await expect(row).toBeVisible();
    await row.dblclick();
    await expect(page.locator('.modal')).toBeVisible();

    const blockerToggle = page.locator('#task-blocker');
    await blockerToggle.check();
    await page.locator('.modal-footer .btn.btn-primary').click();
    await expect(page.locator('.modal')).toHaveCount(0);

    await openBlockers(page);
    await checkboxByLabel(blockerMenu(page), 'RIB Fleet').check();
    await closeBlockers(page);

    const blockerTitles = await page.locator('.resource-blocker-strip').evaluateAll((els) => els.map((el) => el.getAttribute('title')));
    expect(blockerTitles.some((title) => title?.includes('Coach Boat 1') && title.includes('Downselect robust design candidate'))).toBeTruthy();
    expect(blockerTitles.some((title) => title?.includes('Coach Boat 2') && title.includes('Downselect robust design candidate'))).toBeTruthy();
  });

  test('task duration label falls to 0d when blocker coverage removes all realistic time', async ({ page }) => {
    await page.goto('http://127.0.0.1:5173');
    await page.evaluate(async ({ typeId }) => {
      await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            id: 'group-ops',
            type: 'group',
            name: 'Operations',
            color: '#27AE60',
            start: '2026-04-01',
            end: '2026-04-08',
            children: [
              {
                id: 'task-vacation',
                type: 'task',
                name: 'Jonas vacation blocker',
                start: '2026-04-03',
                end: '2026-04-05',
                blocker: true,
                assigneeIds: ['member-jonas'],
              },
              {
                id: 'task-service-trip',
                type: 'task',
                name: 'Service trip candidate',
                start: '2026-04-03',
                end: '2026-04-05',
                assigneeIds: ['member-jonas'],
              },
            ],
          }],
        }),
      });

      await fetch('/api/personnel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          types: [{
            id: typeId,
            name: 'Personnel',
            comment: 'Use for teams and people.',
            color: '#D95F5F',
            groupLabel: 'Team',
            groupLabelPlural: 'Teams',
            assetLabel: 'Person',
            assetLabelPlural: 'People',
          }],
          teams: [{
            id: 'team-techs',
            name: 'Service Technicians',
            typeId,
          }],
          members: [{
            id: 'member-jonas',
            name: 'Jonas Richter',
            typeId,
            teamIds: ['team-techs'],
          }],
        }),
      });

      await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zoom: 'Month',
          density: 'Compact',
          blockerScenarioState: {
            version: 1,
            activeScenarioId: 'default',
            scenarios: [{
              id: 'default',
              name: 'Default',
              calendars: {
                visible: false,
                filterInitialized: true,
                visibleCalendarIds: [],
                activeEventIds: [],
              },
              resources: {
                teamIds: [],
                memberIds: ['member-jonas'],
              },
            }],
          },
        }),
      });
    }, { typeId: examplePersonnel.types[0].id });

    await page.reload();
    await expect(page.locator('.app')).toBeVisible();

    const blockerLabel = page.locator('.gantt-bar-outside-label').filter({ hasText: 'Jonas vacation blocker' }).first();
    const taskLabel = page.locator('.gantt-bar-outside-label').filter({ hasText: 'Service trip candidate' }).first();

    await expect(blockerLabel).toContainText('(3d 1d 0d)');
    await expect(taskLabel).toContainText('(3d 1d 0d)');
  });
});
