import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Собственный домен blueprint-lab.infinitower.com: файлы сборки доступны от корня.
  base: '/',
})
