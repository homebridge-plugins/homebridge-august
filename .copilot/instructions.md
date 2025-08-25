# Copilot Instructions for Homebridge August Plugin

## Repository Overview

This is a Homebridge plugin that provides HomeKit integration for August and Yale smart locks. The plugin is written in TypeScript with ES modules and follows Homebridge platform patterns.

## Architecture

- **Plugin Type**: Homebridge dynamic platform plugin
- **Language**: TypeScript with ES modules (ES2022)
- **Runtime**: Node.js 20+ or 22+
- **Build System**: TypeScript compiler (tsc) with bundler module resolution
- **Testing**: Vitest with coverage support
- **Linting**: ESLint with Antfu config and custom rules
- **Documentation**: TypeDoc with modern theme
- **External API**: august-yale package for August/Yale API communication

## Key Files and Directories

- `src/` - TypeScript source code
  - `index.ts` - Plugin entry point that registers the platform
  - `platform.ts` - Main platform class (AugustPlatform)
  - `settings.ts` - Configuration interfaces and constants
  - `devices/` - Device-specific implementations
    - `lock.ts` - Lock mechanism implementation
    - `device.ts` - Base device class
  - `homebridge-ui/` - Custom UI for Homebridge Config UI X
  - `*.test.ts` - Test files (Vitest)
- `dist/` - Compiled JavaScript output (generated, excluded from git)
- `config.schema.json` - Homebridge configuration schema with custom UI
- `package.json` - Dependencies and npm scripts
- `tsconfig.json` - TypeScript configuration (ES2022, bundler resolution)
- `eslint.config.js` - ESLint configuration with Antfu base and custom rules

## Development Workflow

### Building
```bash
npm run build         # Full build: clean + compile + copy UI files
npm run clean         # Remove dist directory
npm run watch         # Build + link + watch with nodemon
```

### Testing
```bash
npm test              # Run Vitest tests once
npm run test:watch    # Run tests in watch mode
npm run test-coverage # Run tests with coverage report
```

### Linting
```bash
npm run lint          # Check for ESLint issues
npm run lint:fix      # Auto-fix ESLint issues
```

### Documentation
```bash
npm run docs          # Generate TypeDoc documentation
npm run docs:lint     # Validate documentation (treat warnings as errors)
npm run docs:theme    # Generate docs with default-modern theme
```

### Development Setup
```bash
npm run watch         # Start development with hot reload
npm run plugin-ui     # Copy UI files to dist
```

## Coding Standards

1. **TypeScript**: 
   - ES2022 target with bundler module resolution
   - Strict mode enabled (except noImplicitAny: false)
   - Use ES modules with `.js` file extensions in imports
   - Generate declaration files and source maps

2. **ESLint**: 
   - Antfu ESLint config as base
   - Custom rules for import ordering (perfectionist)
   - JSDoc alignment enforcement
   - Multi-line curly braces only
   - Consistent quote props
   - Test-specific rules (no-only-tests)

3. **Code Style**:
   - Use 1TBS brace style with single line allowed
   - Sort imports by type (builtin, external, internal, relative)
   - Sort named imports and exports
   - Use proper JSDoc formatting and alignment

4. **Homebridge Patterns**:
   - Implement DynamicPlatformPlugin interface
   - Use proper platform registration in index.ts
   - Follow accessory lifecycle management
   - Implement proper logging with Homebridge logger
   - Use PlatformAccessory for device management

5. **Error Handling**: 
   - Proper try-catch blocks for async operations
   - Meaningful error messages with context
   - Graceful degradation for API failures

## Homebridge Specifics

- **Platform Type**: Dynamic platform plugin (not accessory plugin)
- **Platform Name**: "August" (defined in settings.ts)
- **Plugin Name**: "homebridge-august" (must match package.json name)
- **Configuration Schema**: Uses config.schema.json with custom UI
- **Custom UI**: Located in src/homebridge-ui/ with custom configuration interface
- **Platform Class**: AugustPlatform extends DynamicPlatformPlugin
- **Device Management**: Uses PlatformAccessory for caching and state management
- **HAP Services**: Implement LockMechanism service for smart locks
- **Authentication**: Handle August API authentication with validation codes
- **Rate Limiting**: Implement proper refresh/update/push rates for API calls

