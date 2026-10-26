"""Compatibility entry point for safe stable mirror synchronization."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('sync-mirror-refs.py')), run_name='__main__')
