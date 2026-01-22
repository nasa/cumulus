# Pre-commit Setup for Cumulus

This project now has pre-commit hooks configured to automatically run linting and formatting tools on your changes before they're committed.

## How It Works

The pre-commit configuration uses your existing project tools and configuration files:

- **ESLint**: Uses your `.eslintrc.js` configuration with `--fix` for auto-fixing
- **Ruff (Python)**: Uses your `pyproject.toml` configuration for linting and formatting
- **Markdown**: Uses your `.markdownlint.json` configuration
- **Package.json**: Uses your existing `npmPkgJsonLint` configuration
- **TypeScript**: Runs compilation check using your `tsconfig.json` files

## Installation

The hooks are already installed if you've run the setup. If you need to reinstall them:

```bash
npm run precommit:install
```

## Usage

### Automatic (Recommended)

Once installed, the hooks will run automatically on each commit. If any issues are found:

1. **Auto-fixable issues** (formatting, trailing whitespace, etc.) will be fixed automatically
2. **Manual fixes required** - the commit will be blocked until you fix the issues
3. **Re-run the commit** after fixes are applied

### Manual Runs

```bash
# Run on all files
npm run precommit:run

# Run on staged files only
uv run pre-commit run

# Run specific hook
uv run pre-commit run eslint
uv run pre-commit run ruff-check
```

### Skip Hooks (use sparingly)

```bash
# Skip all hooks for a commit
git commit --no-verify -m "commit message"

# Skip specific hooks
SKIP=eslint git commit -m "commit message"
```

## Uninstallation

If you need to remove the pre-commit hooks:

```bash
npm run precommit:uninstall
```

## Configuration Files Used

- `.eslintrc.js` - JavaScript/TypeScript linting rules
- `pyproject.toml` - Python linting and formatting (Ruff)
- `.markdownlint.json` - Markdown linting rules
- `npmpackagejsonlint.config.js` - Package.json linting rules
- `tsconfig.json` / `tsconfig.eslint.json` - TypeScript compilation

All rules are centralized in these existing configuration files, so there's no duplication.

## Important Notes

- Pre-commit uses your existing configuration files, keeping all your code standards in one place

## Troubleshooting

### Common Issues

1. **JSON/YAML format errors**: Fix the syntax errors in the reported files
2. **Large files**: Use `git add --force` for legitimate large files or add to `.gitattributes`
3. **Performance**: Large repos may take time on first run (subsequent runs are faster due to caching)

### Updating Hooks

```bash
uv run pre-commit autoupdate
```
