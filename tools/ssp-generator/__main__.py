"""Allow running as: python -m vorion.tools.ssp_generator"""
from .cli import main
import sys

sys.exit(main())
