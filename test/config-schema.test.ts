/**
 * The config UI fills in schema defaults and then drops empty strings before
 * it validates, so a required field that defaults to "" is always reported
 * missing - an orange warning next to Save on every config, even untouched
 * ones. These checks shape a config the way the UI does and validate it with
 * ajv, as the UI does.
 */
import { readFileSync } from 'node:fs'

import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'

interface JsonSchema {
  type?: string | string[]
  default?: unknown
  required?: string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
}

const schemaFile = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8')) as { schema: JsonSchema }
const validator = new Ajv({ strict: false, allErrors: true }).compile(schemaFile.schema)

/**
 * Shape a config the way the Homebridge UI does before it validates. The UI
 * fills in schema defaults (`setSchemaDefaults: true`) and then drops empty
 * strings (`returnEmptyFields: false`), so a required field whose default is
 * an empty string is missing by the time it is checked.
 */
function asSeenByUi(schema: JsonSchema | undefined, data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(item => asSeenByUi(schema?.items, item))
  }
  if (!data || typeof data !== 'object') {
    return data
  }
  const shaped: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const [key, sub] of Object.entries(schema?.properties ?? {})) {
    const value = Object.hasOwn(shaped, key) ? shaped[key] : sub.default
    if (value === undefined || value === '') {
      delete shaped[key]
    } else {
      shaped[key] = asSeenByUi(sub, value)
    }
  }
  return shaped
}

function uiErrors(data: unknown): string[] {
  validator(asSeenByUi(schemaFile.schema, data))
  return (validator.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message}`)
}

function requiredWithEmptyDefault(schema: JsonSchema, path: string): string[] {
  const own = (schema.required ?? [])
    .filter(key => schema.properties?.[key]?.default === '')
    .map(key => `${path}.${key}`)
  const nested = Object.entries(schema.properties ?? {})
    .flatMap(([key, sub]) => requiredWithEmptyDefault(sub.items ?? sub, `${path}.${key}`))
  return [...own, ...nested]
}

const credentials = {
  augustId: 'someone@example.com',
  password: 'not-a-real-password',
  countryCode: 'US',
  validateCode: '123456',
}

describe('config.schema.json as the config UI sees it', () => {
  it('gives every required field with a default a value the ui keeps', () => {
    expect(requiredWithEmptyDefault(schemaFile.schema, '$')).toEqual([])
  })

  it('accepts a config that leaves the plugin logging level at its default', () => {
    expect(uiErrors({ name: 'August', credentials, options: {} })).toEqual([])
  })

  it('accepts a lock that leaves its logging level at its default', () => {
    expect(uiErrors({
      name: 'August',
      credentials,
      options: { devices: [{ lockId: 'ABC123', configLockName: 'Front Door' }] },
    })).toEqual([])
  })

  it('accepts the default logging choice once it has been saved', () => {
    expect(uiErrors({
      name: 'August',
      credentials,
      options: { logging: 'default', devices: [{ lockId: 'ABC123', configLockName: 'Front Door', logging: 'default' }] },
    })).toEqual([])
  })
})
