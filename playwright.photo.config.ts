import { defineConfig } from '@playwright/test';
if (!process.env.SOLVEFLOW_PHOTO_TEST_URL) throw new Error('Start the isolated photo fixture server first.');
export default defineConfig({ testDir:'./tests/photo-web',testMatch:'*.spec.ts',timeout:45000,workers:1,fullyParallel:false,
  outputDir:process.env.SOLVEFLOW_PHOTO_TEST_OUTPUT ?? '.runtime/photo-web-browser',
  use:{baseURL:process.env.SOLVEFLOW_PHOTO_TEST_URL,launchOptions:{executablePath:'/usr/bin/google-chrome'},screenshot:'only-on-failure',reducedMotion:'reduce'},
  projects:[{name:'phone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'desktop',use:{viewport:{width:1280,height:900}}}],
});
