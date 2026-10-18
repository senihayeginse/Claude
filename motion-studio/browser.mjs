// Launch headless Chromium; falls back to the preinstalled browser in cloud sessions.
import { chromium } from 'playwright';

export async function launchBrowser(options = {}) {
  try {
    return await chromium.launch(options);
  } catch {
    return await chromium.launch({ ...options, executablePath: '/opt/pw-browsers/chromium' });
  }
}
