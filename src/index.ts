// src/index.ts
import callPositions from './views/Positions.vue'

// Named export
export { callPositions }

// Default export (optional)
export default callPositions

// Props interface
export interface callPositionsProps {
  symbolRoot: string    // Root symbol of the instrument
  userId?: string | null    // Current user ID for access control
}
