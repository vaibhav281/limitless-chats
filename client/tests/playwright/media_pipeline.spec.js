import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// WhatsApp-level robust media pipeline test suite
test.describe('E2EE Media Pipeline Integrity', () => {

    const calculateHash = (filePath) => {
        const fileBuffer = fs.readFileSync(filePath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    };

    test('Upload, Render, and Download Integrity Match (SHA-256)', async ({ page }) => {
        // 1. Navigate to the chat page
        await page.goto('http://localhost:5173');

        // Simulate login / name prompt bypass
        const nameInput = page.getByPlaceholder('Enter your name');
        if (await nameInput.isVisible()) {
            await nameInput.fill('TestBot');
            await page.click('text=Start Chatting');
        }

        // Select the Global Group or a specific user
        await page.click('text=Global Group');

        // 2. Prepare mock test files
        const testDir = path.join(__dirname, 'test_assets');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

        const testImagePath = path.join(testDir, 'test_image.jpg');
        fs.writeFileSync(testImagePath, crypto.randomBytes(50000)); // 50KB random "image" noise
        const originalHash = calculateHash(testImagePath);

        // 3. Upload File
        const fileChooserPromise = page.waitForEvent('filechooser');
        // Assuming the user clicks the attach button (SVG or icon button next to text input)
        // We target the hidden file input directly for stability
        await page.setInputFiles('input[type="file"]', testImagePath);

        // 4. Send the message
        await page.fill('input[placeholder="Type a message"]', 'E2EE Automated Upload Test');
        await page.click('button:has-text("Send")');

        // 5. Verify rendering
        const messageBubble = page.locator('.MuiPaper-root', { hasText: 'E2EE Automated Upload Test' }).last();
        await expect(messageBubble).toBeVisible({ timeout: 10000 });

        // Check if the image was decrypted and mounted successfully
        const renderedImage = messageBubble.locator('img').first();
        await expect(renderedImage).toBeVisible({ timeout: 15000 });

        // Ensure the Blob URL originated locally, preventing HTTP leakage
        const src = await renderedImage.getAttribute('src');
        expect(src).toMatch(/^blob:/);

        // 6. Test Download Extraction
        const downloadPromise = page.waitForEvent('download');
        // Click the universal download action button inside the bubble
        await messageBubble.locator('button[aria-label="download"], svg[data-testid="FileDownloadIcon"]').first().click();

        const download = await downloadPromise;
        const downloadPath = await download.path();

        // 7. Verify Crypto Hash Identity (The most critical E2EE check)
        const downloadedHash = calculateHash(downloadPath);
        expect(downloadedHash).toBe(originalHash);
    });

    test('Mixed Bundle Normalization', async ({ page }) => {
        // Navigate and login
        await page.goto('http://localhost:5173');
        const nameInput = page.locator('input[placeholder="Enter your name"]');
        if (await nameInput.isVisible()) {
            await nameInput.fill('TestBot');
            await page.keyboard.press('Enter');
        }
        await page.click('text=Global Group');

        // Create 3 distinct mock files
        const testDir = path.join(__dirname, 'test_assets');
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

        const imagePath = path.join(testDir, 'mix_img.jpg');
        const audioPath = path.join(testDir, 'mix_audio.mp3');
        const docPath = path.join(testDir, 'mix_doc.pdf');

        fs.writeFileSync(imagePath, crypto.randomBytes(1000));
        fs.writeFileSync(audioPath, crypto.randomBytes(1000));
        fs.writeFileSync(docPath, crypto.randomBytes(1000));

        // Upload mixed array
        await page.setInputFiles('input[type="file"]', [imagePath, audioPath, docPath]);
        await page.fill('input[placeholder="Type a message"]', 'Mixed Bundle Test');
        await page.click('button:has-text("Send")');

        // Validate DOM isolation
        const bubble = page.locator('.MuiPaper-root', { hasText: 'Mixed Bundle Test' }).last();

        // Ensure `normalizeAttachments` split the renderer perfectly
        await expect(bubble.locator('img').first()).toBeVisible({ timeout: 15000 });
        await expect(bubble.locator('audio').first()).toBeVisible();
        await expect(bubble.locator('text=mix_doc.pdf')).toBeVisible();
    });
});
