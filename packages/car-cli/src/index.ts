/**
 * @vorion/car-cli
 *
 * Programmatic API for CAR CLI commands.
 */

export { createCARClient, CARClient, CARError } from '@vorion/car-client'

// Backwards-compatible aliases (deprecated)
export { createCARClient as createACIClient, CARClient as ACIClient, CARError as ACIError } from '@vorion/car-client'

export * from '@vorion/car-client'
