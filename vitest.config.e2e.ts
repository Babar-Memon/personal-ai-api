import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-jwt-secret-with-32-characters',
      OTP_RESEND_SECONDS: '0',
    },
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
