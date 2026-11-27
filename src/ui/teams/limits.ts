import { LIMITS } from '../../domain/limits'

/* The limits a plan is kept within (domain/limits.ts). The fields of this view stop at the
   same limits, so that nothing typed here is cut off the next time the plan is loaded. */

export const MAX_NAME_LENGTH = LIMITS.name
export const MAX_ORG_NAME_LENGTH = LIMITS.orgName
export const MAX_NOTES_LENGTH = LIMITS.notes
export const MAX_TEAM_SIZE = LIMITS.teamSize
