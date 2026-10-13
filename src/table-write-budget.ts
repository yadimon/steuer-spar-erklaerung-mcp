// Refuse a compound write when only a tiny tail of its deadline remains.
// A cold worker needs time for its own before/write/readback checks; native
// mutations additionally keep a separate model/checkpoint allowance.
export const TABLE_WRITE_MINIMUM_BUDGET_MS = 5_000;
export const TABLE_NATIVE_POSTCONDITION_RESERVE_MS = 2_000;
export const TABLE_TARGET_SEEK_ALLOWANCE_MS = 1_500;
