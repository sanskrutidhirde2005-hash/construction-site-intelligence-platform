import { expect } from '@playwright/test';

/** Page Object for the BuildSafe app shell: login gate + sidebar navigation. */
export class AppShell {
  constructor(page) {
    this.page = page;
    this.sidebar = page.locator('aside.sidebar');
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async demoLogin() {
    await this.goto();
    await this.page.getByRole('button', { name: /explore demo/i }).click();
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  }

  async loginAs({ email, password, role }) {
    await this.goto();
    await this.page.getByPlaceholder('Enter your email').fill(email);
    await this.page.getByPlaceholder('Enter your password').fill(password);
    if (role) {
      await this.page.getByRole('combobox').selectOption(role);
    }
    await this.page.getByRole('button', { name: /^sign in/i }).click();
    await expect(this.page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  }

  async navigate(label) {
    // Exact match: 'Projects' is a substring of 'Past Projects & Maintenance'.
    await this.sidebar.getByRole('button', { name: label, exact: true }).click();
  }

  async logout() {
    await this.sidebar.getByRole('button', { name: /logout/i }).click();
    await expect(this.page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  }
}
