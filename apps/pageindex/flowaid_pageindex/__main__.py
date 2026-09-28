"""``python -m flowaid_pageindex``: run the PageIndex service."""
import sys

from .server import main

sys.exit(main())
