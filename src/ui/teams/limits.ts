/* The limits a plan is read back with when it is opened again (domain/files.ts keeps them
   to itself). The fields of this view stop at the same limits, so that nothing typed here is
   cut off the next time the plan is loaded. */

export const MAX_NAME_LENGTH = 120
export const MAX_GROUP_LENGTH = 60
export const MAX_NOTES_LENGTH = 2000
export const MAX_TEAM_SIZE = 5000
