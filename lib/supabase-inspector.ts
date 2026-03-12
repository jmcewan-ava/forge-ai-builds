/**
 * FORGE AI — Supabase Inspector
 *
 * Gives builder agents and the admin UI the ability to inspect the database
 * schema before writing migrations, and run read-only queries.
 *
 * NEVER used for writes — this is read-only by design.
 * Builders that can see the schema write better migrations.
 */

import { getServiceClient } from './supabase'

export interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
  character_maximum_length: number | null
}

export interface TableSchema {
  table_name: string
  columns: ColumnInfo[]
  row_count?: number
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  row_count: number
  columns: string[]
  error?: string
}

/**
 * Get full schema for a specific table including column types and constraints.
 */
export async function getTableSchema(tableName: string): Promise<TableSchema> {
  const db = getServiceClient()

  const { data, error } = await db
    .from('information_schema.columns' as any)
    .select('column_name, data_type, is_nullable, column_default, character_maximum_length')
    .eq('table_schema', 'public')
    .eq('table_name', tableName)
    .order('ordinal_position')

  if (error) throw new Error(`Failed to get schema for ${tableName}: ${error.message}`)

  return {
    table_name: tableName,
    columns: (data || []) as ColumnInfo[]
  }
}

/**
 * List all tables in the public schema.
 */
export async function listTables(): Promise<string[]> {
  const db = getServiceClient()

  const { data, error } = await db
    .from('information_schema.tables' as any)
    .select('table_name')
    .eq('table_schema', 'public')
    .eq('table_type', 'BASE TABLE')
    .order('table_name')

  if (error) throw new Error(`Failed to list tables: ${error.message}`)

  return (data || []).map((row: any) => row.table_name as string)
}

/**
 * Run a read-only SQL query against the database.
 * Validates that the query is a SELECT or WITH (CTE) before executing.
 * Never executes INSERT, UPDATE, DELETE, DROP, etc.
 */
export async function runReadQuery(sql: string): Promise<QueryResult> {
  const trimmed = sql.trim().toUpperCase()

  // Safety: only allow SELECT and WITH (CTEs that start with WITH ... SELECT)
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return {
      rows: [],
      row_count: 0,
      columns: [],
      error: 'Only SELECT and WITH (CTE) queries are allowed. No writes permitted.'
    }
  }

  // Block dangerous keywords even in SELECT context
  const dangerous = ['DROP ', 'DELETE ', 'INSERT ', 'UPDATE ', 'TRUNCATE ', 'ALTER ', 'CREATE ', 'GRANT ', 'REVOKE ']
  for (const keyword of dangerous) {
    if (trimmed.includes(keyword)) {
      return {
        rows: [],
        row_count: 0,
        columns: [],
        error: `Query contains forbidden keyword: ${keyword.trim()}. Read-only queries only.`
      }
    }
  }

  try {
    const db = getServiceClient()

    // Use rpc to execute raw SQL — service role has permission
    const { data, error } = await (db as any).rpc('execute_read_query', { query_text: sql })

    if (error) {
      // Fallback: try direct query if RPC not available
      return {
        rows: [],
        row_count: 0,
        columns: [],
        error: `Query error: ${error.message}. Note: you may need to create the execute_read_query function in Supabase.`
      }
    }

    const rows = Array.isArray(data) ? data : []
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    return {
      rows,
      row_count: rows.length,
      columns
    }

  } catch (err) {
    return {
      rows: [],
      row_count: 0,
      columns: [],
      error: String(err)
    }
  }
}

/**
 * Get a summary of all tables with row counts.
 * Useful for agents to understand the data landscape before writing migrations.
 */
export async function getDatabaseSummary(): Promise<Array<{ table: string; rows: number; columns: string[] }>> {
  const tables = await listTables()
  const db = getServiceClient()

  const summaries = await Promise.allSettled(
    tables.map(async (table) => {
      const { count } = await db
        .from(table)
        .select('*', { count: 'exact', head: true })

      const schema = await getTableSchema(table)

      return {
        table,
        rows: count || 0,
        columns: schema.columns.map(c => `${c.column_name}:${c.data_type}`)
      }
    })
  )

  return summaries
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<any>).value)
}
