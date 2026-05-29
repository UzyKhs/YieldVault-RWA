/**
 * Flow: Deposit journey (manual wallet connect)
 *
 * Covers: wallet connect → deposit → success toast/state
 * Uses deterministic API stubs so the test is stable in CI.
 */
import {
  test,
  expect,
  interceptApiRoutes,
  stubFreighterManualConnect,
} from './fixtures';

const MOCK_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SHORT_ADDR = `${MOCK_ADDRESS.substring(0, 5)}...${MOCK_ADDRESS.substring(MOCK_ADDRESS.length - 4)}`;

test.describe('Deposit flow (e2e)', () => {
  test.beforeEach(async ({ page }) => {
    await interceptApiRoutes(page);
    await stubFreighterManualConnect(page, MOCK_ADDRESS);
  });

  test('connects wallet and deposits USDC successfully', async ({ page }) => {
    await page.goto('/');

    // Starts disconnected
    await expect(page.getByText('Wallet Not Connected')).toBeVisible();

    // Connect via the real UI button (drives setAllowed -> isAllowed -> getAddress)
    await page.getByRole('button', { name: /Connect Freighter/i }).click();
    await expect(page.getByText(SHORT_ADDR)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Wallet Not Connected')).not.toBeVisible();

    // Deposit
    const amountInput = page.getByPlaceholder('0.00');
    const submitBtn = page.getByRole('button', { name: /Approve & Deposit/i });

    await amountInput.fill('100');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByRole('button', { name: /Processing Transaction/i })).toBeVisible();

    // Success state (toast + updated balance)
    await expect(page.getByText('Deposit Successful')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('1350.50')).toBeVisible({ timeout: 5000 });

    // Form resets after success
    await expect(amountInput).toHaveValue('');
    await expect(submitBtn).toBeDisabled();
  });
});

