/**
 * Where the circuit simulator (#761) is served from. The build copies eecircuit-engine there (web/vite.config.ts),
 * named by its version; it must match the installed package's, which the build checks.
 */
export const SIM_ENGINE_VERSION = "1.9.0";
export const simEnginePath = (): string => `assets/sim/eecircuit-engine-${SIM_ENGINE_VERSION}.js`;
