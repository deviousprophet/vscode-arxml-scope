/** The most condition values the host stores and the panel accepts. */
export const MAX_CONDITION_ENTRIES = 200;

/** One entered SW-SYSCOND constant value, as stored by the host. */
export interface ConditionEntry {
	name: string;
	value: string;
}
