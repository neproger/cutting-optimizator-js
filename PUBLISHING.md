# Publishing Notes

This module is publish-ready as a standalone package.

## 1. Extract module

Copy this folder to a separate repository root:

- `index.js`
- `core/*`
- `README.md`
- `package.json`

## 2. Set final package metadata

Before publishing, update:

- `name`
- `version`
- `license`
- `repository`

## 3. Publish

```bash
npm publish --access public
```

If this package should remain private, publish without `--access public`
to a private registry.
