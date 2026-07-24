/// <reference types="vite/client" />

import type { EngramApi } from '../../preload/index'

declare global {
  interface Window {
    engram: EngramApi
  }
}
