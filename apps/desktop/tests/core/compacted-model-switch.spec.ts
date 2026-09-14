import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir, seedCompactedModelSwitchSessionFixture, getDesktopState } from '../helpers/electron-app';

test('model switch uses small active context after two compactions despite 1M+ archive estimate', async () => {
  test.setTimeout(90000);
  const userDataDir = await makeUserDataDir(); const agentDir = join(userDataDir,'agent'); const workspace = await makeWorkspace('compacted-model-switch');
  await seedAgentDir(agentDir); await seedCompactedModelSwitchSessionFixture(agentDir,workspace);
  const harness = await launchDesktop(userDataDir,{agentDir,initialWorkspaces:[workspace],testMode:'background',envOverrides:{PI_GUI_BRAND:'alpi',PI_GUI_DRIVER:'rpc'}});
  try {
    const page = await harness.firstWindow();
    await expect(page.getByText('Compacted model switch fixture', { exact: true }).first()).toBeVisible();
    const badge = page.locator('.composer__bar .model-selector__badge').first();
    await badge.click();
    const dropdown=page.locator('.composer__bar .model-selector__dropdown').first();
    await expect(dropdown).toBeVisible();
    await dropdown.getByRole('button',{name:/GPT-4o/i}).click();
    await expect(badge).toHaveAttribute('title', 'openai:gpt-4o');
    expect((await getDesktopState(page)).lastError).toBeFalsy();
  } finally { await harness.close(); }
});
