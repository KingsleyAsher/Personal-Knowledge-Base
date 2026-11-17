# Third-party components

The application uses Electron, React, Vite, CodeMirror, PDF.js, KaTeX, Noto Sans SC, Lucide and other packages listed in `apps/desktop/package-lock.json`. Python's Windows embedded runtime is downloaded for packaging. Installer icon generation uses Pillow. These components retain their respective licenses; the project's MIT license does not replace them.

Keep bundled license files when distributing binaries. Dependency versions are defined by the lockfile and packaging scripts. No runtime archives or private model files are committed here.
