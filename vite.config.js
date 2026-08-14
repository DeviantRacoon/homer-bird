import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.SERVER_PORT || 3001;

  return {
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true
        }
      }
    }
  };
});
