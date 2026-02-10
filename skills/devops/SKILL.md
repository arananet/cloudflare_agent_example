# DevOps & Change Management

## Overview
Comprehensive DevOps practices focused on continuous integration, deployment automation, and rigorous change documentation to ensure traceability, reliability, and team collaboration.

## Core Competencies

### 1. Changelog Management
**Philosophy**: Every code change must be documented with context, impact, and rationale.

#### Best Practices
- **Mandatory Changelog Updates**: Every push to main/production must include CHANGELOG.md updates
- **Semantic Versioning**: Follow [SemVer](https://semver.org/) (MAJOR.MINOR.PATCH)
- **Keep a Changelog Format**: Adhere to [keepachangelog.com](https://keepachangelog.com/) standards
- **Categories**: Organize changes by type (Added, Changed, Deprecated, Removed, Fixed, Security)

#### Changelog Structure
```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-01-27
### Added
- New internationalization support (English/Spanish)
- Dark/light theme toggle with localStorage persistence
- Custom theme system with CSS classes

### Changed
- Updated authentication terminology to SAML/OIDC & OAuth 2.0
- Optimized mobile responsiveness for Spanish text wrapping
- Reduced font sizes for better multi-language support

### Fixed
- Theme toggle not responding to user clicks
- Button visibility issues in light mode
- Text wrapping in expertise section for Spanish locale

## [1.1.0] - 2026-01-20
### Added
- Railway deployment configuration
- Root package.json for platform detection

### Fixed
- Node.js version compatibility (>=20.9.0)
```

### 2. Conventional Commits
**Standard**: Use [Conventional Commits](https://www.conventionalcommits.org/) specification.

#### Commit Message Format
```
<type>[(scope)]: <description>

[optional body]

[optional footer(s)]
```

#### Types
- `feat`: New feature for the user
- `fix`: Bug fix for the user
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, missing semi-colons)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes to build system or dependencies
- `ci`: Changes to CI configuration files and scripts
- `chore`: Other changes that don't modify src or test files

#### Examples
```bash
feat(i18n): add Spanish translation support

- Implemented locale context with EN/ES switching
- Created translation files with comprehensive content
- Added language toggle button to UI

Closes #123

---

fix(theme): resolve button visibility in light mode

Updated button opacity from 80% to 95% and added
stronger borders for better visibility.

---

docs(changelog): update for v1.2.0 release

Documented all feature additions and bug fixes
from sprint 12.
```

### 3. Version Control Strategy

#### Branching Model
```
main (production)
  ├── develop (integration)
  │   ├── feature/i18n-support
  │   ├── feature/theme-toggle
  │   └── fix/text-wrapping
  ├── hotfix/security-patch
  └── release/v1.2.0
```

#### Protected Branches
- **main**: Production-ready code only
- **develop**: Integration branch for features
- Require pull request reviews
- Enforce status checks before merging
- Require up-to-date branches

### 4. CI/CD Pipeline Integration

#### Pre-commit Hooks
```yaml
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Lint commit message
npx --no -- commitlint --edit $1

# Run linter
npm run lint

# Run tests
npm run test

# Check for CHANGELOG.md updates on main branch
if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
  if ! git diff --cached --name-only | grep -q "CHANGELOG.md"; then
    echo "❌ Error: CHANGELOG.md must be updated when pushing to main"
    exit 1
  fi
fi
```

#### Automated Changelog Generation
```bash
# Using standard-version
npm install --save-dev standard-version

# Generate changelog and bump version
npm run release

# Custom script in package.json
{
  "scripts": {
    "release": "standard-version",
    "release:minor": "standard-version --release-as minor",
    "release:major": "standard-version --release-as major",
    "release:patch": "standard-version --release-as patch"
  }
}
```

### 5. Documentation Requirements

#### Every Change Must Include
1. **CHANGELOG.md**: User-facing changes
2. **Commit Message**: Technical details and context
3. **PR Description**: Problem, solution, testing performed
4. **README.md**: Update if user-facing changes
5. **API Docs**: Update if API changes

#### Pull Request Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Changes Made
- Change 1
- Change 2
- Change 3

## Testing Performed
- [ ] Local testing completed
- [ ] Unit tests added/updated
- [ ] Integration tests passed
- [ ] Manual QA performed

## Changelog Updated
- [ ] CHANGELOG.md updated with user-facing changes

## Screenshots (if applicable)
Before | After

## Related Issues
Closes #123
```

### 6. Release Management

#### Release Checklist
- [ ] All tests passing
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Documentation updated
- [ ] Security vulnerabilities addressed
- [ ] Performance benchmarks met
- [ ] Backward compatibility verified
- [ ] Migration guide created (if breaking changes)
- [ ] Release notes drafted
- [ ] Stakeholders notified

#### Versioning Strategy
```
MAJOR: Breaking API changes
MINOR: New features, backward compatible
PATCH: Bug fixes, backward compatible

Examples:
1.0.0 → 2.0.0 (Breaking: Removed deprecated API)
1.0.0 → 1.1.0 (Added: New theme system)
1.0.0 → 1.0.1 (Fixed: Button visibility bug)
```

### 7. Monitoring & Observability

#### Deployment Tracking
```yaml
# Track deployments in CHANGELOG.md
## [1.2.0] - 2026-01-27
### Deployment Info
- Environment: Production
- Deployed by: Railway CI/CD
- Commit: 4901fdb
- Build time: 2m 34s
- Rollback plan: git revert 4901fdb
```

#### Metrics to Track
- Deployment frequency
- Lead time for changes
- Mean time to recovery (MTTR)
- Change failure rate
- Code review turnaround time

### 8. Automation Tools

#### Recommended Stack
```json
{
  "commitlint": "Enforce commit message format",
  "husky": "Git hooks for pre-commit checks",
  "standard-version": "Automated versioning and changelog",
  "semantic-release": "Fully automated release workflow",
  "conventional-changelog": "Generate changelogs from commits",
  "lint-staged": "Run linters on staged files",
  "danger-js": "Code review automation"
}
```

#### GitHub Actions Workflow
```yaml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          fetch-depth: 0
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Verify CHANGELOG updated
        run: |
          if ! git diff HEAD~1 --name-only | grep -q "CHANGELOG.md"; then
            echo "❌ CHANGELOG.md not updated"
            exit 1
          fi
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build
      
      - name: Deploy
        run: echo "Deploying to production..."
```

## Best Practices Summary

### Do's ✅
- **Always** update CHANGELOG.md with every push to main
- Use conventional commits for all changes
- Tag releases with semantic versions
- Document breaking changes prominently
- Include migration guides for major versions
- Automate changelog generation where possible
- Review changelogs in code reviews
- Keep unreleased section up to date
- Link commits to issues/tickets
- Test rollback procedures

### Don'ts ❌
- Don't skip changelog updates ("will do it later")
- Don't use vague commit messages ("fix stuff", "updates")
- Don't merge without review
- Don't deploy without tests passing
- Don't forget to version bump
- Don't combine unrelated changes in one commit
- Don't rewrite published history
- Don't deploy on Fridays (unless necessary)

## Implementation Checklist

### Initial Setup
- [ ] Create CHANGELOG.md in project root
- [ ] Install commitlint and husky
- [ ] Configure pre-commit hooks
- [ ] Add PR template to .github/
- [ ] Document versioning strategy in README
- [ ] Set up branch protection rules
- [ ] Configure CI/CD changelog validation
- [ ] Train team on conventional commits

### Ongoing Maintenance
- [ ] Review CHANGELOG before each release
- [ ] Ensure all PRs update changelog
- [ ] Generate release notes from changelog
- [ ] Archive old versions
- [ ] Update documentation links
- [ ] Maintain consistency in formatting

## Tools & Resources

### Essential Tools
- **[Keep a Changelog](https://keepachangelog.com/)**: Changelog format standard
- **[Semantic Versioning](https://semver.org/)**: Versioning specification
- **[Conventional Commits](https://www.conventionalcommits.org/)**: Commit message convention
- **[commitlint](https://commitlint.js.org/)**: Lint commit messages
- **[husky](https://typicode.github.io/husky/)**: Git hooks made easy
- **[standard-version](https://github.com/conventional-changelog/standard-version)**: Automated versioning

### Integration Examples
```bash
# Install commitlint
npm install --save-dev @commitlint/cli @commitlint/config-conventional

# Configure commitlint
echo "module.exports = {extends: ['@commitlint/config-conventional']}" > commitlint.config.js

# Install husky
npm install --save-dev husky
npx husky install

# Add commit-msg hook
npx husky add .husky/commit-msg 'npx --no -- commitlint --edit $1'

# Add pre-commit changelog check
npx husky add .husky/pre-commit 'npm run check:changelog'
```

## Conclusion
Rigorous change documentation is not overhead—it's essential infrastructure for sustainable software development. A well-maintained changelog serves as project history, communication tool, and audit trail. By automating validation and making changelog updates mandatory, teams ensure consistent, traceable, and professional software delivery.

---

**Last Updated**: January 27, 2026  
**Maintained By**: Eduardo Luis Arana  
**Version**: 1.0.0
