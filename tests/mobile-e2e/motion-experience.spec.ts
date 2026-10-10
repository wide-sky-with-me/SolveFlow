import { expect, test, type Page } from '@playwright/test';
import { chooseSyntheticPhoto } from './local-fixture.js';

async function modalMotion(page: Page) {
  return page.getByRole('dialog').evaluate(node => {
    const animations: string[] = [];
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.animationName !== 'none') animations.push(style.animationName);
    }
    return animations;
  });
}

test('reduced motion removes modal transitions and repeated closing restores navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '拍照', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect.soft(await modalMotion(page)).toEqual([]);
    await page.getByRole('button', { name: '关闭相机', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await chooseSyntheticPhoto(page); await page.getByRole('button', { name: '裁切题图', exact: true }).click();
  expect.soft(await modalMotion(page)).toEqual([]);
  await page.getByRole('button', { name: '取消裁切', exact: true }).click();
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  expect.soft(await modalMotion(page)).toEqual([]);
});

test('history search keeps its content while collapsing and rapid reopening restores focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/');
  await page.getByRole('tab', { name: '历史题目', exact: true }).click();
  await page.getByRole('button', { name: '搜索历史题目', exact: true }).click();
  const input = page.getByRole('textbox', { name: '搜索关键词', exact: true });
  await expect(input).toBeFocused();
  const closing = await page.getByRole('button', { name: '收起搜索', exact: true }).evaluate(async node => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索关键词"]')!;
    const frame = input.parentElement!.parentElement!;
    (node as HTMLElement).click();
    await new Promise(requestAnimationFrame);
    return { height: frame.getBoundingClientRect().height, retained: frame.contains(input), disabled: input.disabled || input.readOnly };
  });
  expect(closing.height).toBeGreaterThan(0);
  expect(closing.retained).toBe(true);
  expect(closing.disabled).toBe(true);
  await page.getByRole('button', { name: '搜索历史题目', exact: true }).click();
  await expect(input).toBeFocused();
  await input.fill('连续切换'); await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: '搜索历史题目', exact: true })).toBeFocused();
});

test('normal modal motion remains enabled and switching preference leaves no blocking overlay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/');
  await expect(page.getByTestId('launch-screen')).toBeHidden();
  await page.getByRole('button', { name: '拍照', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await modalMotion(page)).not.toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => modalMotion(page)).toEqual([]);
  await page.getByRole('button', { name: '关闭相机', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: '我的', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
});
