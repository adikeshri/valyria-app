import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Fixed port so the Tauri shell's devUrl (src-tauri/tauri.conf.json) can
  // rely on it — `tauri dev` starts this via `npm run dev` and waits on
  // exactly this origin.
  server: {
    port: 5183,
    strictPort: true,
  },
  clearScreen: false,
})
