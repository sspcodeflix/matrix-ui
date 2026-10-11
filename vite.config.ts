import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mockApi } from './mock/runServer.ts'

export default defineConfig({
  plugins: [react(), mockApi()],
})
