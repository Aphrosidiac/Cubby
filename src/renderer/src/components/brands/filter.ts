// The Brands list filter, shared by the page, its sidebar and the filter chips.
export interface BrandFilter { groupId?: string; tag?: string; platform?: string; loginState?: string; status?: string }

/** Colours handed to new groups in turn, so groups are told apart at a glance. */
export const GROUP_COLORS = ['#2c4f9c', '#1d6b45', '#a3261d', '#8a5a00', '#6b3fa0', '#0f766e', '#be185d', '#475569'];
