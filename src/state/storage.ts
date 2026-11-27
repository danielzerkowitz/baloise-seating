import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeProject } from '../domain/files'
import type { Project } from '../domain/types'
import { loadSavedProject, saveProject } from './persist'

/* Where the plan is kept. With Supabase configured (see .env.example) that is one row of
   the `plans` table, shared by everyone who opens the app; otherwise this browser's own
   storage, as before.

   Every row carries a version that goes up by one on each save. A save names the version
   it builds on and is refused when the row has moved on since: two planners at work at the
   same time never silently overwrite each other. */

export interface Saved {
  project: Project
  /** The stored version this project is. Always 0 in the browser. */
  version: number
}

export interface PlanStorage {
  where: 'database' | 'browser'
  /** What is stored, or null when nothing is. Throws when the storage cannot be reached. */
  load(): Promise<Saved | null>
  /** Stores the project over `version` (null: over nothing) and returns the new version.
   *  Throws `PlanChangedElsewhere` when what is stored is not that version. */
  save(project: Project, version: number | null): Promise<number>
  /** The version stored now, or null when nothing is. */
  version(): Promise<number | null>
}

/** A save was refused: someone else saved the plan since it was loaded. */
export class PlanChangedElsewhere extends Error {
  constructor() {
    super('The plan was changed elsewhere.')
    this.name = 'PlanChangedElsewhere'
  }
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

/** The rows of the plans table, as the database storage needs them. */
export interface PlanRows {
  read(id: string): Promise<{ data: unknown; version: number } | null>
  readVersion(id: string): Promise<number | null>
  /** Adds the row; false when a row with this id is already there. */
  insert(id: string, data: Project): Promise<boolean>
  /** Replaces the row's data and version, but only while it still has version `from`;
   *  false when it does not. */
  update(id: string, data: Project, from: number, to: number): Promise<boolean>
}

export function databaseStorage(rows: PlanRows, planId: string): PlanStorage {
  return {
    where: 'database',

    async load() {
      const row = await rows.read(planId)
      // Anyone with the app can write this row: read it as untrusted, like a file.
      return row ? { project: normalizeProject(row.data), version: row.version } : null
    },

    async save(project, version) {
      if (version === null) {
        if (!(await rows.insert(planId, project))) throw new PlanChangedElsewhere()
        return 1
      }
      if (!(await rows.update(planId, project, version, version + 1))) throw new PlanChangedElsewhere()
      return version + 1
    },

    version: () => rows.readVersion(planId),
  }
}

const TABLE = 'plans'
/** Postgres: a row with this key is already there. */
const UNIQUE_VIOLATION = '23505'

/** The plans table in Supabase. */
export function supabaseRows(client: SupabaseClient): PlanRows {
  return {
    async read(id) {
      const { data, error } = await client.from(TABLE).select('data, version').eq('id', id).maybeSingle()
      if (error) throw error
      return data as { data: unknown; version: number } | null
    },

    async readVersion(id) {
      const { data, error } = await client.from(TABLE).select('version').eq('id', id).maybeSingle()
      if (error) throw error
      return (data as { version: number } | null)?.version ?? null
    },

    async insert(id, data) {
      const { error } = await client.from(TABLE).insert({ id, data, version: 1 })
      if (error?.code === UNIQUE_VIOLATION) return false
      if (error) throw error
      return true
    },

    async update(id, data, from, to) {
      const { data: changed, error } = await client
        .from(TABLE)
        .update({ data, version: to })
        .eq('id', id)
        .eq('version', from)
        .select('version')
      if (error) throw error
      return (changed ?? []).length > 0
    },
  }
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

export const browserStorage: PlanStorage = {
  where: 'browser',
  async load() {
    const project = await loadSavedProject()
    return project ? { project, version: 0 } : null
  },
  async save(project) {
    await saveProject(project)
    return 0
  },
  version: async () => 0,
}

// ---------------------------------------------------------------------------
// The one in use
// ---------------------------------------------------------------------------

const env = import.meta.env
/* Vercel's Supabase integration names its variables NEXT_PUBLIC_SUPABASE_*; set by hand
   they are VITE_SUPABASE_*. Both are public by design: the key is the publishable (anon)
   key, and the table's row level security decides what it may do. */
const SUPABASE_URL: string | undefined = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY: string | undefined =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
/** Which row of the table this app works on. */
const PLAN_ID: string = env.VITE_PLAN_ID || 'main'

function chooseStorage(): PlanStorage {
  if (!SUPABASE_URL || !SUPABASE_KEY) return browserStorage
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    // Nobody signs in: keep nothing in the browser.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return databaseStorage(supabaseRows(client), PLAN_ID)
}

export const planStorage: PlanStorage = chooseStorage()
