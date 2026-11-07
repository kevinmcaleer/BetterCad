/** Draft, Normal and Fine (#86): the largest distance in mm between an export's triangles and the true surface. */
export const DEFLECTION = { draft: 0.1, normal: 0.02, fine: 0.005 } as const;
export type Resolution = keyof typeof DEFLECTION;
