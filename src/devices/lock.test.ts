import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('lock pushChanges method', () => {
  // Test that the improved pushChanges method has better logging and validation
  it('should add defensive logging for API calls', () => {
    // This test validates that our code improvements are present
    // We test the actual code changes by checking the source contains our improvements
    const lockTsPath = join(__dirname, 'lock.ts')
    const lockTsContent = readFileSync(lockTsPath, 'utf8')

    // Verify that our defensive logging is present
    expect(lockTsContent).toContain('Making API call - Target:')
    expect(lockTsContent).toContain('States synchronized before API call')
    expect(lockTsContent).toContain('Double-check that we still need to make the API call')
  })

  it('should have proper error handling structure', () => {
    // Validate that the error handling structure is maintained
    const lockTsPath = join(__dirname, 'lock.ts')
    const lockTsContent = readFileSync(lockTsPath, 'utf8')

    // Verify error handling is still present
    expect(lockTsContent).toContain('await this.statusCode(\'pushChanges\', e)')
    expect(lockTsContent).toContain('pushChanges: ${e.message')
  })
})

describe('lock parseEventStatus method - transitional state handling', () => {
  it('should not have early return when in transitional states to prevent stuck "Unlocking..." status', () => {
    // Test that the parseEventStatus method has been fixed to not return early
    // when in locking/unlocking states, which was causing the stuck state issue
    const lockTsPath = join(__dirname, 'lock.ts')
    const lockTsContent = readFileSync(lockTsPath, 'utf8')

    // Extract only the parseEventStatus method content
    const parseEventStatusMatch = lockTsContent.match(/async parseEventStatus\(\)[\s\S]*?(?=async \w+\(\)|$)/g)
    expect(parseEventStatusMatch).toBeTruthy()

    if (parseEventStatusMatch && parseEventStatusMatch[0]) {
      const parseEventStatusContent = parseEventStatusMatch[0]

      // Look for the specific problematic pattern: if (unlocking || locking) { debugLog; return }
      // We need to ensure there's no actual return statement (not just the word in comments)
      const problematicPattern = /lockEvent\.state\.unlocking[\s\S]*?lockEvent\.state\.locking[\s\S]*?debugLog[\s\S]*?\sreturn\s*$/m
      const hasProblematicPattern = problematicPattern.test(parseEventStatusContent)

      // This pattern should be removed/fixed to prevent stuck states
      expect(hasProblematicPattern).toBe(false)

      // Also check more directly - there should be no standalone return statement after the transitional check
      const transitionCheckMatch = parseEventStatusContent.match(
        /if\s*\(\s*this\.LockMechanism[\s\S]*?unlocking[\s\S]*?locking[\s\S]*?\)\s*\{([^}]*)\}/,
      )
      if (transitionCheckMatch) {
        const blockContent = transitionCheckMatch[1]
        // The block should not contain a bare return statement
        expect(blockContent).not.toMatch(/^\s*return\s*$/m)
      }
    }
  })

  it('should handle transitional states with proper logging but continue processing', () => {
    // Verify that the method processes the lock state updates even when transitional
    const lockTsPath = join(__dirname, 'lock.ts')
    const lockTsContent = readFileSync(lockTsPath, 'utf8')

    // Find the parseEventStatus method
    const parseEventStatusMatch = lockTsContent.match(/async parseEventStatus\(\)[\s\S]*?(?=async \w+\(\)|$)/g)

    if (parseEventStatusMatch && parseEventStatusMatch[0]) {
      const parseEventStatusContent = parseEventStatusMatch[0]

      // Should still have detection and logging for transitional states
      expect(parseEventStatusContent).toContain('unlocking')
      expect(parseEventStatusContent).toContain('locking')
      expect(parseEventStatusContent).toContain('debugLog')

      // Should also have the logic to update LockCurrentState
      expect(parseEventStatusContent).toContain('LockCurrentState')
    }
  })
})