## August/Yale Integration

- **API Package**: Uses `august-yale` npm package for API communication
- **Authentication Flow**:
  1. User provides augustId (email/phone) and password
  2. System sends validation code to user
  3. User enters validation code to complete authentication
  4. API credentials are stored and used for subsequent requests
- **Device Types**: Support multiple lock types (August Smart Lock, Yale Assure Lock variants)
- **State Synchronization**: Keep HomeKit state in sync with August/Yale API
- **Polling**: Implement configurable refresh rates for device state updates
- **Configuration**: Use credentials interface for API authentication settings

## When Making Changes

1. **Dependencies**: 
   - Only add well-maintained dependencies
   - Keep runtime dependencies minimal
   - Update package.json and package-lock.json properly
   - Consider bundle size impact

2. **Breaking Changes**: 
   - Follow semantic versioning
   - Update CHANGELOG.md appropriately
   - Consider migration paths for users
   - Test with multiple Homebridge versions

3. **Configuration**: 
   - Update config.schema.json for new options
   - Maintain backward compatibility
   - Add proper validation and defaults
   - Update TypeScript interfaces in settings.ts

4. **Documentation**: 
   - Update README.md for user-facing changes
   - Add TSDoc comments for new APIs
   - Update TypeDoc comments for generated docs
   - Consider updating examples

5. **Testing**: 
   - Add Vitest tests for new features
   - Mock external dependencies (August API)
   - Test error scenarios and edge cases
   - Maintain test coverage

6. **Compatibility**: 
   - Support Node.js 20+ and 22+
   - Support Homebridge 1.9.0+ and 2.0.0+
   - Test with Config UI X integration
   - Verify ES module compatibility

## Common Patterns

- **RxJS**: Use reactive programming patterns where appropriate
- **Async/Await**: Prefer async/await over Promise chains
- **ES Modules**: Use ES module syntax with `.js` extensions in imports
- **Interface Design**: Define clear TypeScript interfaces in settings.ts
- **Error Handling**: Implement comprehensive error handling with meaningful messages
- **Logging**: Use this.log with appropriate log levels (info, warn, error, debug)
- **Device Lifecycle**: Implement proper setup/cleanup in platform methods
- **Configuration Validation**: Validate user configuration and provide helpful error messages
- **API Rate Limiting**: Respect August API rate limits with configurable intervals
- **State Management**: Maintain device state consistency between API and HomeKit

## Important Constants and Settings

- **PLATFORM_NAME**: "August" (used in Homebridge registration)
- **PLUGIN_NAME**: "homebridge-august" (must match package.json)
- **Plugin Type**: "platform" (not accessory)
- **Custom UI**: Enabled with path "./dist/homebridge-ui"
- **Configuration**: Uses credentials and options interfaces
- **Device Types**: Support for various August and Yale lock models

## Testing Guidelines

- **Framework**: Use Vitest for testing with TypeScript support
- **Test Files**: Name test files with `.test.ts` extension in src/
- **Coverage**: Aim for good test coverage, use `npm run test-coverage`
- **Mocking**: Mock external dependencies, especially:
  - August/Yale API calls
  - Homebridge API interactions
  - File system operations
- **Test Categories**:
  - Unit tests for individual functions and classes
  - Integration tests for platform initialization
  - Configuration validation tests
  - Error handling tests
- **Test Data**: Use realistic test data that matches August API responses
- **Async Testing**: Properly test async operations and promises
- **CI/CD**: Ensure tests run in continuous integration pipeline

## Files to Avoid Modifying

- `dist/` directory (generated by TypeScript compilation)
- `node_modules/` directory (managed by npm)
- `docs/` directory (generated by TypeDoc)
- `.git/` directory and git metadata
- Files listed in `.gitignore`
- `package-lock.json` (only modify through npm commands)

## Security Considerations

- **Credentials**: Never log or expose user credentials
- **API Keys**: Handle August API credentials securely
- **Validation**: Validate all user inputs
- **Error Messages**: Don't expose sensitive information in error messages
- **Storage**: Store credentials securely using Homebridge storage mechanisms